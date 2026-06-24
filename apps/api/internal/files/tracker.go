package files

import (
	"sync"
	"time"

	gen "github.com/nexus-control/packages/proto/gen"
)

// Result is the unified async outcome for a file list, read, or write command.
type Result struct {
	Entries         []*gen.FileEntry
	Content         []byte
	Error           string
	CommandResponse bool
	Success         bool
}

// Tracker maps command_id -> waiter channel for file operation results.
type Tracker struct {
	mu      sync.Mutex
	pending map[string]chan Result
}

// NewTracker creates an empty file result tracker.
func NewTracker() *Tracker {
	return &Tracker{pending: make(map[string]chan Result)}
}

// Expect registers a waiter for commandID. The channel receives at most one result.
func (t *Tracker) Expect(commandID string) <-chan Result {
	ch := make(chan Result, 1)
	t.mu.Lock()
	t.pending[commandID] = ch
	t.mu.Unlock()
	return ch
}

// Resolve delivers a result to the waiter and removes the pending entry.
func (t *Tracker) Resolve(commandID string, result Result) {
	t.mu.Lock()
	ch, ok := t.pending[commandID]
	if ok {
		delete(t.pending, commandID)
	}
	t.mu.Unlock()
	if ok {
		ch <- result
	}
}

// TryResolveCommand resolves a pending write/command waiter. Returns true if handled.
func (t *Tracker) TryResolveCommand(commandID string, success bool, errMsg string) bool {
	t.mu.Lock()
	ch, ok := t.pending[commandID]
	if ok {
		delete(t.pending, commandID)
	}
	t.mu.Unlock()
	if !ok {
		return false
	}
	ch <- Result{CommandResponse: true, Success: success, Error: errMsg}
	return true
}

// Cancel removes a pending waiter without delivering a result.
func (t *Tracker) Cancel(commandID string) {
	t.mu.Lock()
	ch, ok := t.pending[commandID]
	if ok {
		delete(t.pending, commandID)
	}
	t.mu.Unlock()
	if ok {
		close(ch)
	}
}

// Wait reads from ch until a result arrives or the timeout elapses.
func Wait(ch <-chan Result, timeout time.Duration) (Result, bool) {
	select {
	case r, ok := <-ch:
		return r, ok
	case <-time.After(timeout):
		return Result{}, false
	}
}
