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
