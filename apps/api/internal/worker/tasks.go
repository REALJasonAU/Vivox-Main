// Package worker implements the asynq-backed deploy pipeline: enqueue a deploy
// job when a service is created, then (on a worker) resolve the service, record
// a deployment, push the StartServiceTask to the owning agent, and drive the
// status state machine forward (plan section 9).
package worker

import (
	"context"
	"encoding/json"

	"github.com/hibiken/asynq"
)

// TypeDeployService is the asynq task type for a service deploy.
const TypeDeployService = "deploy:service"

// DeployServicePayload is the JSON body of a deploy task.
type DeployServicePayload struct {
	ServiceID string `json:"service_id"`
	ActorID   string `json:"actor_id"`
}

// NewDeployServiceTask builds an asynq task for the given service.
func NewDeployServiceTask(serviceID, actorID string) (*asynq.Task, error) {
	payload, err := json.Marshal(DeployServicePayload{ServiceID: serviceID, ActorID: actorID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypeDeployService, payload), nil
}

// Enqueuer publishes deploy jobs onto the asynq queue.
type Enqueuer struct {
	client *asynq.Client
}

// NewEnqueuer constructs an Enqueuer against the given Redis broker.
func NewEnqueuer(opt asynq.RedisClientOpt) *Enqueuer {
	return &Enqueuer{client: asynq.NewClient(opt)}
}

// EnqueueDeploy schedules a deploy of the service.
func (e *Enqueuer) EnqueueDeploy(ctx context.Context, serviceID, actorID string) error {
	task, err := NewDeployServiceTask(serviceID, actorID)
	if err != nil {
		return err
	}
	_, err = e.client.EnqueueContext(ctx, task)
	return err
}

// Close releases the underlying asynq client.
func (e *Enqueuer) Close() error { return e.client.Close() }
