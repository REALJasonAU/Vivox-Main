package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const updateServiceOwner = `
UPDATE services
SET owner_id = $2, updated_at = NOW()
WHERE id = $1
RETURNING id, owner_id, team_id, name, type, status, node_id, resource_limits, config, tags, created_at, updated_at
`

func (q *Queries) UpdateServiceOwner(ctx context.Context, id pgtype.UUID, ownerID string) (Service, error) {
	row := q.db.QueryRow(ctx, updateServiceOwner, id, ownerID)
	var i Service
	err := row.Scan(
		&i.ID,
		&i.OwnerID,
		&i.TeamID,
		&i.Name,
		&i.Type,
		&i.Status,
		&i.NodeID,
		&i.ResourceLimits,
		&i.Config,
		&i.Tags,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}
