ALTER TABLE services ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_services_tags ON services USING GIN(tags);
