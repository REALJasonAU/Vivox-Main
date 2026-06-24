// Package config loads control-plane configuration from the environment.
//
// Defaults match infra/dev/docker-compose.yml so a developer can run the API
// against the local Postgres + Redis with zero configuration.
package config

import (
	"os"
	"strconv"
)

// Config is the fully-resolved runtime configuration for the API control plane.
type Config struct {
	// HTTPAddr is the listen address for the Fiber REST + WebSocket server.
	HTTPAddr string
	// GRPCAddr is the listen address for the AgentController gRPC server.
	GRPCAddr string

	// DatabaseURL is the pgx connection string for Postgres.
	DatabaseURL string
	// RedisAddr is the host:port of Redis (Streams + asynq broker).
	RedisAddr string
	// RedisPassword is optional.
	RedisPassword string
	// RedisDB selects the Redis logical database.
	RedisDB int

	// AuthSecret is the shared HMAC secret used to verify Better Auth JWTs.
	AuthSecret string
	// AuthDevMode, when true, allows the X-Dev-User / X-Dev-Role headers to
	// stand in for a verified session. Never enable in production.
	AuthDevMode bool

	// CertDir holds the dev mTLS material (ca/server/client certs) used by the
	// gRPC agent link. Auto-generated on first boot if missing.
	CertDir string
	// GRPCTLSDisabled disables mTLS for the gRPC server (local dev only).
	GRPCTLSDisabled bool

	// CaddyAdminURL is the Caddy admin API base (e.g. http://caddy:2019). Empty disables domain routing.
	CaddyAdminURL string
	// NodePublicHost is the host agents expose published ports on (for Caddy upstream dial).
	NodePublicHost string
}

// Load reads configuration from the environment, applying dev-friendly defaults.
func Load() Config {
	return Config{
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		GRPCAddr:        env("GRPC_ADDR", ":9090"),
		DatabaseURL:     env("DATABASE_URL", "postgres://nexus:nexus@localhost:5432/nexus"),
		RedisAddr:       env("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   env("REDIS_PASSWORD", ""),
		RedisDB:         envInt("REDIS_DB", 0),
		AuthSecret:      env("BETTER_AUTH_SECRET", "dev-insecure-secret-change-me"),
		AuthDevMode:     envBool("AUTH_DEV_MODE", true),
		CertDir:         env("GRPC_CERT_DIR", "infra/dev/certs"),
		GRPCTLSDisabled: envBool("GRPC_TLS_DISABLED", false),
		CaddyAdminURL:   env("CADDY_ADMIN_URL", ""),
		NodePublicHost:  env("NODE_PUBLIC_HOST", "host.docker.internal"),
	}
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
