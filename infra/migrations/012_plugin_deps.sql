ALTER TABLE service_plugins ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]';

ALTER TABLE service_plugins DROP CONSTRAINT IF EXISTS service_plugins_source_check;
ALTER TABLE service_plugins ADD CONSTRAINT service_plugins_source_check
    CHECK (source IN ('modrinth','curseforge','spigot','manual','umod','codefling'));
