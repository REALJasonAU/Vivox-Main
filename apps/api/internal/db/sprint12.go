package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const updateServiceTags = `
UPDATE services SET tags = $2, updated_at = now() WHERE id = $1
RETURNING id, owner_id, team_id, name, type, status, node_id, resource_limits, config, tags, created_at, updated_at
`

func (q *Queries) UpdateServiceTags(ctx context.Context, id pgtype.UUID, tags []string) (Service, error) {
	if tags == nil {
		tags = []string{}
	}
	row := q.db.QueryRow(ctx, updateServiceTags, id, tags)
	return scanService(row)
}

const listUserServicesByTag = `
SELECT id, owner_id, team_id, name, type, status, node_id, resource_limits, config, tags, created_at, updated_at
FROM services WHERE owner_id = $1 AND $2 = ANY(tags) ORDER BY created_at DESC
`

func (q *Queries) ListUserServicesByTag(ctx context.Context, ownerID, tag string) ([]Service, error) {
	rows, err := q.db.Query(ctx, listUserServicesByTag, ownerID, tag)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Service
	for rows.Next() {
		var i Service
		if err := rows.Scan(
			&i.ID, &i.OwnerID, &i.TeamID, &i.Name, &i.Type, &i.Status, &i.NodeID,
			&i.ResourceLimits, &i.Config, &i.Tags, &i.CreatedAt, &i.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

const listAlertRulesForService = `
SELECT id, service_id, owner_id, metric, operator, threshold, enabled, notified_at, created_at
FROM alert_rules WHERE service_id = $1 ORDER BY created_at
`

func (q *Queries) ListAlertRulesForService(ctx context.Context, serviceID pgtype.UUID) ([]AlertRule, error) {
	rows, err := q.db.Query(ctx, listAlertRulesForService, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAlertRules(rows)
}

const listActiveAlertRulesForMetric = `
SELECT id, service_id, owner_id, metric, operator, threshold, enabled, notified_at, created_at
FROM alert_rules WHERE service_id = $1 AND enabled = TRUE AND metric = $2
`

func (q *Queries) ListActiveAlertRulesForMetric(ctx context.Context, serviceID pgtype.UUID, metric AlertMetric) ([]AlertRule, error) {
	rows, err := q.db.Query(ctx, listActiveAlertRulesForMetric, serviceID, metric)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAlertRules(rows)
}

type CreateAlertRuleParams struct {
	ServiceID pgtype.UUID   `json:"service_id"`
	OwnerID   string        `json:"owner_id"`
	Metric    AlertMetric   `json:"metric"`
	Operator  AlertOperator `json:"operator"`
	Threshold int32         `json:"threshold"`
}

const createAlertRule = `
INSERT INTO alert_rules (service_id, owner_id, metric, operator, threshold, enabled)
VALUES ($1, $2, $3, $4, $5, TRUE)
RETURNING id, service_id, owner_id, metric, operator, threshold, enabled, notified_at, created_at
`

func (q *Queries) CreateAlertRule(ctx context.Context, arg CreateAlertRuleParams) (AlertRule, error) {
	row := q.db.QueryRow(ctx, createAlertRule,
		arg.ServiceID, arg.OwnerID, arg.Metric, arg.Operator, arg.Threshold,
	)
	var r AlertRule
	err := row.Scan(
		&r.ID, &r.ServiceID, &r.OwnerID, &r.Metric, &r.Operator,
		&r.Threshold, &r.Enabled, &r.NotifiedAt, &r.CreatedAt,
	)
	return r, err
}

const deleteAlertRule = `DELETE FROM alert_rules WHERE id = $1 AND service_id = $2`

func (q *Queries) DeleteAlertRule(ctx context.Context, id, serviceID pgtype.UUID) error {
	_, err := q.db.Exec(ctx, deleteAlertRule, id, serviceID)
	return err
}

type ToggleAlertRuleParams struct {
	ID        pgtype.UUID `json:"id"`
	Enabled   bool        `json:"enabled"`
	ServiceID pgtype.UUID `json:"service_id"`
}

const toggleAlertRule = `
UPDATE alert_rules SET enabled = $2 WHERE id = $1 AND service_id = $3
RETURNING id, service_id, owner_id, metric, operator, threshold, enabled, notified_at, created_at
`

func (q *Queries) ToggleAlertRule(ctx context.Context, arg ToggleAlertRuleParams) (AlertRule, error) {
	row := q.db.QueryRow(ctx, toggleAlertRule, arg.ID, arg.Enabled, arg.ServiceID)
	var r AlertRule
	err := row.Scan(
		&r.ID, &r.ServiceID, &r.OwnerID, &r.Metric, &r.Operator,
		&r.Threshold, &r.Enabled, &r.NotifiedAt, &r.CreatedAt,
	)
	return r, err
}

const touchAlertNotified = `UPDATE alert_rules SET notified_at = now() WHERE id = $1`

func (q *Queries) TouchAlertNotified(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, touchAlertNotified, id)
	return err
}

func scanAlertRules(rows interface {
	Next() bool
	Scan(dest ...any) error
}) ([]AlertRule, error) {
	var items []AlertRule
	for rows.Next() {
		var r AlertRule
		if err := rows.Scan(
			&r.ID, &r.ServiceID, &r.OwnerID, &r.Metric, &r.Operator,
			&r.Threshold, &r.Enabled, &r.NotifiedAt, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, nil
}

func scanService(row interface{ Scan(dest ...any) error }) (Service, error) {
	var i Service
	err := row.Scan(
		&i.ID, &i.OwnerID, &i.TeamID, &i.Name, &i.Type, &i.Status, &i.NodeID,
		&i.ResourceLimits, &i.Config, &i.Tags, &i.CreatedAt, &i.UpdatedAt,
	)
	return i, err
}
