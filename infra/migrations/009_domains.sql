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
