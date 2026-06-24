CREATE TABLE IF NOT EXISTS service_plugins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    source        TEXT NOT NULL CHECK (source IN ('modrinth','curseforge','spigot','manual')),
    external_id   TEXT NOT NULL,
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    version_id    TEXT NOT NULL DEFAULT '',
    jar_filename  TEXT NOT NULL,
    plugin_dir    TEXT NOT NULL DEFAULT 'plugins',
    auto_update   BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (service_id, jar_filename)
);

CREATE INDEX IF NOT EXISTS idx_service_plugins_service ON service_plugins(service_id);
