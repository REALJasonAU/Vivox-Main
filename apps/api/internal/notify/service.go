package notify

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/db"
)

// NotifyService fans out status/alert events to configured webhooks.
type NotifyService struct {
	q          *db.Queries
	dispatcher *Dispatcher
	log        *slog.Logger
}

// NewNotifyService wires webhook delivery.
func NewNotifyService(q *db.Queries, dispatcher *Dispatcher, log *slog.Logger) *NotifyService {
	return &NotifyService{q: q, dispatcher: dispatcher, log: log}
}

// FireStatusEvent looks up enabled webhooks for userID and fires matching event types.
func (n *NotifyService) FireStatusEvent(ctx context.Context, userID, serviceID, serviceName, event string, meta interface{}) {
	if n == nil || n.dispatcher == nil {
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

// TouchWebhook is a no-op helper reserved for tests.
func TouchWebhook(_ pgtype.UUID) {}
