package cron

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nexus-control/apps/api/internal/db"
)

// ServiceManager runs lifecycle actions for scheduled tasks.
type ServiceManager interface {
	StartService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error)
	StopService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error)
	RestartService(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error)
}

// Runner polls due scheduled tasks and dispatches their actions.
type Runner struct {
	q   *db.Queries
	mgr ServiceManager
	log *slog.Logger
}

// NewRunner creates a cron task runner.
func NewRunner(q *db.Queries, mgr ServiceManager, log *slog.Logger) *Runner {
	return &Runner{q: q, mgr: mgr, log: log}
}

// Start runs the polling loop until ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.tick(ctx)
		}
	}
}

func (r *Runner) tick(ctx context.Context) {
	tasks, err := r.q.ListDueScheduledTasks(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		r.log.Warn("cron tick query", "err", err)
		return
	}
	for _, task := range tasks {
		go r.runTask(ctx, task)
	}
}

func (r *Runner) runTask(ctx context.Context, task db.ScheduledTask) {
	if _, err := r.q.UpdateScheduledTaskRunning(ctx, task.ID); err != nil {
		r.log.Warn("cron mark running", "task", task.ID, "err", err)
		return
	}

	var runErr error
	switch task.Action {
	case "start":
		_, runErr = r.mgr.StartService(ctx, task.OwnerID, task.ServiceID)
	case "stop":
		_, runErr = r.mgr.StopService(ctx, task.OwnerID, task.ServiceID)
	case "restart":
		_, runErr = r.mgr.RestartService(ctx, task.OwnerID, task.ServiceID)
	default:
		runErr = fmt.Errorf("unknown action %q", task.Action)
	}

	result := "ok"
	if runErr != nil {
		result = "failed: " + runErr.Error()
		r.log.Warn("cron task failed", "task", task.ID, "action", task.Action, "err", runErr)
	}

	next := Next(task.CronExpr, time.Now())
	if next.IsZero() {
		next = time.Now().Add(time.Hour)
	}

	_, err := r.q.UpdateScheduledTaskDone(ctx, db.UpdateScheduledTaskDoneParams{
		ID:         task.ID,
		LastResult: &result,
		NextRunAt:  pgtype.Timestamptz{Time: next, Valid: true},
	})
	if err != nil {
		r.log.Warn("cron mark done", "task", task.ID, "err", err)
	}
}
