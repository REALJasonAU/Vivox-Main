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
