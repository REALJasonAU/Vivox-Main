-- ============================================================================
-- Nodes
-- ============================================================================

-- name: CreateNode :one
INSERT INTO nodes (name, region, agent_token_hash, status, capacity)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetNode :one
SELECT * FROM nodes
WHERE id = $1;

-- name: GetNodeByTokenHash :one
SELECT * FROM nodes
WHERE agent_token_hash = $1;

-- name: ListNodes :many
SELECT * FROM nodes
ORDER BY created_at DESC;

-- name: UpdateNodeStatus :one
UPDATE nodes
SET status = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateNodeCapacity :one
UPDATE nodes
SET capacity = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateNodeTokenHash :one
UPDATE nodes
SET agent_token_hash = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- ============================================================================
-- Services
-- ============================================================================

-- name: CreateService :one
INSERT INTO services (owner_id, team_id, name, type, status, node_id, resource_limits, config)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetService :one
SELECT * FROM services
WHERE id = $1;

-- name: ListUserServices :many
SELECT * FROM services
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: ListAllServices :many
SELECT * FROM services
ORDER BY created_at DESC;

-- name: ListServicesByNode :many
SELECT * FROM services
WHERE node_id = $1
ORDER BY created_at DESC;

-- name: UpdateServiceStatus :one
UPDATE services
SET status = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateServiceConfig :one
UPDATE services
SET resource_limits = $2,
    config = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteService :exec
DELETE FROM services
WHERE id = $1;

-- ============================================================================
-- Deployments
-- ============================================================================

-- name: CreateDeployment :one
INSERT INTO deployments (service_id, commit_sha, status, logs_ref)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateDeploymentStatus :one
UPDATE deployments
SET status = $2,
    logs_ref = $3
WHERE id = $1
RETURNING *;

-- ============================================================================
-- Audit events
-- ============================================================================

-- name: InsertAuditEvent :exec
INSERT INTO audit_events (actor_id, action, target_type, target_id, metadata)
VALUES ($1, $2, $3, $4, $5);

-- name: ListAuditEvents :many
SELECT * FROM audit_events
WHERE ($1::text IS NULL OR $1 = '' OR actor_id = $1)
  AND ($2::text IS NULL OR $2 = '' OR target_type = $2)
  AND ($3::text IS NULL OR $3 = '' OR target_id = $3)
  AND ($4::timestamptz IS NULL OR created_at >= $4)
  AND ($5::timestamptz IS NULL OR created_at <= $5)
ORDER BY created_at DESC
LIMIT $6;

-- name: NodeServiceLoads :many
SELECT
  node_id,
  COUNT(*)::bigint AS service_count,
  COALESCE(SUM((resource_limits->>'memory_mb')::bigint), 0)::bigint AS total_memory_mb
FROM services
WHERE node_id IS NOT NULL
  AND status NOT IN ('STOPPED', 'CRASHED')
GROUP BY node_id;

-- name: ListDeploymentsByService :many
SELECT * FROM deployments
WHERE service_id = $1
ORDER BY created_at DESC;

-- ============================================================================
-- API keys
-- ============================================================================

-- name: CreateApiKey :one
INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListApiKeysByUser :many
SELECT * FROM api_keys
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: GetApiKeyByHash :one
SELECT * FROM api_keys
WHERE key_hash = $1;

-- name: TouchApiKey :exec
UPDATE api_keys
SET last_used_at = now()
WHERE id = $1;

-- name: DeleteApiKey :exec
DELETE FROM api_keys
WHERE id = $1 AND user_id = $2;

-- ============================================================================
-- Scheduled tasks
-- ============================================================================

-- name: CreateScheduledTask :one
INSERT INTO scheduled_tasks (service_id, owner_id, name, cron_expr, action, status, next_run_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListScheduledTasksByService :many
SELECT * FROM scheduled_tasks
WHERE service_id = $1
ORDER BY created_at DESC;

-- name: DeleteScheduledTask :exec
DELETE FROM scheduled_tasks
WHERE id = $1 AND service_id = $2;

-- name: ListDueScheduledTasks :many
SELECT * FROM scheduled_tasks
WHERE status = 'active'
  AND next_run_at IS NOT NULL
  AND next_run_at <= $1
ORDER BY next_run_at ASC
LIMIT 50;

-- name: UpdateScheduledTaskRunning :one
UPDATE scheduled_tasks
SET status = 'running',
    last_run_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateScheduledTaskDone :one
UPDATE scheduled_tasks
SET status = 'active',
    last_result = $2,
    next_run_at = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- ============================================================================
-- Service tags
-- ============================================================================

-- name: UpdateServiceTags :one
UPDATE services
SET tags = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListUserServicesByTag :many
SELECT * FROM services
WHERE owner_id = $1 AND $2 = ANY(tags)
ORDER BY created_at DESC;

-- ============================================================================
-- Alert rules
-- ============================================================================

-- name: ListAlertRulesForService :many
SELECT * FROM alert_rules
WHERE service_id = $1
ORDER BY created_at;

-- name: ListActiveAlertRulesForMetric :many
SELECT id, service_id, owner_id, metric, operator, threshold, enabled, notified_at, created_at
FROM alert_rules
WHERE service_id = $1 AND enabled = TRUE AND metric = $2;

-- name: CreateAlertRule :one
INSERT INTO alert_rules (service_id, owner_id, metric, operator, threshold, enabled)
VALUES ($1, $2, $3, $4, $5, TRUE)
RETURNING *;

-- name: DeleteAlertRule :exec
DELETE FROM alert_rules
WHERE id = $1 AND service_id = $2;

-- name: ToggleAlertRule :one
UPDATE alert_rules
SET enabled = $2
WHERE id = $1 AND service_id = $3
RETURNING *;

-- name: TouchAlertNotified :exec
UPDATE alert_rules
SET notified_at = now()
WHERE id = $1;
