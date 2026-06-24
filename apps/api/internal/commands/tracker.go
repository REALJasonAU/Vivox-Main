package commands

import (
	"sync"

	"github.com/jackc/pgx/v5/pgtype"
)

// Kind identifies why a downstream command was sent.
type Kind string

const (
	KindStart  Kind = "start"
	KindStop   Kind = "stop"
	KindUpdate Kind = "update"
)

// Pending records the service a command_id was issued for.
type Pending struct {
	ServiceID pgtype.UUID
	Kind      Kind
	ActorID   string
}

// Tracker maps command_id -> pending command until the agent acks.
type Tracker struct {
	mu      sync.RWMutex
	pending map[string]Pending
}

// NewTracker creates an empty command tracker.
func NewTracker() *Tracker {
	return &Tracker{pending: make(map[string]Pending)}
}

// Track registers a command_id before it is sent downstream.
func (t *Tracker) Track(commandID string, p Pending) {
	if commandID == "" {
		return
	}
	t.mu.Lock()
	t.pending[commandID] = p
	t.mu.Unlock()
}

// Resolve removes and returns the pending entry for a command_id.
func (t *Tracker) Resolve(commandID string) (Pending, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	p, ok := t.pending[commandID]
	if ok {
		delete(t.pending, commandID)
	}
	return p, ok
}
