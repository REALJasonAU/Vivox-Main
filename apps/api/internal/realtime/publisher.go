package realtime

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	ConsoleStreamPrefix = "console:"
	MetricsStreamPrefix = "metrics:"
	StatusStreamPrefix  = "status:"
	HealthStreamPrefix  = "health:"
	AlertStreamPrefix   = "alert:"
	streamMaxLen        = 5000
)

// Publisher writes telemetry and status events to Redis Streams for the WSHub.
type Publisher struct {
	rdb *redis.Client
}

// NewPublisher builds a stream publisher.
func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

// PublishStatus emits a service status change to status:{serviceID}.
func (p *Publisher) PublishStatus(ctx context.Context, serviceID, status string) error {
	if serviceID == "" {
		return nil
	}
	return p.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: StatusStreamPrefix + serviceID,
		MaxLen: streamMaxLen,
		Approx: true,
		Values: map[string]interface{}{
			"status": status,
			"ts":     time.Now().Unix(),
		},
	}).Err()
}

// PublishHealth emits a health check result to health:{serviceID}.
func (p *Publisher) PublishHealth(ctx context.Context, serviceID string, healthy bool, statusCode int, latencyMs int64, errMsg string) error {
	if serviceID == "" {
		return nil
	}
	healthyVal := "0"
	if healthy {
		healthyVal = "1"
	}
	return p.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: HealthStreamPrefix + serviceID,
		MaxLen: streamMaxLen,
		Approx: true,
		Values: map[string]interface{}{
			"healthy":     healthyVal,
			"status_code": statusCode,
			"latency_ms":  latencyMs,
			"error":       errMsg,
			"ts":          time.Now().Unix(),
		},
	}).Err()
}

// PublishAlert emits a resource threshold breach to alert:{serviceID}.
func (p *Publisher) PublishAlert(ctx context.Context, serviceID, metric string, value float64, threshold int, operator string) error {
	if serviceID == "" {
		return nil
	}
	return p.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: AlertStreamPrefix + serviceID,
		MaxLen: 200,
		Approx: true,
		Values: map[string]interface{}{
			"metric":    metric,
			"value":     value,
			"threshold": threshold,
			"operator":  operator,
			"ts":        time.Now().Unix(),
		},
	}).Err()
}
