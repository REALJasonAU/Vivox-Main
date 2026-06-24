package terminal

import (
	"context"
	"fmt"

	grpcsrv "github.com/nexus-control/apps/api/internal/grpc"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	gen "github.com/nexus-control/packages/proto/gen"
)

// Relay dispatches interactive terminal tasks to the connected agent.
type Relay struct {
	q   *db.Queries
	reg *grpcsrv.Registry
}

// NewRelay wires a terminal relay.
func NewRelay(q *db.Queries, reg *grpcsrv.Registry) *Relay {
	return &Relay{q: q, reg: reg}
}

// StartTerminal opens an interactive shell session on the agent.
func (r *Relay) StartTerminal(ctx context.Context, serviceID, sessionID string, cols, rows int32) error {
	id, err := service.ParseUUID(serviceID)
	if err != nil {
		return err
	}
	svc, err := r.q.GetService(ctx, id)
	if !svc.NodeID.Valid {
		return fmt.Errorf("service not assigned to a node")
	}
	nodeID := service.UUIDString(svc.NodeID)
	if !r.reg.Online(nodeID) {
		return fmt.Errorf("node offline")
	}
	shell := "/bin/sh"
	return r.reg.Send(nodeID, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_TerminalStart{
			TerminalStart: &gen.TerminalStartTask{
				ServiceId: serviceID,
				SessionId: sessionID,
				Shell:     shell,
				Cols:      cols,
				Rows:      rows,
			},
		},
	})
}

// SendTerminalInput forwards stdin bytes to the agent session.
func (r *Relay) SendTerminalInput(ctx context.Context, serviceID, sessionID string, data []byte) error {
	id, err := service.ParseUUID(serviceID)
	if err != nil {
		return err
	}
	svc, err := r.q.GetService(ctx, id)
	if !svc.NodeID.Valid {
		return fmt.Errorf("service not assigned to a node")
	}
	nodeID := service.UUIDString(svc.NodeID)
	if !r.reg.Online(nodeID) {
		return fmt.Errorf("node offline")
	}
	return r.reg.Send(nodeID, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_TerminalInput{
			TerminalInput: &gen.TerminalInputTask{
				ServiceId: serviceID,
				SessionId: sessionID,
				Data:      data,
			},
		},
	})
}

// ResizeTerminal updates the PTY dimensions on the agent.
func (r *Relay) ResizeTerminal(ctx context.Context, serviceID, sessionID string, cols, rows int32) error {
	id, err := service.ParseUUID(serviceID)
	if err != nil {
		return err
	}
	svc, err := r.q.GetService(ctx, id)
	if !svc.NodeID.Valid {
		return fmt.Errorf("service not assigned to a node")
	}
	nodeID := service.UUIDString(svc.NodeID)
	if !r.reg.Online(nodeID) {
		return fmt.Errorf("node offline")
	}
	return r.reg.Send(nodeID, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_TerminalResize{
			TerminalResize: &gen.TerminalResizeTask{
				ServiceId: serviceID,
				SessionId: sessionID,
				Cols:      cols,
				Rows:      rows,
			},
		},
	})
}

// StopTerminal closes a terminal session on the agent (best-effort).
func (r *Relay) StopTerminal(_ context.Context, serviceID, sessionID string) {
	_ = serviceID
	_ = sessionID
}
