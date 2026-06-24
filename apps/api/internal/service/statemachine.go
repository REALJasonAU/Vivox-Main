// Package service holds the control plane's core business logic: the service
// status state machine, template resolution, and the orchestration that turns
// REST/worker intents into agent commands and persisted status transitions.
package service

import (
	"errors"
	"fmt"

	"github.com/nexus-control/apps/api/internal/db"
)

// ErrIllegalTransition is returned when a status change is not permitted by the
// state machine (plan section 4).
var ErrIllegalTransition = errors.New("illegal service status transition")

// allowedTransitions encodes the server-enforced status state machine.
//
//	PROVISIONING -> STARTING | CRASHED
//	STARTING     -> RUNNING  | CRASHED | STOPPING
//	RUNNING      -> STOPPING | CRASHED
//	STOPPING     -> STOPPED  | CRASHED
//	STOPPED      -> PROVISIONING | STARTING        (redeploy / start)
//	CRASHED      -> PROVISIONING | STARTING        (recover / restart)
var allowedTransitions = map[db.ServiceStatus]map[db.ServiceStatus]bool{
	db.ServiceStatusPROVISIONING: {
		db.ServiceStatusSTARTING: true,
		db.ServiceStatusCRASHED:  true,
	},
	db.ServiceStatusSTARTING: {
		db.ServiceStatusRUNNING:  true,
		db.ServiceStatusSTOPPING: true,
		db.ServiceStatusCRASHED:  true,
	},
	db.ServiceStatusRUNNING: {
		db.ServiceStatusSTOPPING: true,
		db.ServiceStatusCRASHED:  true,
		// Restart: a running service may be cycled back through STARTING.
		db.ServiceStatusSTARTING: true,
	},
	db.ServiceStatusSTOPPING: {
		db.ServiceStatusSTOPPED: true,
		db.ServiceStatusCRASHED: true,
	},
	db.ServiceStatusSTOPPED: {
		db.ServiceStatusPROVISIONING: true,
		db.ServiceStatusSTARTING:     true,
	},
	db.ServiceStatusCRASHED: {
		db.ServiceStatusPROVISIONING: true,
		db.ServiceStatusSTARTING:     true,
	},
}

// transientStatuses are mid-flight states during which user-initiated control
// actions are rejected to prevent button-spam races (plan section 4).
var transientStatuses = map[db.ServiceStatus]bool{
	db.ServiceStatusPROVISIONING: true,
	db.ServiceStatusSTARTING:     true,
	db.ServiceStatusSTOPPING:     true,
}

// CanTransition reports whether from -> to is a legal status change.
func CanTransition(from, to db.ServiceStatus) bool {
	return allowedTransitions[from][to]
}

// ValidateTransition returns ErrIllegalTransition (wrapped with detail) when the
// change is not permitted.
func ValidateTransition(from, to db.ServiceStatus) error {
	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}
	return nil
}

// IsTransient reports whether a status is a mid-flight (controls-disabled) state.
func IsTransient(s db.ServiceStatus) bool { return transientStatuses[s] }
