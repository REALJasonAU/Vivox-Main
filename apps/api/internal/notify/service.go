package notify

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/db"
)

// NotifyService fans out status/alert events to configured webhooks and persists in-app notifications.
type NotifyService struct {
	q          *db.Queries
	dispatcher *Dispatcher
	log        *slog.Logger
}

// NewNotifyService wires webhook delivery and notification persistence.
func NewNotifyService(q *db.Queries, dispatcher *Dispatcher, log *slog.Logger) *NotifyService {
	return &NotifyService{q: q, dispatcher: dispatcher, log: log}
}

// FireStatusEvent looks up enabled webhooks for userID, fires matching event types, and stores a notification row.
func (n *NotifyService) FireStatusEvent(ctx context.Context, userID, serviceID, serviceName, event string, meta interface{}) {
	if n == nil {
		return
	}
	n.persistNotification(ctx, userID, serviceID, serviceName, event, meta)
	if n.dispatcher == nil {
		return
	}
	hooks, err := n.q.ListEnabledWebhooks(ctx, userID, event)
	if err != nil {
		return
	}
	for _, hook := range hooks {
		go func(hook db.WebhookConfig) {
			fireCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancel()
			ev := Event{
				Event:       event,
				ServiceID:   serviceID,
				ServiceName: serviceName,
				Timestamp:   time.Now().Unix(),
				Meta:        meta,
			}
			secret := ""
			if hook.Secret.Valid {
				secret = hook.Secret.String
			}
			if err := n.dispatcher.Fire(fireCtx, hook.URL, secret, ev); err != nil && n.log != nil {
				n.log.Warn("webhook delivery failed", "url", hook.URL, "event", event, "err", err)
			}
			_ = n.q.TouchWebhookFired(context.Background(), hook.ID)
		}(hook)
	}
}

func (n *NotifyService) persistNotification(ctx context.Context, userID, serviceID, serviceName, event string, meta interface{}) {
	if n == nil || n.q == nil {
		return
	}
	kind := event
	switch event {
	case "crash", "running", "stopped", "alert":
		// valid notif_kind values
	default:
		return
	}
	svcUUID, err := parseServiceUUID(serviceID)
	if err != nil {
		return
	}
	_, _ = n.q.CreateNotification(ctx, userID, serviceName, kind, svcUUID, meta)
}

func parseServiceUUID(id string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return u, err
	}
	return u, nil
}

// TouchWebhook is a no-op helper reserved for tests.
func TouchWebhook(_ pgtype.UUID) {}
