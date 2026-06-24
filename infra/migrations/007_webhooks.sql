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
