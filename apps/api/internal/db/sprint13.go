package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

// --- Webhooks ---

const listWebhooksForUser = `
SELECT id, user_id, url, secret, events, enabled, last_fired_at, created_at
FROM webhook_configs WHERE user_id = $1 ORDER BY created_at DESC
`

func (q *Queries) ListWebhooksForUser(ctx context.Context, userID string) ([]WebhookConfig, error) {
	rows, err := q.db.Query(ctx, listWebhooksForUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWebhookConfigs(rows)
}

const listEnabledWebhooks = `
SELECT id, user_id, url, secret, events, enabled, last_fired_at, created_at
FROM webhook_configs WHERE user_id = $1 AND enabled = TRUE AND $2 = ANY(events)
`

func (q *Queries) ListEnabledWebhooks(ctx context.Context, userID, event string) ([]WebhookConfig, error) {
	rows, err := q.db.Query(ctx, listEnabledWebhooks, userID, event)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWebhookConfigs(rows)
}

type CreateWebhookParams struct {
	UserID string
	URL    string
	Secret pgtype.Text
	Events []string
}

const createWebhook = `
INSERT INTO webhook_configs (user_id, url, secret, events, enabled)
VALUES ($1, $2, $3, $4, TRUE)
RETURNING id, user_id, url, secret, events, enabled, last_fired_at, created_at
`

func (q *Queries) CreateWebhook(ctx context.Context, arg CreateWebhookParams) (WebhookConfig, error) {
	if arg.Events == nil {
		arg.Events = []string{"crash", "alert", "stopped"}
	}
	row := q.db.QueryRow(ctx, createWebhook, arg.UserID, arg.URL, arg.Secret, arg.Events)
	return scanWebhookConfig(row)
}

const toggleWebhook = `
UPDATE webhook_configs SET enabled = $2 WHERE id = $1 AND user_id = $3
RETURNING id, user_id, url, secret, events, enabled, last_fired_at, created_at
`

func (q *Queries) ToggleWebhook(ctx context.Context, id pgtype.UUID, userID string, enabled bool) (WebhookConfig, error) {
	row := q.db.QueryRow(ctx, toggleWebhook, id, enabled, userID)
	return scanWebhookConfig(row)
}

const deleteWebhook = `DELETE FROM webhook_configs WHERE id = $1 AND user_id = $2`

func (q *Queries) DeleteWebhook(ctx context.Context, id pgtype.UUID, userID string) error {
	_, err := q.db.Exec(ctx, deleteWebhook, id, userID)
	return err
}

const touchWebhookFired = `UPDATE webhook_configs SET last_fired_at = now() WHERE id = $1`

func (q *Queries) TouchWebhookFired(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, touchWebhookFired, id)
	return err
}

func scanWebhookConfig(row interface{ Scan(dest ...any) error }) (WebhookConfig, error) {
	var w WebhookConfig
	err := row.Scan(
		&w.ID, &w.UserID, &w.URL, &w.Secret, &w.Events, &w.Enabled, &w.LastFiredAt, &w.CreatedAt,
	)
	return w, err
}

func scanWebhookConfigs(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]WebhookConfig, error) {
	var items []WebhookConfig
	for rows.Next() {
		var w WebhookConfig
		if err := rows.Scan(
			&w.ID, &w.UserID, &w.URL, &w.Secret, &w.Events, &w.Enabled, &w.LastFiredAt, &w.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, w)
	}
	return items, rows.Err()
}

// --- Backups ---

type CreateBackupParams struct {
	ServiceID      pgtype.UUID
	NodeID         pgtype.UUID
	Status         BackupStatus
	ConfigSnapshot pgtype.Text // JSON snapshot of environment + startup_cmd
}

const createBackup = `
INSERT INTO backups (service_id, node_id, status, config_snapshot)
VALUES ($1, $2, $3, $4::jsonb)
RETURNING id, service_id, node_id, status, size_bytes, error, created_at, completed_at, config_snapshot
`

func (q *Queries) CreateBackup(ctx context.Context, arg CreateBackupParams) (Backup, error) {
	row := q.db.QueryRow(ctx, createBackup, arg.ServiceID, arg.NodeID, arg.Status, arg.ConfigSnapshot)
	return scanBackup(row)
}

const listBackupsForService = `
SELECT id, service_id, node_id, status, size_bytes, error, created_at, completed_at, config_snapshot
FROM backups WHERE service_id = $1 AND dismissed = false ORDER BY created_at DESC
`

func (q *Queries) ListBackupsForService(ctx context.Context, serviceID pgtype.UUID) ([]Backup, error) {
	rows, err := q.db.Query(ctx, listBackupsForService, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Backup
	for rows.Next() {
		var b Backup
		if err := rows.Scan(
			&b.ID, &b.ServiceID, &b.NodeID, &b.Status, &b.SizeBytes, &b.Error, &b.CreatedAt, &b.CompletedAt, &b.ConfigSnapshot,
		); err != nil {
			return nil, err
		}
		items = append(items, b)
	}
	return items, rows.Err()
}

const countActiveBackupsForService = `
SELECT COUNT(*)::int FROM backups
WHERE service_id = $1 AND status IN ('pending', 'running', 'success')
`

func (q *Queries) CountActiveBackupsForService(ctx context.Context, serviceID pgtype.UUID) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, countActiveBackupsForService, serviceID).Scan(&n)
	return n, err
}

type UpdateBackupResultParams struct {
	ID          pgtype.UUID
	Status      BackupStatus
	SizeBytes   pgtype.Int8
	Error       pgtype.Text
	CompletedAt pgtype.Timestamptz
}

const updateBackupResult = `
UPDATE backups SET status = $2, size_bytes = $3, error = $4, completed_at = $5
WHERE id = $1
RETURNING id, service_id, node_id, status, size_bytes, error, created_at, completed_at, config_snapshot
`

func (q *Queries) UpdateBackupResult(ctx context.Context, arg UpdateBackupResultParams) (Backup, error) {
	row := q.db.QueryRow(ctx, updateBackupResult,
		arg.ID, arg.Status, arg.SizeBytes, arg.Error, arg.CompletedAt,
	)
	return scanBackup(row)
}

const getBackup = `
SELECT id, service_id, node_id, status, size_bytes, error, created_at, completed_at, config_snapshot
FROM backups WHERE id = $1 AND service_id = $2 LIMIT 1
`

func (q *Queries) GetBackup(ctx context.Context, id, serviceID pgtype.UUID) (Backup, error) {
	row := q.db.QueryRow(ctx, getBackup, id, serviceID)
	return scanBackup(row)
}

const deleteBackup = `DELETE FROM backups WHERE id = $1 AND service_id = $2`

func (q *Queries) DeleteBackup(ctx context.Context, id, serviceID pgtype.UUID) error {
	_, err := q.db.Exec(ctx, deleteBackup, id, serviceID)
	return err
}

func (q *Queries) DismissBackup(ctx context.Context, backupID, serviceID pgtype.UUID) error {
	_, err := q.db.Exec(ctx,
		`UPDATE backups SET dismissed=true WHERE id=$1 AND service_id=$2`,
		backupID, serviceID,
	)
	return err
}

func scanBackup(row interface{ Scan(dest ...any) error }) (Backup, error) {
	var b Backup
	err := row.Scan(
		&b.ID, &b.ServiceID, &b.NodeID, &b.Status, &b.SizeBytes, &b.Error, &b.CreatedAt, &b.CompletedAt, &b.ConfigSnapshot,
	)
	return b, err
}

// --- Domains ---

type CreateServiceDomainParams struct {
	ServiceID pgtype.UUID
	OwnerID   string
	Domain    string
	Status    DomainStatus
	Error     pgtype.Text
}

const createServiceDomain = `
INSERT INTO service_domains (service_id, owner_id, domain, status, error)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, service_id, owner_id, domain, status, error, created_at
`

func (q *Queries) CreateServiceDomain(ctx context.Context, arg CreateServiceDomainParams) (ServiceDomain, error) {
	row := q.db.QueryRow(ctx, createServiceDomain,
		arg.ServiceID, arg.OwnerID, arg.Domain, arg.Status, arg.Error,
	)
	return scanServiceDomain(row)
}

const listServiceDomains = `
SELECT id, service_id, owner_id, domain, status, error, created_at
FROM service_domains WHERE service_id = $1 ORDER BY created_at
`

func (q *Queries) ListServiceDomains(ctx context.Context, serviceID pgtype.UUID) ([]ServiceDomain, error) {
	rows, err := q.db.Query(ctx, listServiceDomains, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ServiceDomain
	for rows.Next() {
		var d ServiceDomain
		if err := rows.Scan(
			&d.ID, &d.ServiceID, &d.OwnerID, &d.Domain, &d.Status, &d.Error, &d.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

const updateServiceDomainStatus = `
UPDATE service_domains SET status = $2, error = $3 WHERE id = $1
RETURNING id, service_id, owner_id, domain, status, error, created_at
`

func (q *Queries) UpdateServiceDomainStatus(ctx context.Context, id pgtype.UUID, status DomainStatus, errMsg pgtype.Text) (ServiceDomain, error) {
	row := q.db.QueryRow(ctx, updateServiceDomainStatus, id, status, errMsg)
	return scanServiceDomain(row)
}

const getServiceDomain = `
SELECT id, service_id, owner_id, domain, status, error, created_at
FROM service_domains WHERE id = $1 AND service_id = $2
`

func (q *Queries) GetServiceDomain(ctx context.Context, id, serviceID pgtype.UUID) (ServiceDomain, error) {
	row := q.db.QueryRow(ctx, getServiceDomain, id, serviceID)
	return scanServiceDomain(row)
}

const deleteServiceDomain = `DELETE FROM service_domains WHERE id = $1 AND service_id = $2`

func (q *Queries) DeleteServiceDomain(ctx context.Context, id, serviceID pgtype.UUID) error {
	_, err := q.db.Exec(ctx, deleteServiceDomain, id, serviceID)
	return err
}

func scanServiceDomain(row interface{ Scan(dest ...any) error }) (ServiceDomain, error) {
	var d ServiceDomain
	err := row.Scan(
		&d.ID, &d.ServiceID, &d.OwnerID, &d.Domain, &d.Status, &d.Error, &d.CreatedAt,
	)
	return d, err
}
