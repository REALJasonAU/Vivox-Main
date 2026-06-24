package db

import (
	"context"
	"time"
)

// Customer is a joined view of the Better Auth user table + service counts + suspension status.
type Customer struct {
	ID           string
	Email        string
	Name         *string
	Role         string
	CreatedAt    time.Time
	IsSuspended  bool
	ServiceCount int64
	RunningCount int64
}

const listCustomers = `
SELECT
  u.id,
  u.email,
  u.name,
  COALESCE(u.role, 'user') AS role,
  u."createdAt",
  CASE WHEN us.user_id IS NOT NULL THEN true ELSE false END AS is_suspended,
  COUNT(s.id)                                                AS service_count,
  COUNT(CASE WHEN s.status = 'RUNNING' THEN 1 END)          AS running_count
FROM "user" u
LEFT JOIN services       s  ON s.owner_id  = u.id
LEFT JOIN user_suspensions us ON us.user_id = u.id
GROUP BY u.id, u.email, u.name, u.role, u."createdAt", us.user_id
ORDER BY u."createdAt" DESC
`

func (q *Queries) ListCustomers(ctx context.Context) ([]Customer, error) {
	rows, err := q.db.Query(ctx, listCustomers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Customer
	for rows.Next() {
		var c Customer
		if err := rows.Scan(
			&c.ID, &c.Email, &c.Name, &c.Role, &c.CreatedAt,
			&c.IsSuspended, &c.ServiceCount, &c.RunningCount,
		); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

const suspendCustomer = `
INSERT INTO user_suspensions (user_id, reason, suspended_by)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by, suspended_at = NOW()
`

func (q *Queries) SuspendCustomer(ctx context.Context, userID, reason, suspendedBy string) error {
	_, err := q.db.Exec(ctx, suspendCustomer, userID, reason, suspendedBy)
	return err
}

const unsuspendCustomer = `DELETE FROM user_suspensions WHERE user_id = $1`

func (q *Queries) UnsuspendCustomer(ctx context.Context, userID string) error {
	_, err := q.db.Exec(ctx, unsuspendCustomer, userID)
	return err
}
