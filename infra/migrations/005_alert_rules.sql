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
