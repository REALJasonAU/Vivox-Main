CREATE TABLE user_suspensions (
  user_id      VARCHAR(255) PRIMARY KEY,
  reason       TEXT,
  suspended_by VARCHAR(255) NOT NULL,
  suspended_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
