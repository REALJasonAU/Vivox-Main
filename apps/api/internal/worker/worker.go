package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
)

// Processor handles deploy tasks: it records a deployment, dispatches the start
// command to the agent, and advances the service status machine.
type Processor struct {
	svc *service.Manager
	q   *db.Queries
	log *slog.Logger
}

// NewProcessor wires the deploy task handler.
func NewProcessor(svc *service.Manager, q *db.Queries, log *slog.Logger) *Processor {
	return &Processor{svc: svc, q: q, log: log}
}

// Run starts the asynq worker server and blocks until the context is cancelled.
func (p *Processor) Run(ctx context.Context, opt asynq.RedisClientOpt) error {
	srv := asynq.NewServer(opt, asynq.Config{
		Concurrency: 10,
		Queues:      map[string]int{"default": 1},
	})
	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeDeployService, p.handleDeploy)

	if err := srv.Start(mux); err != nil {
		return err
	}
	<-ctx.Done()
	srv.Shutdown()
	return nil
}

// handleDeploy resolves the service, records a deployment, pushes StartServiceTask
// to the owning node, and transitions PROVISIONING -> STARTING. On failure it
// records a failed deployment and moves the service to CRASHED.
func (p *Processor) handleDeploy(ctx context.Context, t *asynq.Task) error {
	var payload DeployServicePayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w: %w", err, asynq.SkipRetry)
	}
	id, err := service.ParseUUID(payload.ServiceID)
	if err != nil {
		return fmt.Errorf("bad service id: %w: %w", err, asynq.SkipRetry)
	}

	svc, err := p.q.GetService(ctx, id)
	if err != nil {
		return fmt.Errorf("load service: %w", err)
	}

	dep, err := p.q.CreateDeployment(ctx, db.CreateDeploymentParams{
		ServiceID: svc.ID,
		Status:    db.DeployStatusBuilding,
	})
	if err != nil {
		return fmt.Errorf("create deployment: %w", err)
	}

	if payload.ForceReinstall {
		if _, err := p.svc.SetStatus(ctx, payload.ActorID, svc.ID, db.ServiceStatusPROVISIONING); err != nil {
			p.log.Warn("transition to PROVISIONING failed", "err", err)
		}
	}

	if err := p.svc.DispatchStart(ctx, payload.ActorID, svc, service.StartOptions{
		ForceReinstall: payload.ForceReinstall,
	}); err != nil {
		p.log.Warn("deploy dispatch failed", "service_id", payload.ServiceID, "err", err)
		p.failDeployment(ctx, dep.ID, err)
		// Move the service to CRASHED so the UI reflects the failure.
		if _, terr := p.svc.SetStatus(ctx, payload.ActorID, svc.ID, db.ServiceStatusCRASHED); terr != nil {
			p.log.Warn("mark crashed failed", "err", terr)
		}
		return fmt.Errorf("dispatch start: %w", err)
	}

	if _, err := p.svc.SetStatus(ctx, payload.ActorID, svc.ID, db.ServiceStatusSTARTING); err != nil {
		p.log.Warn("transition to STARTING failed", "err", err)
	}
	if _, err := p.q.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{
		ID:     dep.ID,
		Status: db.DeployStatusSuccess,
	}); err != nil {
		p.log.Warn("update deployment success failed", "err", err)
	}
	p.log.Info("deploy dispatched", "service_id", payload.ServiceID)
	return nil
}

// failDeployment marks a deployment failed, stashing the error in logs_ref.
func (p *Processor) failDeployment(ctx context.Context, id pgtype.UUID, cause error) {
	msg := cause.Error()
	if _, err := p.q.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{
		ID:      id,
		Status:  db.DeployStatusFailed,
		LogsRef: &msg,
	}); err != nil {
		p.log.Warn("update deployment failed-status failed", "err", err)
	}
}
