package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type ServicePlugin struct {
	ID           pgtype.UUID
	ServiceID    pgtype.UUID
	Source       string
	ExternalID   string
	Name         string
	Version      string
	VersionID    string
	JarFilename  string
	PluginDir    string
	AutoUpdate   bool
	InstalledAt  pgtype.Timestamptz
	Dependencies []byte
}

func scanServicePlugin(row interface {
	Scan(dest ...any) error
}) (ServicePlugin, error) {
	var p ServicePlugin
	err := row.Scan(
		&p.ID, &p.ServiceID, &p.Source, &p.ExternalID, &p.Name, &p.Version, &p.VersionID,
		&p.JarFilename, &p.PluginDir, &p.AutoUpdate, &p.InstalledAt, &p.Dependencies,
	)
	return p, err
}

const servicePluginSelectCols = `id, service_id, source, external_id, name, version, version_id, jar_filename, plugin_dir, auto_update, installed_at, dependencies`

func (q *Queries) ListServicePlugins(ctx context.Context, serviceID pgtype.UUID) ([]ServicePlugin, error) {
	rows, err := q.db.Query(ctx,
		`SELECT `+servicePluginSelectCols+`
		 FROM service_plugins WHERE service_id=$1 ORDER BY installed_at DESC`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ServicePlugin
	for rows.Next() {
		p, err := scanServicePlugin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (q *Queries) UpsertServicePlugin(ctx context.Context, p ServicePlugin) (ServicePlugin, error) {
	deps := p.Dependencies
	if len(deps) == 0 {
		deps = []byte("[]")
	}
	row := q.db.QueryRow(ctx,
		`INSERT INTO service_plugins (service_id, source, external_id, name, version, version_id, jar_filename, plugin_dir, auto_update, dependencies)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (service_id, jar_filename)
		 DO UPDATE SET source=EXCLUDED.source, external_id=EXCLUDED.external_id, name=EXCLUDED.name,
		               version=EXCLUDED.version, version_id=EXCLUDED.version_id,
		               plugin_dir=EXCLUDED.plugin_dir, auto_update=EXCLUDED.auto_update
		 RETURNING `+servicePluginSelectCols,
		p.ServiceID, p.Source, p.ExternalID, p.Name, p.Version, p.VersionID, p.JarFilename, p.PluginDir, p.AutoUpdate, deps,
	)
	return scanServicePlugin(row)
}

func (q *Queries) UpdateServicePlugin(ctx context.Context, id, serviceID pgtype.UUID, p ServicePlugin) (ServicePlugin, error) {
	row := q.db.QueryRow(ctx,
		`UPDATE service_plugins SET source=$3, external_id=$4, name=$5, version=$6, version_id=$7,
		 jar_filename=$8, plugin_dir=$9, auto_update=$10
		 WHERE id=$1 AND service_id=$2
		 RETURNING `+servicePluginSelectCols,
		id, serviceID, p.Source, p.ExternalID, p.Name, p.Version, p.VersionID, p.JarFilename, p.PluginDir, p.AutoUpdate,
	)
	return scanServicePlugin(row)
}

func (q *Queries) DeleteServicePlugin(ctx context.Context, id, serviceID pgtype.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM service_plugins WHERE id=$1 AND service_id=$2`, id, serviceID)
	return err
}

func (q *Queries) GetServicePluginByFilename(ctx context.Context, serviceID pgtype.UUID, filename string) (ServicePlugin, error) {
	row := q.db.QueryRow(ctx,
		`SELECT `+servicePluginSelectCols+`
		 FROM service_plugins WHERE service_id=$1 AND jar_filename=$2`, serviceID, filename,
	)
	return scanServicePlugin(row)
}

func (q *Queries) UpdatePluginDependencies(ctx context.Context, pluginID pgtype.UUID, deps []string) error {
	if deps == nil {
		deps = []string{}
	}
	depsJSON, err := json.Marshal(deps)
	if err != nil {
		return err
	}
	_, err = q.db.Exec(ctx,
		`UPDATE service_plugins SET dependencies=$1 WHERE id=$2`, depsJSON, pluginID)
	return err
}

// ServicePluginInstalledAt returns installed_at as time.Time for JSON views.
func ServicePluginInstalledAt(p ServicePlugin) time.Time {
	if p.InstalledAt.Valid {
		return p.InstalledAt.Time
	}
	return time.Time{}
}
