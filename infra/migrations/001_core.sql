-- Core control-plane schema (nodes, services, deployments, audit).
-- Numbered migrations 002+ extend this; schema.sql is a reference snapshot only.

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
  owner_id VARCHAR(255) NOT NULL,
  team_id  VARCHAR(255),
  name VARCHAR(100) NOT NULL,
  type service_type NOT NULL,
  status service_status NOT NULL DEFAULT 'STOPPED',
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  resource_limits JSONB NOT NULL,
  config JSONB NOT NULL,
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

CREATE INDEX idx_services_owner      ON services(owner_id);
CREATE INDEX idx_services_node       ON services(node_id);
CREATE INDEX idx_deployments_service ON deployments(service_id);
CREATE INDEX idx_audit_target        ON audit_events(target_type, target_id);
CREATE INDEX idx_audit_created       ON audit_events(created_at DESC);
