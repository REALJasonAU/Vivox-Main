package client

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nexus-control/apps/agent/internal/system"
	gen "github.com/nexus-control/packages/proto/gen"
)

// CommandHandler executes the downstream tasks the control plane sends over the
// stream. The Docker manager is the production implementation; the -mock log
// generator is a stand-in used to validate the realtime pipeline before Docker.
//
// Implementations must be safe for concurrent use: the receive loop dispatches
// each command in its own goroutine so a slow StartService (image pull) does
// not head-of-line block a subsequent StopService.
type CommandHandler interface {
	StartService(ctx context.Context, t *gen.StartServiceTask) error
	StopService(ctx context.Context, t *gen.StopServiceTask) error
	UpdateConfig(ctx context.Context, t *gen.UpdateConfigTask) error
}

// FileHandler performs container file operations requested over the stream.
type FileHandler interface {
	ListFiles(ctx context.Context, t *gen.FileListTask) ([]*gen.FileEntry, error)
	ReadFile(ctx context.Context, t *gen.FileReadTask) ([]byte, error)
	WriteFile(ctx context.Context, t *gen.FileWriteTask) error
}

// TerminalHandler manages interactive PTY sessions.
type TerminalHandler interface {
	StartTerminal(ctx context.Context, t *gen.TerminalStartTask) error
	SendTerminalInput(t *gen.TerminalInputTask) error
	ResizeTerminal(t *gen.TerminalResizeTask) error
	StopTerminal(sessionID string)
}

// Runner owns the agent's single long-lived gRPC stream lifecycle:
// dial -> ConnectStream -> {heartbeat loop, receive/dispatch loop} -> on any
// failure, tear down and reconnect with exponential backoff. The agent holds no
// durable state; on every reconnect the control plane re-issues the tasks
// needed to reconcile this node.
type Runner struct {
	cfg             Config
	sender          *Sender
	handler         CommandHandler
	fileHandler     FileHandler
	terminalHandler TerminalHandler
	log             *slog.Logger
	connStatus      atomic.Value // string: connecting|connected|disconnected
}

// ConnectionStatus returns the agent stream status for health checks.
func (r *Runner) ConnectionStatus() string {
	if v := r.connStatus.Load(); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return "disconnected"
}

// NewRunner wires a Runner. sender is the shared upstream multiplexer (also held
// by the log/metric pumps); handler executes downstream commands.
func NewRunner(cfg Config, sender *Sender, handler CommandHandler, fileHandler FileHandler, terminalHandler TerminalHandler, log *slog.Logger) *Runner {
	if log == nil {
		log = slog.Default()
	}
	r := &Runner{cfg: cfg.withDefaults(), sender: sender, handler: handler, fileHandler: fileHandler, terminalHandler: terminalHandler, log: log}
	r.connStatus.Store("disconnected")
	return r
}

// Run blocks, maintaining the stream until ctx is cancelled. It never returns
// an error for transient connection failures — those drive the reconnect loop.
func (r *Runner) Run(ctx context.Context) error {
	backoff := r.cfg.MinBackoff
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		connected := r.runOnce(ctx)
		if connected {
			// We had a healthy session; reset backoff for the next cycle.
			backoff = r.cfg.MinBackoff
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		wait := jitter(backoff)
		r.log.Info("stream down, reconnecting", "delay", wait.Round(time.Millisecond))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
		backoff = nextBackoff(backoff, r.cfg.MaxBackoff)
	}
}

// runOnce performs a single connect+serve cycle. It returns true if a stream was
// successfully established (used to decide whether to reset backoff).
func (r *Runner) runOnce(ctx context.Context) (connected bool) {
	r.connStatus.Store("connecting")
	conn, err := dial(r.cfg)
	if err != nil {
		r.log.Error("dial failed", "err", err)
		r.connStatus.Store("disconnected")
		return false
	}
	defer conn.Close()

	grpcClient := gen.NewAgentControllerClient(conn)

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Fail-fast (no WaitForReady): when the control plane is unreachable the RPC
	// errors promptly so the reconnect/backoff loop can take over rather than
	// blocking indefinitely.
	raw, err := grpcClient.ConnectStream(streamCtx)
	if err != nil {
		r.log.Error("ConnectStream failed", "err", err)
		r.connStatus.Store("disconnected")
		return false
	}

	var stream Stream = raw
	r.sender.setStream(stream)
	defer r.sender.setStream(nil)
	r.connStatus.Store("connected")
	r.log.Info("agent connected", "addr", r.cfg.Address, "agent_id", r.cfg.AgentID)

	// Heartbeat and receive run concurrently; whichever fails first cancels the
	// other via streamCtx so the whole session tears down together.
	errc := make(chan error, 2)
	go func() { errc <- r.heartbeatLoop(streamCtx) }()
	go func() { errc <- r.receiveLoop(streamCtx, stream) }()

	err = <-errc
	cancel()
	r.connStatus.Store("disconnected")
	if err != nil && ctx.Err() == nil {
		r.log.Warn("session ended", "err", err)
	}
	return true
}

// heartbeatLoop emits a Heartbeat every HeartbeatInterval. A send failure means
// the stream is dead and ends the session.
func (r *Runner) heartbeatLoop(ctx context.Context) error {
	ticker := time.NewTicker(r.cfg.HeartbeatInterval)
	defer ticker.Stop()

	var infoOnce sync.Once
	var sysInfo *gen.SystemInfo
	send := func() error {
		var info *gen.SystemInfo
		infoOnce.Do(func() {
			sysInfo = system.CollectInfo()
		})
		if sysInfo != nil {
			info = sysInfo
			sysInfo = nil
		}
		return r.sender.SendHeartbeat("healthy", info)
	}

	if err := send(); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := send(); err != nil {
				return err
			}
		}
	}
}

// receiveLoop reads DownstreamEnvelopes and dispatches each command. A Recv
// error ends the session and triggers reconnect.
func (r *Runner) receiveLoop(ctx context.Context, stream Stream) error {
	for {
		env, err := stream.Recv()
		if err != nil {
			return err
		}
		go r.dispatch(ctx, env)
	}
}

// dispatch routes a single downstream command to the handler and replies with a
// CommandResponse carrying the outcome.
func (r *Runner) dispatch(ctx context.Context, env *gen.DownstreamEnvelope) {
	cmdID := env.GetCommandId()
	switch action := env.GetAction().(type) {
	case *gen.DownstreamEnvelope_Start:
		r.log.Info("StartServiceTask", "command_id", cmdID, "service_id", action.Start.GetServiceId(), "image", action.Start.GetContainerImage())
		err := r.handler.StartService(ctx, action.Start)
		r.replyCommand(cmdID, err)
	case *gen.DownstreamEnvelope_Stop:
		r.log.Info("StopServiceTask", "command_id", cmdID, "service_id", action.Stop.GetServiceId())
		err := r.handler.StopService(ctx, action.Stop)
		r.replyCommand(cmdID, err)
	case *gen.DownstreamEnvelope_Update:
		r.log.Info("UpdateConfigTask", "command_id", cmdID, "service_id", action.Update.GetServiceId())
		err := r.handler.UpdateConfig(ctx, action.Update)
		r.replyCommand(cmdID, err)
	case *gen.DownstreamEnvelope_ListFiles:
		if r.fileHandler == nil {
			_ = r.sender.SendFileListResult(cmdID, action.ListFiles.GetServiceId(), action.ListFiles.GetPath(), nil, "file operations not available")
			return
		}
		entries, err := r.fileHandler.ListFiles(ctx, action.ListFiles)
		if err != nil {
			_ = r.sender.SendFileListResult(cmdID, action.ListFiles.GetServiceId(), action.ListFiles.GetPath(), nil, err.Error())
			return
		}
		_ = r.sender.SendFileListResult(cmdID, action.ListFiles.GetServiceId(), action.ListFiles.GetPath(), entries, "")
	case *gen.DownstreamEnvelope_ReadFile:
		if r.fileHandler == nil {
			_ = r.sender.SendFileReadResult(cmdID, action.ReadFile.GetServiceId(), action.ReadFile.GetPath(), nil, "file operations not available")
			return
		}
		content, err := r.fileHandler.ReadFile(ctx, action.ReadFile)
		if err != nil {
			_ = r.sender.SendFileReadResult(cmdID, action.ReadFile.GetServiceId(), action.ReadFile.GetPath(), nil, err.Error())
			return
		}
		_ = r.sender.SendFileReadResult(cmdID, action.ReadFile.GetServiceId(), action.ReadFile.GetPath(), content, "")
	case *gen.DownstreamEnvelope_WriteFile:
		if r.fileHandler == nil {
			r.replyCommand(cmdID, fmt.Errorf("file operations not available"))
			return
		}
		err := r.fileHandler.WriteFile(ctx, action.WriteFile)
		r.replyCommand(cmdID, err)
	case *gen.DownstreamEnvelope_TerminalStart:
		if r.terminalHandler == nil {
			r.log.Warn("terminal start ignored", "reason", "no handler")
			return
		}
		if err := r.terminalHandler.StartTerminal(ctx, action.TerminalStart); err != nil {
			r.log.Warn("terminal start failed", "err", err)
		}
	case *gen.DownstreamEnvelope_TerminalInput:
		if r.terminalHandler == nil {
			return
		}
		if err := r.terminalHandler.SendTerminalInput(action.TerminalInput); err != nil {
			r.log.Warn("terminal input failed", "err", err)
		}
	case *gen.DownstreamEnvelope_TerminalResize:
		if r.terminalHandler == nil {
			return
		}
		if err := r.terminalHandler.ResizeTerminal(action.TerminalResize); err != nil {
			r.log.Warn("terminal resize failed", "err", err)
		}
	case *gen.DownstreamEnvelope_BackupTask:
		task := action.BackupTask
		go func() {
			var size int64
			var runErr error
			if bh, ok := r.handler.(interface {
				RunBackup(context.Context, string, string) (int64, error)
			}); ok {
				size, runErr = bh.RunBackup(ctx, task.GetServiceId(), task.GetBackupId())
			} else {
				runErr = fmt.Errorf("backup not supported")
			}
			errMsg := ""
			if runErr != nil {
				errMsg = runErr.Error()
			}
			if err := r.sender.SendBackupResult(task.GetBackupId(), runErr == nil, size, errMsg); err != nil {
				r.log.Warn("backup result send failed", "err", err)
			}
		}()
	default:
		r.log.Warn("unknown command", "command_id", cmdID)
		return
	}
}

func (r *Runner) replyCommand(commandID string, err error) {
	if err != nil {
		r.log.Warn("command failed", "command_id", commandID, "err", err)
		_ = r.sender.SendCommandResponse(commandID, false, err.Error())
		return
	}
	_ = r.sender.SendCommandResponse(commandID, true, "")
}

// nextBackoff doubles the current backoff, capped at max.
func nextBackoff(cur, max time.Duration) time.Duration {
	cur *= 2
	if cur > max {
		return max
	}
	return cur
}

// jitter applies up to +/-20% random jitter to avoid thundering-herd reconnects.
func jitter(d time.Duration) time.Duration {
	if d <= 0 {
		return d
	}
	delta := (rand.Float64()*0.4 - 0.2) * float64(d)
	return d + time.Duration(delta)
}
