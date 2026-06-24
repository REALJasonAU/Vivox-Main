package exec

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"

	gen "github.com/nexus-control/packages/proto/gen"
)

const (
	labelManagedBy = "managed-by"
	labelService   = "nexus.service_id"
	managedByValue = "nexus-agent"
)

// OutputSender streams terminal output upstream.
type OutputSender interface {
	SendTerminalOutput(serviceID, sessionID string, data []byte, closed bool) error
}

// Manager owns interactive PTY sessions keyed by session ID.
type Manager struct {
	cli    *client.Client
	sender OutputSender
	mu     sync.Mutex
	active map[string]*TerminalSession
}

// NewManager creates a terminal session manager.
func NewManager(cli *client.Client, sender OutputSender) *Manager {
	return &Manager{
		cli:    cli,
		sender: sender,
		active: make(map[string]*TerminalSession),
	}
}

// Start begins a new interactive shell session.
func (m *Manager) Start(ctx context.Context, t *gen.TerminalStartTask) error {
	if t == nil {
		return fmt.Errorf("nil terminal start task")
	}
	shell := t.GetShell()
	if shell == "" {
		shell = "/bin/sh"
	}
	ts := &TerminalSession{
		serviceID: t.GetServiceId(),
		sessionID: t.GetSessionId(),
		shell:     shell,
		cols:      t.GetCols(),
		rows:      t.GetRows(),
		stdinCh:   make(chan []byte, 32),
		sender:    m.sender,
		cli:       m.cli,
	}
	m.mu.Lock()
	if old, ok := m.active[t.GetSessionId()]; ok {
		old.Stop()
	}
	m.active[t.GetSessionId()] = ts
	m.mu.Unlock()
	go ts.Start(ctx)
	return nil
}

// Input routes stdin bytes to an active session.
func (m *Manager) Input(t *gen.TerminalInputTask) error {
	m.mu.Lock()
	ts, ok := m.active[t.GetSessionId()]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("terminal session %s not found", t.GetSessionId())
	}
	select {
	case ts.stdinCh <- append([]byte(nil), t.GetData()...):
		return nil
	default:
		return fmt.Errorf("terminal stdin buffer full")
	}
}

// Resize updates PTY dimensions for a session.
func (m *Manager) Resize(t *gen.TerminalResizeTask) error {
	m.mu.Lock()
	ts, ok := m.active[t.GetSessionId()]
	m.mu.Unlock()
	if !ok || ts.execID == "" {
		return nil
	}
	return m.cli.ContainerExecResize(context.Background(), ts.execID, container.ResizeOptions{
		Height: uint(t.GetRows()),
		Width:  uint(t.GetCols()),
	})
}

// Stop tears down a session.
func (m *Manager) Stop(sessionID string) {
	m.mu.Lock()
	ts, ok := m.active[sessionID]
	if ok {
		delete(m.active, sessionID)
	}
	m.mu.Unlock()
	if ok {
		ts.Stop()
	}
}

// TerminalSession manages one interactive docker exec PTY session.
type TerminalSession struct {
	serviceID string
	sessionID string
	shell     string
	cols      int32
	rows      int32
	execID    string
	sender    OutputSender
	stdinCh   chan []byte
	cli       *client.Client
	stopOnce  sync.Once
	cancel    context.CancelFunc
}

// Start opens docker exec with TTY, streams output upstream, reads stdin from stdinCh.
func (ts *TerminalSession) Start(ctx context.Context) {
	ctx, ts.cancel = context.WithCancel(ctx)
	containerID, err := findContainer(ctx, ts.cli, ts.serviceID)
	if err != nil || containerID == "" {
		_ = ts.sender.SendTerminalOutput(ts.serviceID, ts.sessionID, nil, true)
		return
	}
	execID, err := ts.cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          []string{ts.shell},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
	})
	if err != nil {
		_ = ts.sender.SendTerminalOutput(ts.serviceID, ts.sessionID, nil, true)
		return
	}
	ts.execID = execID.ID
	if ts.cols > 0 && ts.rows > 0 {
		_ = ts.cli.ContainerExecResize(ctx, ts.execID, container.ResizeOptions{
			Height: uint(ts.rows),
			Width:  uint(ts.cols),
		})
	}
	resp, err := ts.cli.ContainerExecAttach(ctx, ts.execID, container.ExecStartOptions{Tty: true})
	if err != nil {
		_ = ts.sender.SendTerminalOutput(ts.serviceID, ts.sessionID, nil, true)
		return
	}
	defer resp.Close()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := resp.Reader.Read(buf)
			if n > 0 {
				_ = ts.sender.SendTerminalOutput(ts.serviceID, ts.sessionID, append([]byte(nil), buf[:n]...), false)
			}
			if err != nil {
				break
			}
		}
		_ = ts.sender.SendTerminalOutput(ts.serviceID, ts.sessionID, nil, true)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ts.stdinCh:
			if !ok {
				return
			}
			if len(data) > 0 {
				_, _ = resp.Conn.Write(data)
			}
		}
	}
}

// Stop cancels the session.
func (ts *TerminalSession) Stop() {
	ts.stopOnce.Do(func() {
		if ts.cancel != nil {
			ts.cancel()
		}
		close(ts.stdinCh)
	})
}

func findContainer(ctx context.Context, cli *client.Client, serviceID string) (string, error) {
	list, err := cli.ContainerList(ctx, container.ListOptions{
		All: true,
		Filters: filters.NewArgs(
			filters.Arg("label", labelManagedBy+"="+managedByValue),
			filters.Arg("label", labelService+"="+serviceID),
		),
	})
	if err != nil {
		return "", err
	}
	if len(list) == 0 {
		return "", nil
	}
	return list[0].ID, nil
}

// TerminalAdapter wraps Manager for client.TerminalHandler.
type TerminalAdapter struct {
	*Manager
	cli *client.Client
}

// NewTerminalManager creates a docker-backed terminal handler.
func NewTerminalManager(sender OutputSender) (*TerminalAdapter, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &TerminalAdapter{
		Manager: NewManager(cli, sender),
		cli:     cli,
	}, nil
}

// Close releases the Docker client.
func (a *TerminalAdapter) Close() error {
	if a.cli != nil {
		return a.cli.Close()
	}
	return nil
}

// StartTerminal implements client.TerminalHandler.
func (a *TerminalAdapter) StartTerminal(ctx context.Context, t *gen.TerminalStartTask) error {
	return a.Manager.Start(ctx, t)
}

// SendTerminalInput implements client.TerminalHandler.
func (a *TerminalAdapter) SendTerminalInput(t *gen.TerminalInputTask) error {
	return a.Manager.Input(t)
}

// ResizeTerminal implements client.TerminalHandler.
func (a *TerminalAdapter) ResizeTerminal(t *gen.TerminalResizeTask) error {
	return a.Manager.Resize(t)
}

// StopTerminal implements client.TerminalHandler.
func (a *TerminalAdapter) StopTerminal(sessionID string) {
	a.Manager.Stop(sessionID)
}

type MockManager struct {
	sender OutputSender
	mu     sync.Mutex
	active map[string]chan []byte
}

// NewMockManager creates a mock terminal manager.
func NewMockManager(sender OutputSender) *MockManager {
	return &MockManager{sender: sender, active: make(map[string]chan []byte)}
}

// Start implements terminal start for mock mode.
func (m *MockManager) Start(_ context.Context, t *gen.TerminalStartTask) error {
	ch := make(chan []byte, 32)
	m.mu.Lock()
	m.active[t.GetSessionId()] = ch
	m.mu.Unlock()
	_ = m.sender.SendTerminalOutput(t.GetServiceId(), t.GetSessionId(), []byte("$ "), false)
	go func() {
		for data := range ch {
			_ = m.sender.SendTerminalOutput(t.GetServiceId(), t.GetSessionId(), data, false)
			_ = m.sender.SendTerminalOutput(t.GetServiceId(), t.GetSessionId(), []byte("\r\n$ "), false)
		}
	}()
	return nil
}

// Input implements mock stdin.
func (m *MockManager) Input(t *gen.TerminalInputTask) error {
	m.mu.Lock()
	ch, ok := m.active[t.GetSessionId()]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session not found")
	}
	ch <- append([]byte(nil), t.GetData()...)
	return nil
}

// Resize is a no-op in mock mode.
func (m *MockManager) Resize(_ *gen.TerminalResizeTask) error { return nil }

// Stop closes a mock session.
func (m *MockManager) Stop(sessionID string) {
	m.mu.Lock()
	ch, ok := m.active[sessionID]
	if ok {
		delete(m.active, sessionID)
	}
	m.mu.Unlock()
	if ok {
		close(ch)
	}
}

// StartTerminal implements client.TerminalHandler for mock mode.
func (m *MockManager) StartTerminal(ctx context.Context, t *gen.TerminalStartTask) error {
	return m.Start(ctx, t)
}

// SendTerminalInput implements client.TerminalHandler for mock mode.
func (m *MockManager) SendTerminalInput(t *gen.TerminalInputTask) error {
	return m.Input(t)
}

// ResizeTerminal implements client.TerminalHandler for mock mode.
func (m *MockManager) ResizeTerminal(t *gen.TerminalResizeTask) error {
	return m.Resize(t)
}

// StopTerminal implements client.TerminalHandler for mock mode.
func (m *MockManager) StopTerminal(sessionID string) {
	m.Stop(sessionID)
}

// Ensure io usage for attach reader.
var _ = io.EOF
