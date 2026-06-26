-- Store a snapshot of the service's startup environment and startup command
-- at backup creation time, so restore can re-apply the config.
ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS config_snapshot JSONB;
