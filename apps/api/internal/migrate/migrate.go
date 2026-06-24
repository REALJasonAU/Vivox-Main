package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run applies unapplied .sql files in dir in lexical order.
func Run(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		// Only run numbered migrations (e.g. 001_foo.sql).
		// schema.sql and any other non-numbered files are skipped.
		if !strings.HasSuffix(name, ".sql") || !isNumbered(name) {
			continue
		}
		files = append(files, filepath.Join(dir, name))
	}
	sort.Strings(files)

	for _, f := range files {
		name := filepath.Base(f)
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = $1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("read %s: %w", f, err)
		}
		if _, err := pool.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("apply %s: %w", f, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations (filename) VALUES ($1)`, name); err != nil {
			return fmt.Errorf("record %s: %w", name, err)
		}
	}
	return nil
}

// isNumbered returns true if the filename starts with at least one digit.
// This excludes reference files like schema.sql from the migration runner.
func isNumbered(name string) bool {
	return len(name) > 0 && name[0] >= '0' && name[0] <= '9'
}
