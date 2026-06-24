// Package grpc implements the control-plane side of the agent link: a gRPC
// AgentController server that accepts one long-lived bidirectional stream per
// edge node, ingests telemetry into Redis Streams, and routes downstream
// command envelopes to the owning node.
package grpc

import (
	"errors"
	"sync"

	gen "github.com/nexus-control/packages/proto/gen"
)

// ErrAgentOffline is returned when a command is routed to a node that has no
// active gRPC stream registered.
var ErrAgentOffline = errors.New("agent offline: no active stream for node")

// agentConn represents a single connected agent (one per node). Downstream
// envelopes are delivered through sendCh and pumped onto the gRPC stream by the
// server's send goroutine, so callers never block on the network.
type agentConn struct {
	nodeID  string
	agentID string
	sendCh  chan *gen.DownstreamEnvelope
	done    chan struct{}
}

// Registry tracks the currently-connected agents and provides the API/worker a
// way to push DownstreamEnvelope commands to the node that owns a service.
//
// It is safe for concurrent use.
type Registry struct {
	mu     sync.RWMutex
	agents map[string]*agentConn // keyed by node id
}

// NewRegistry creates an empty agent registry.
func NewRegistry() *Registry {
	return &Registry{agents: make(map[string]*agentConn)}
}

// register adds (or replaces) the connection for a node. If a stale connection
// exists for the same node it is closed so the newest stream wins.
func (r *Registry) register(nodeID, agentID string) *agentConn {
	r.mu.Lock()
	defer r.mu.Unlock()

	if old, ok := r.agents[nodeID]; ok {
		close(old.done)
	}
	conn := &agentConn{
		nodeID:  nodeID,
		agentID: agentID,
		sendCh:  make(chan *gen.DownstreamEnvelope, 64),
		done:    make(chan struct{}),
	}
	r.agents[nodeID] = conn
	return conn
}

// unregister removes a node's connection, but only if it is still the active
// one (guards against a reconnect having already replaced it).
func (r *Registry) unregister(conn *agentConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cur, ok := r.agents[conn.nodeID]; ok && cur == conn {
		delete(r.agents, conn.nodeID)
	}
}

// Send routes a downstream command envelope to the agent owning nodeID.
// Returns ErrAgentOffline if the node has no active stream.
func (r *Registry) Send(nodeID string, env *gen.DownstreamEnvelope) error {
	r.mu.RLock()
	conn, ok := r.agents[nodeID]
	r.mu.RUnlock()
	if !ok {
		return ErrAgentOffline
	}
	select {
	case conn.sendCh <- env:
		return nil
	case <-conn.done:
		return ErrAgentOffline
	}
}

// Online reports whether a node currently has an active stream.
func (r *Registry) Online(nodeID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.agents[nodeID]
	return ok
}

// AgentID returns the connected agent id for a node, if online.
func (r *Registry) AgentID(nodeID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if conn, ok := r.agents[nodeID]; ok {
		return conn.agentID
	}
	return ""
}

// OnlineNodes returns the ids of all nodes with an active stream.
func (r *Registry) OnlineNodes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.agents))
	for id := range r.agents {
		ids = append(ids, id)
	}
	return ids
}
