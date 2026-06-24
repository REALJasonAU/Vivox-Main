package client

import (
	"errors"
	"sync"
	"time"

	gen "github.com/nexus-control/packages/proto/gen"
)

// ErrNotConnected is returned by Sender methods when there is no live stream.
// Callers (log/metric pumps) treat this as a transient drop: the agent is
// stateless and the control plane re-reconciles on reconnect, so dropping a
// few frames mid-reconnect is acceptable.
var ErrNotConnected = errors.New("agent stream not connected")

// Stream is the minimal surface of the generated bidirectional
// AgentController.ConnectStream client that the agent uses. Declaring it here
// (rather than referencing the generated stream type by name) keeps the agent
// resilient to grpc-go codegen changes across versions — both the classic
// AgentController_ConnectStreamClient and the newer generic
// grpc.BidiStreamingClient satisfy it.
type Stream interface {
	Send(*gen.UpstreamEnvelope) error
	Recv() (*gen.DownstreamEnvelope, error)
}

// Sender is the thread-safe upstream multiplexer. The heartbeat loop, the
// command-response path, and every per-container log/metric pump funnel their
// UpstreamEnvelopes through a single Sender so writes to the underlying gRPC
// stream are serialized (grpc client streams are not safe for concurrent
// SendMsg). The live stream is swapped in/out by the reconnect loop; while
// disconnected, sends fail fast with ErrNotConnected.
type Sender struct {
	agentID string

	mu     sync.Mutex
	stream Stream
}

// NewSender creates a Sender stamped with the given agent id. It starts with no
// stream attached.
func NewSender(agentID string) *Sender {
	return &Sender{agentID: agentID}
}

// setStream attaches (or, with nil, detaches) the active stream.
func (s *Sender) setStream(st Stream) {
	s.mu.Lock()
	s.stream = st
	s.mu.Unlock()
}

// send serializes a single envelope onto the active stream.
func (s *Sender) send(env *gen.UpstreamEnvelope) error {
	env.AgentId = s.agentID
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stream == nil {
		return ErrNotConnected
	}
	return s.stream.Send(env)
}

// SendHeartbeat emits a Heartbeat frame with the current timestamp.
func (s *Sender) SendHeartbeat(status string, info *gen.SystemInfo) error {
	hb := &gen.Heartbeat{
		Timestamp: time.Now().Unix(),
		Status:    status,
	}
	if info != nil {
		hb.SystemInfo = info
	}
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_Heartbeat{
			Heartbeat: hb,
		},
	})
}

// SendLog emits a LogChunk frame for a service's stdout/stderr. streamType is
// "stdout" or "stderr". Implements the exec package's log-sink contract.
func (s *Sender) SendLog(serviceID string, data []byte, streamType string) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_Logs{
			Logs: &gen.LogChunk{
				ServiceId:  serviceID,
				Data:       data,
				StreamType: streamType,
			},
		},
	})
}

// SendMetric emits a MetricSnapshot frame. Implements the metrics package's
// sink contract. diskBytes is reported as 0 in Phase 1 (not collected).
func (s *Sender) SendMetric(serviceID string, cpuPercent float64, memBytes uint64) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_Metrics{
			Metrics: &gen.MetricSnapshot{
				ServiceId:       serviceID,
				CpuUsagePercent: cpuPercent,
				MemoryBytesUsed: memBytes,
			},
		},
	})
}

// SendHealthCheck emits a HealthCheckResult frame upstream.
func (s *Sender) SendHealthCheck(serviceID string, healthy bool, statusCode int, latencyMs int64, errMsg string, intervalSec int32) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_HealthCheckResult{
			HealthCheckResult: &gen.HealthCheckResult{
				ServiceId:   serviceID,
				Healthy:     healthy,
				StatusCode:  int32(statusCode),
				LatencyMs:   latencyMs,
				Error:       errMsg,
				IntervalSec: intervalSec,
			},
		},
	})
}

// SendBackupResult reports backup completion upstream.
func (s *Sender) SendBackupResult(backupID string, success bool, sizeBytes int64, errMsg string) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_BackupResult{
			BackupResult: &gen.BackupResult{
				BackupId:  backupID,
				Success:   success,
				SizeBytes: sizeBytes,
				Error:     errMsg,
			},
		},
	})
}

// SendCommandResponse acknowledges a downstream command back to the control
// plane, reporting success or the failure reason.
func (s *Sender) SendCommandResponse(commandID string, success bool, errMsg string) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_Response{
			Response: &gen.CommandResponse{
				CommandId:    commandID,
				Success:      success,
				ErrorMessage: errMsg,
			},
		},
	})
}

// SendFileListResult returns directory listing results for a file command.
func (s *Sender) SendFileListResult(commandID, serviceID, path string, entries []*gen.FileEntry, errMsg string) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_FileList{
			FileList: &gen.FileListResult{
				CommandId: commandID,
				ServiceId: serviceID,
				Path:      path,
				Entries:   entries,
				Error:     errMsg,
			},
		},
	})
}

// SendFileReadResult returns file read results for a file command.
func (s *Sender) SendFileReadResult(commandID, serviceID, path string, content []byte, errMsg string) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_FileRead{
			FileRead: &gen.FileReadResult{
				CommandId: commandID,
				ServiceId: serviceID,
				Path:      path,
				Content:   content,
				Error:     errMsg,
			},
		},
	})
}

// SendTerminalOutput streams interactive terminal output upstream.
func (s *Sender) SendTerminalOutput(serviceID, sessionID string, data []byte, closed bool) error {
	return s.send(&gen.UpstreamEnvelope{
		Payload: &gen.UpstreamEnvelope_TerminalOutput{
			TerminalOutput: &gen.TerminalOutput{
				ServiceId: serviceID,
				SessionId: sessionID,
				Data:      data,
				Closed:    closed,
			},
		},
	})
}
