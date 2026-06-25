CREATE TYPE notif_kind AS ENUM (
  'crash', 'running', 'stopped', 'deploy_ok', 'deploy_fail', 'alert'
);

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  kind         notif_kind NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  meta         JSONB
);

CREATE INDEX idx_notifs_user ON notifications(user_id, ts DESC);
CREATE INDEX idx_notifs_user_unread ON notifications(user_id) WHERE read = FALSE;
