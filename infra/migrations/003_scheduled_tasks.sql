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
