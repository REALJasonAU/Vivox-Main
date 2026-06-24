package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/commands"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/packages/domain"
	gen "github.com/nexus-control/packages/proto/gen"
)

// Commander is the downstream command channel the Manager uses to reach an
// agent. It is satisfied by the gRPC Registry, keeping service logic decoupled
// from the transport (and free of an import cycle).
type Commander interface {
	Send(nodeID string, env *gen.DownstreamEnvelope) error
	Online(nodeID string) bool
}

// Common errors surfaced to the REST layer.
var (
	ErrServiceTransient = errors.New("service is in a transient state; controls disabled")
	ErrNodeOffline      = errors.New("assigned node is offline")
	ErrNoNode           = errors.New("service has no assigned node")
)

// StatusPublisher emits live status changes to the realtime bus.
type StatusPublisher interface {
	PublishStatus(ctx context.Context, serviceID, status string) error
}

// WebhookNotifier delivers outbound webhook events for service lifecycle changes.
type WebhookNotifier interface {
	FireStatusEvent(ctx context.Context, userID, serviceID, serviceName, event string, meta interface{})
}

// Manager is the control plane's service orchestrator. It owns status
type Manager struct {
	q         *db.Queries
	cmd       Commander
	templates map[string]*Template
	tracker   *commands.Tracker
	events    StatusPublisher
	notify    WebhookNotifier
}

// NewManager builds the orchestrator.
func NewManager(q *db.Queries, cmd Commander, templates map[string]*Template, tracker *commands.Tracker, events StatusPublisher, notify WebhookNotifier) *Manager {
	return &Manager{q: q, cmd: cmd, templates: templates, tracker: tracker, events: events, notify: notify}
}

// Templates returns the loaded template registry.
func (m *Manager) Templates() map[string]*Template { return m.templates }

// Template looks up a single template by id.
func (m *Manager) Template(id string) (*Template, bool) {
	t, ok := m.templates[id]
	return t, ok
}

// CreateServiceInput describes a new service to provision.
type CreateServiceInput struct {
	OwnerID string
	Name    string
	Type    db.ServiceType
	NodeID  pgtype.UUID
	Config  domain.ServiceConfig
	Limits  domain.ResourceLimits
}

// CreateService persists a new service row in PROVISIONING and writes an audit
// event. The caller is responsible for enqueuing the asynq deploy job.
func (m *Manager) CreateService(ctx context.Context, in CreateServiceInput) (db.Service, error) {
	svc, err := m.q.CreateService(ctx, db.CreateServiceParams{
		OwnerID:        in.OwnerID,
		Name:           in.Name,
		Type:           in.Type,
		Status:         db.ServiceStatusPROVISIONING,
		NodeID:         in.NodeID,
		ResourceLimits: in.Limits,
		Config:         in.Config,
	})
	if err != nil {
		return db.Service{}, err
	}
	m.audit(ctx, in.OwnerID, "service.create", "service", UUIDString(svc.ID), map[string]any{
		"name": in.Name, "type": string(in.Type),
	})
	return svc, nil
}

// StartService transitions a stopped/crashed service to STARTING and dispatches
// a StartServiceTask to the owning node.
func (m *Manager) StartService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error) {
	svc, err := m.q.GetService(ctx, id)
	if err != nil {
		return db.Service{}, err
	}
	if IsTransient(svc.Status) {
		return db.Service{}, ErrServiceTransient
	}
	if err := ValidateTransition(svc.Status, db.ServiceStatusSTARTING); err != nil {
		return db.Service{}, err
	}
	if err := m.dispatchTracked(ctx, actorID, svc.ID, svc.NodeID, commands.KindStart, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_Start{Start: buildStartTask(svc)},
	}); err != nil {
		return db.Service{}, err
	}
	return m.transition(ctx, actorID, svc, db.ServiceStatusSTARTING, "service.start")
}

// StopService transitions a starting/running service to STOPPING and dispatches
// a StopServiceTask.
func (m *Manager) StopService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error) {
	svc, err := m.q.GetService(ctx, id)
	if err != nil {
		return db.Service{}, err
	}
	if IsTransient(svc.Status) {
		return db.Service{}, ErrServiceTransient
	}
	if err := ValidateTransition(svc.Status, db.ServiceStatusSTOPPING); err != nil {
		return db.Service{}, err
	}
	if err := m.dispatchTracked(ctx, actorID, svc.ID, svc.NodeID, commands.KindStop, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_Stop{Stop: &gen.StopServiceTask{ServiceId: UUIDString(svc.ID), TimeoutSeconds: 30}},
	}); err != nil {
		return db.Service{}, err
	}
	return m.transition(ctx, actorID, svc, db.ServiceStatusSTOPPING, "service.stop")
}

// RestartService cycles a running service: a stop task immediately followed by a
// fresh start task, landing the service back in STARTING.
func (m *Manager) RestartService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error) {
	svc, err := m.q.GetService(ctx, id)
	if err != nil {
		return db.Service{}, err
	}
	if IsTransient(svc.Status) {
		return db.Service{}, ErrServiceTransient
	}
	if err := ValidateTransition(svc.Status, db.ServiceStatusSTARTING); err != nil {
		return db.Service{}, err
	}
	nodeID := UUIDString(svc.NodeID)
	if !svc.NodeID.Valid {
		return db.Service{}, ErrNoNode
	}
	if !m.cmd.Online(nodeID) {
		return db.Service{}, ErrNodeOffline
	}
	_ = m.dispatchTracked(ctx, actorID, svc.ID, svc.NodeID, commands.KindStop, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_Stop{Stop: &gen.StopServiceTask{ServiceId: UUIDString(svc.ID), TimeoutSeconds: 30}},
	})
	if err := m.dispatchTracked(ctx, actorID, svc.ID, svc.NodeID, commands.KindStart, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_Start{Start: buildStartTask(svc)},
	}); err != nil {
		return db.Service{}, err
	}
	return m.transition(ctx, actorID, svc, db.ServiceStatusSTARTING, "service.restart")
}

// DeleteService removes a service row after best-effort stopping its container
// on the owning node (when online). If the node is offline the row is still
// deleted; the stateless agent reconciles orphaned containers by label on its
// next reconnect. Ownership/authorization is enforced by the REST layer.
func (m *Manager) DeleteService(ctx context.Context, actorID string, id pgtype.UUID) error {
	svc, err := m.q.GetService(ctx, id)
	if err != nil {
		return err
	}
	if svc.NodeID.Valid && m.cmd.Online(UUIDString(svc.NodeID)) {
		_ = m.cmd.Send(UUIDString(svc.NodeID), &gen.DownstreamEnvelope{
			CommandId: newCommandID(),
			Action:    &gen.DownstreamEnvelope_Stop{Stop: &gen.StopServiceTask{ServiceId: UUIDString(svc.ID), TimeoutSeconds: 15}},
		})
	}
	if err := m.q.DeleteService(ctx, id); err != nil {
		return err
	}
	m.audit(ctx, actorID, "service.delete", "service", UUIDString(svc.ID), map[string]any{"name": svc.Name})
	return nil
}

// SetStatus performs a validated status transition without dispatching a
// command. Used by the deploy worker to drive PROVISIONING -> STARTING -> ...
func (m *Manager) SetStatus(ctx context.Context, actorID string, id pgtype.UUID, to db.ServiceStatus) (db.Service, error) {
	svc, err := m.q.GetService(ctx, id)
	if err != nil {
		return db.Service{}, err
	}
	return m.transition(ctx, actorID, svc, to, "service.status")
}

// DispatchStart sends a StartServiceTask for an already-persisted service
// (used by the deploy worker after the row is created in PROVISIONING).
func (m *Manager) DispatchStart(ctx context.Context, actorID string, svc db.Service) error {
	return m.dispatchTracked(ctx, actorID, svc.ID, svc.NodeID, commands.KindStart, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_Start{Start: buildStartTask(svc)},
	})
}

// HandleCommandOutcome applies agent command acknowledgements to the status
// machine and publishes live status updates.
func (m *Manager) HandleCommandOutcome(ctx context.Context, pending commands.Pending, success bool, errMsg string) {
	svc, err := m.q.GetService(ctx, pending.ServiceID)
	if err != nil {
		return
	}
	actor := pending.ActorID
	if actor == "" {
		actor = "system"
	}

	if !success {
		updated, terr := m.transition(ctx, actor, svc, db.ServiceStatusCRASHED, "service.crashed")
		if terr == nil {
			m.publishStatus(ctx, updated)
			m.fireWebhook(ctx, updated, "crash", nil)
		}
		return
	}

	var target db.ServiceStatus
	var ok bool
	switch pending.Kind {
	case commands.KindStart:
		if svc.Status == db.ServiceStatusPROVISIONING || svc.Status == db.ServiceStatusSTARTING {
			target = db.ServiceStatusRUNNING
			ok = true
		}
	case commands.KindStop:
		if svc.Status == db.ServiceStatusSTOPPING {
			target = db.ServiceStatusSTOPPED
			ok = true
		}
	default:
		return
	}
	if !ok {
		return
	}
	updated, terr := m.transition(ctx, actor, svc, target, "service."+string(pending.Kind)+".ack")
	if terr == nil {
		m.publishStatus(ctx, updated)
		switch target {
		case db.ServiceStatusRUNNING:
			m.fireWebhook(ctx, updated, "running", nil)
		case db.ServiceStatusSTOPPED:
			m.fireWebhook(ctx, updated, "stopped", nil)
		}
	}
}

// transition validates from->to, persists the new status, and audits it.
func (m *Manager) transition(ctx context.Context, actorID string, svc db.Service, to db.ServiceStatus, action string) (db.Service, error) {
	if err := ValidateTransition(svc.Status, to); err != nil {
		return db.Service{}, err
	}
	updated, err := m.q.UpdateServiceStatus(ctx, db.UpdateServiceStatusParams{ID: svc.ID, Status: to})
	if err != nil {
		return db.Service{}, err
	}
	m.audit(ctx, actorID, action, "service", UUIDString(svc.ID), map[string]any{
		"from": string(svc.Status), "to": string(to),
	})
	m.publishStatus(ctx, updated)
	return updated, nil
}

func (m *Manager) publishStatus(ctx context.Context, svc db.Service) {
	if m.events == nil {
		return
	}
	_ = m.events.PublishStatus(ctx, UUIDString(svc.ID), string(svc.Status))
}

func (m *Manager) fireWebhook(ctx context.Context, svc db.Service, event string, meta interface{}) {
	if m.notify == nil {
		return
	}
	m.notify.FireStatusEvent(ctx, svc.OwnerID, UUIDString(svc.ID), svc.Name, event, meta)
}

// dispatchTracked sends a downstream command and registers it for agent acks.
func (m *Manager) dispatchTracked(ctx context.Context, actorID string, serviceID, nodeID pgtype.UUID, kind commands.Kind, env *gen.DownstreamEnvelope) error {
	cmdID := newCommandID()
	env.CommandId = cmdID
	if m.tracker != nil && serviceID.Valid {
		m.tracker.Track(cmdID, commands.Pending{
			ServiceID: serviceID,
			Kind:      kind,
			ActorID:   actorID,
		})
	}
	return m.dispatch(nodeID, env)
}

// dispatch sends a command to the node owning the service, guarding for an
// unassigned or offline node.
func (m *Manager) dispatch(nodeID pgtype.UUID, env *gen.DownstreamEnvelope) error {
	if !nodeID.Valid {
		return ErrNoNode
	}
	id := UUIDString(nodeID)
	if !m.cmd.Online(id) {
		return ErrNodeOffline
	}
	if err := m.cmd.Send(id, env); err != nil {
		return fmt.Errorf("dispatch to node %s: %w", id, err)
	}
	return nil
}

// audit writes an audit_events row, best-effort (mutations should not fail
// because audit logging hiccuped, but the error is surfaced for visibility).
func (m *Manager) audit(ctx context.Context, actorID, action, targetType, targetID string, metadata map[string]any) {
	var raw []byte
	if metadata != nil {
		raw, _ = json.Marshal(metadata)
	}
	_ = m.q.InsertAuditEvent(ctx, db.InsertAuditEventParams{
		ActorID:    actorID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Metadata:   raw,
	})
}

// Audit exposes audit logging to the REST layer for non-service mutations
// (e.g. node registration).
func (m *Manager) Audit(ctx context.Context, actorID, action, targetType, targetID string, metadata map[string]any) {
	m.audit(ctx, actorID, action, targetType, targetID, metadata)
}

// buildStartTask projects a persisted service into a StartServiceTask.
func buildStartTask(svc db.Service) *gen.StartServiceTask {
	task := &gen.StartServiceTask{
		ServiceId:        UUIDString(svc.ID),
		ContainerImage:   svc.Config.Image,
		PortBindings:     svc.Config.Ports,
		EnvVars:          svc.Config.Environment,
		MemoryLimitBytes: svc.ResourceLimits.MemoryMB * 1024 * 1024,
	}
	if hc := svc.Config.HealthCheck; hc != nil && hc.Path != "" && hc.Port > 0 {
		task.HealthPath = hc.Path
		task.HealthPort = int32(hc.Port)
		interval := hc.Interval
		if interval <= 0 {
			interval = 30
		}
		timeout := hc.Timeout
		if timeout <= 0 {
			timeout = 5
		}
		task.HealthIntervalSec = int32(interval)
		task.HealthTimeoutSec = int32(timeout)
	}
	return task
}

func newCommandID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ParseUUID parses a canonical UUID string into a pgtype.UUID.
func ParseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

// UUIDString renders a pgtype.UUID as its canonical 8-4-4-4-12 form ("" if null).
func UUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	const hexd = "0123456789abcdef"
	buf := make([]byte, 36)
	j := 0
	for i := 0; i < 16; i++ {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			buf[j] = '-'
			j++
		}
		buf[j] = hexd[u.Bytes[i]>>4]
		buf[j+1] = hexd[u.Bytes[i]&0x0f]
		j += 2
	}
	return string(buf)
}
