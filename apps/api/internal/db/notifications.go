package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type Notification struct {
	ID          pgtype.UUID
	UserID      string
	ServiceID   pgtype.UUID
	ServiceName string
	Kind        string
	Ts          time.Time
	Read        bool
	Meta        []byte
}

func (q *Queries) CreateNotification(ctx context.Context, userID, serviceName, kind string, serviceID pgtype.UUID, meta interface{}) (Notification, error) {
	var metaJSON []byte
	if meta != nil {
		var err error
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			metaJSON = nil
		}
	}
	row := q.db.QueryRow(ctx,
		`INSERT INTO notifications (user_id, service_id, service_name, kind, meta)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, service_id, service_name, kind, ts, read, meta`,
		userID, serviceID, serviceName, kind, metaJSON,
	)
	return scanNotification(row)
}

func (q *Queries) ListNotifications(ctx context.Context, userID string, limit int) ([]Notification, error) {
	rows, err := q.db.Query(ctx,
		`SELECT id, user_id, service_id, service_name, kind, ts, read, meta
		 FROM notifications WHERE user_id=$1
		 ORDER BY ts DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (q *Queries) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	_, err := q.db.Exec(ctx,
		`UPDATE notifications SET read=true WHERE user_id=$1 AND read=false`,
		userID,
	)
	return err
}

func scanNotification(row interface{ Scan(...any) error }) (Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.UserID, &n.ServiceID, &n.ServiceName, &n.Kind, &n.Ts, &n.Read, &n.Meta)
	return n, err
}
