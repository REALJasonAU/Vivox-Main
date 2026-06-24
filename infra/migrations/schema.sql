CREATE TYPE service_type   AS ENUM ('game', 'docker', 'database', 'static');
CREATE TYPE service_status AS ENUM ('PROVISIONING','STARTING','RUNNING','STOPPING','STOPPED','CRASHED');
CREATE TYPE deploy_status  AS ENUM ('queued','building','success','failed');

CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  region VARCHAR(50) NOT NULL,
  agent_token_hash VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'offline',
  capacity JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR(255) NOT NULL,        -- Better Auth user id
  team_id  VARCHAR(255),                 -- nullable in Phase 1
  name VARCHAR(100) NOT NULL,
  type service_type NOT NULL,
  status service_status NOT NULL DEFAULT 'STOPPED',
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  resource_limits JSONB NOT NULL,
  config JSONB NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  commit_sha VARCHAR(40),
  status deploy_status NOT NULL DEFAULT 'queued',
  logs_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(255) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_services_owner     ON services(owner_id);
CREATE INDEX idx_services_node      ON services(node_id);
CREATE INDEX idx_deployments_service ON deployments(service_id);
CREATE INDEX idx_audit_target       ON audit_events(target_type, target_id);

CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      VARCHAR(255) NOT NULL,
  name         VARCHAR(100) NOT NULL,
  key_hash     VARCHAR(255) NOT NULL UNIQUE,
  key_prefix   VARCHAR(12) NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

CREATE TYPE task_status AS ENUM ('active', 'paused', 'running', 'failed');

CREATE TABLE scheduled_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  owner_id    VARCHAR(255) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  cron_expr   VARCHAR(100) NOT NULL,
  action      VARCHAR(50)  NOT NULL,
  status      task_status  NOT NULL DEFAULT 'active',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_result VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_service ON scheduled_tasks(service_id);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at) WHERE status = 'active';

CREATE TYPE alert_metric AS ENUM ('cpu', 'memory');
CREATE TYPE alert_operator AS ENUM ('gt', 'lt');

CREATE TABLE alert_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  owner_id     VARCHAR(255) NOT NULL,
  metric       alert_metric NOT NULL,
  operator     alert_operator NOT NULL DEFAULT 'gt',
  threshold    INT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_rules_service ON alert_rules(service_id);
CREATE INDEX idx_services_tags ON services USING GIN(tags);

CREATE TABLE webhook_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       VARCHAR(255) NOT NULL,
  url           TEXT NOT NULL,
  secret        VARCHAR(255),
  events        TEXT[] NOT NULL DEFAULT '{"crash","alert","stopped"}',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhook_user ON webhook_configs(user_id);

CREATE TYPE backup_status AS ENUM ('pending', 'running', 'success', 'failed');

CREATE TABLE backups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  node_id      UUID REFERENCES nodes(id) ON DELETE SET NULL,
  status       backup_status NOT NULL DEFAULT 'pending',
  size_bytes   BIGINT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_backups_service ON backups(service_id);

CREATE TYPE domain_status AS ENUM ('pending', 'active', 'error');

CREATE TABLE service_domains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  owner_id    VARCHAR(255) NOT NULL,
  domain      VARCHAR(255) NOT NULL UNIQUE,
  status      domain_status NOT NULL DEFAULT 'pending',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_domains_service ON service_domains(service_id);

CREATE TABLE user_suspensions (
  user_id      VARCHAR(255) PRIMARY KEY,
  reason       TEXT,
  suspended_by VARCHAR(255) NOT NULL,
  suspended_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
