// Command api is the Nexus Control plane entrypoint. It serves:
//   - a Fiber HTTP/REST API + multiplexed WebSocket hub for the dashboard
//   - a gRPC AgentController server (mTLS) for edge agents
//   - an asynq deploy worker
//
// All backing services (Postgres, Redis) are wired from the environment with
// dev defaults matching infra/dev/docker-compose.yml.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	"github.com/hibiken/asynq"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/commands"
	"github.com/nexus-control/apps/api/internal/config"
	caddyclient "github.com/nexus-control/apps/api/internal/caddy"
	"github.com/nexus-control/apps/api/internal/db"
	filestrack "github.com/nexus-control/apps/api/internal/files"
	grpcsrv "github.com/nexus-control/apps/api/internal/grpc"
	"github.com/nexus-control/apps/api/internal/migrate"
	"github.com/nexus-control/apps/api/internal/notify"
	"github.com/nexus-control/apps/api/internal/realtime"
	"github.com/nexus-control/apps/api/internal/scheduler"
	"github.com/nexus-control/apps/api/internal/service"
	"github.com/nexus-control/apps/api/internal/terminal"
	"github.com/nexus-control/apps/api/internal/worker"
	"github.com/nexus-control/apps/api/internal/ws"
	"github.com/nexus-control/apps/api/internal/cron"
	gen "github.com/nexus-control/packages/proto/gen"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// --- Postgres ---
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	queries := db.New(pool)

	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "infra/migrations"
	}
	if err := migrate.Run(ctx, pool, migrationsDir); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	log.Info("database migrations applied", "dir", migrationsDir)

	// --- Redis (Streams) ---
	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB})
	defer rdb.Close()

	asynqOpt := asynq.RedisClientOpt{Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB}

	// --- Templates ---
	templatesDir := os.Getenv("TEMPLATES_DIR")
	if templatesDir == "" {
		templatesDir = "templates"
	}
	templates, err := service.LoadTemplates(templatesDir)
	if err != nil {
		log.Warn("templates not loaded; deploy wizard will be empty", "dir", templatesDir, "err", err)
		templates = map[string]*service.Template{}
	}

	// --- gRPC agent link ---
	registry := grpcsrv.NewRegistry()
	tracker := commands.NewTracker()
	fileTracker := filestrack.NewTracker()
	publisher := realtime.NewPublisher(rdb)
	notifySvc := notify.NewNotifyService(queries, notify.NewDispatcher(), log)

	// --- Core orchestrator + worker ---
	mgr := service.NewManager(queries, registry, templates, tracker, publisher, notifySvc)
	sched := scheduler.New(queries, registry)
	agentServer := grpcsrv.NewServer(queries, rdb, registry, tracker, fileTracker, mgr, publisher, notifySvc, log)
	enq := worker.NewEnqueuer(asynqOpt)
	defer enq.Close()
	processor := worker.NewProcessor(mgr, queries, log)

	// --- Realtime hub ---
	termRelay := terminal.NewRelay(queries, registry)
	hub := ws.NewHub(rdb, log, termRelay)

	// --- Scheduled task cron runner ---
	cronRunner := cron.NewRunner(queries, mgr, log)
	go cronRunner.Start(ctx)

	// Start the gRPC server.
	grpcServer, err := startGRPC(ctx, cfg, agentServer, log)
	if err != nil {
		return err
	}
	defer grpcServer.GracefulStop()

	// Start the asynq deploy worker.
	go func() {
		if err := processor.Run(ctx, asynqOpt); err != nil {
			log.Error("deploy worker stopped", "err", err)
		}
	}()

	// Build and run the HTTP server.
	var caddy *caddyclient.Client
	if cfg.CaddyAdminURL != "" {
		caddy = caddyclient.NewClient(cfg.CaddyAdminURL)
	}
	a := &api{cfg: cfg, q: queries, pool: pool, rdb: rdb, mgr: mgr, sched: sched, enq: enq, reg: registry, fileTracker: fileTracker, caddy: caddy, log: log}
	app := buildHTTP(a, hub)

	go func() {
		<-ctx.Done()
		log.Info("shutting down")
		_ = app.ShutdownWithTimeout(10 * time.Second)
	}()

	log.Info("api listening", "http", cfg.HTTPAddr, "grpc", cfg.GRPCAddr)
	if err := app.Listen(cfg.HTTPAddr); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}

// startGRPC binds the AgentController gRPC server, configuring mTLS unless
// explicitly disabled for local development.
func startGRPC(ctx context.Context, cfg config.Config, srv *grpcsrv.Server, log *slog.Logger) (*grpclib.Server, error) {
	var opts []grpclib.ServerOption
	if cfg.GRPCTLSDisabled {
		log.Warn("gRPC mTLS disabled (dev only)")
	} else {
		if err := grpcsrv.EnsureDevCerts(cfg.CertDir); err != nil {
			return nil, err
		}
		tlsCfg, err := grpcsrv.LoadServerTLSConfig(cfg.CertDir)
		if err != nil {
			return nil, err
		}
		opts = append(opts, grpclib.Creds(credentials.NewTLS(tlsCfg)))
	}

	lis, err := net.Listen("tcp", cfg.GRPCAddr)
	if err != nil {
		return nil, err
	}
	gs := grpclib.NewServer(opts...)
	gen.RegisterAgentControllerServer(gs, srv)
	go func() {
		if err := gs.Serve(lis); err != nil {
			log.Error("grpc server stopped", "err", err)
		}
	}()
	return gs, nil
}

// buildHTTP assembles the Fiber app: middleware, REST routes, and the WS hub.
func buildHTTP(a *api, hub *ws.Hub) *fiber.App {
	app := fiber.New(fiber.Config{
		ErrorHandler: errorHandler,
		// Honor X-Forwarded-* from Pangolin / other reverse proxies.
		ProxyHeader:             fiber.HeaderXForwardedFor,
		EnableTrustedProxyCheck: true,
		TrustedProxies:          []string{"0.0.0.0/0", "::/0"},
	})
	app.Use(recover.New())

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	authmw := auth.New(auth.Config{
		JWKSURL: a.cfg.AuthJWKSURL,
		DevMode: a.cfg.AuthDevMode,
		ApiKeys: a.q,
	})

	apiGroup := app.Group("/api", authmw, suspendCheck(a.rdb))

	apiGroup.Get("/templates", a.listTemplates)

	apiGroup.Post("/services", a.createService)
	apiGroup.Get("/services", a.listServices)
	apiGroup.Get("/services/:id", a.getService)
	apiGroup.Delete("/services/:id", a.deleteService)
	apiGroup.Patch("/services/:id/env", a.updateServiceEnv)
	apiGroup.Patch("/services/:id/config", a.updateServiceConfig)
	apiGroup.Patch("/services/:id/limits", a.updateServiceLimits)
	apiGroup.Get("/services/:id/files", a.listFiles)
	apiGroup.Get("/services/:id/files/read", a.readFile)
	apiGroup.Post("/services/:id/files/write", a.writeFile)
	apiGroup.Post("/services/:id/files/mkdir", a.mkdirFile)
	apiGroup.Post("/services/:id/files/delete", a.deleteFile)
	apiGroup.Post("/services/:id/files/move", a.moveFile)
	apiGroup.Get("/services/:id/schedule", a.listScheduledTasks)
	apiGroup.Post("/services/:id/schedule", a.createScheduledTask)
	apiGroup.Delete("/services/:id/schedule/:taskId", a.deleteScheduledTask)
	apiGroup.Post("/services/:id/start", a.startService)
	apiGroup.Post("/services/:id/stop", a.stopService)
	apiGroup.Post("/services/:id/force-stop", a.forceStopService)
	apiGroup.Post("/services/:id/restart", a.restartService)
	apiGroup.Get("/services/:id/deployments", a.listDeployments)
	apiGroup.Get("/services/:id/metrics", a.getMetricsHistory)
	apiGroup.Get("/services/:id/health", a.getServiceHealth)
	apiGroup.Get("/services/:id/logs", a.getServiceLogs)
	apiGroup.Post("/services/:id/redeploy", a.redeployService)
	apiGroup.Post("/services/:id/reinstall", a.reinstallService)
	apiGroup.Patch("/services/:id/tags", a.updateServiceTags)

	apiGroup.Get("/services/:id/alerts", a.listAlertRules)
	apiGroup.Post("/services/:id/alerts", a.createAlertRule)
	apiGroup.Delete("/services/:id/alerts/:ruleId", a.deleteAlertRule)
	apiGroup.Patch("/services/:id/alerts/:ruleId", a.patchAlertRule)

	apiGroup.Get("/services/:id/plugins", a.listPlugins)
	apiGroup.Get("/services/:id/plugins/search", a.searchPlugins)
	apiGroup.Post("/services/:id/plugins/install", a.installPlugin)
	apiGroup.Delete("/services/:id/plugins/:pluginId", a.uninstallPlugin)
	apiGroup.Post("/services/:id/plugins/:pluginId/update", a.updatePlugin)
	apiGroup.Post("/services/:id/plugins/scan", a.scanPlugins)

	apiGroup.Get("/services/:id/cfg", a.cfgRead)
	apiGroup.Put("/services/:id/cfg", a.cfgWrite)
	apiGroup.Get("/services/:id/cfg/convars", a.cfgConvars)

	apiGroup.Get("/services/:id/backups", a.listBackups)
	apiGroup.Post("/services/:id/backups", a.createBackup)
	apiGroup.Delete("/services/:id/backups/:backupId", a.deleteBackup)
	apiGroup.Post("/services/:id/backups/:backupId/dismiss", a.dismissBackup)

	apiGroup.Get("/services/:id/domains", a.listServiceDomains)
	apiGroup.Post("/services/:id/domains", a.addServiceDomain)
	apiGroup.Delete("/services/:id/domains/:domainId", a.deleteServiceDomain)

	apiGroup.Get("/user/webhooks", a.listWebhooks)
	apiGroup.Post("/user/webhooks", a.createWebhook)
	apiGroup.Patch("/user/webhooks/:id", a.patchWebhook)
	apiGroup.Delete("/user/webhooks/:id", a.deleteWebhook)

	apiGroup.Get("/user/api-keys", a.listApiKeys)
	apiGroup.Post("/user/api-keys", a.createApiKey)
	apiGroup.Delete("/user/api-keys/:id", a.deleteApiKey)
	apiGroup.Patch("/user/profile", a.updateProfile)

	apiGroup.Get("/notifications", a.listNotifications)
	apiGroup.Post("/notifications/read-all", a.markAllNotificationsRead)

	admin := apiGroup.Group("/admin", auth.RequireRole(auth.RoleAdmin))
	admin.Post("/nodes", a.registerNode)
	admin.Get("/nodes", a.listNodes)
	admin.Get("/nodes/:id", a.getNode)
	admin.Get("/nodes/:id/services", a.listNodeServices)
	admin.Post("/nodes/:id/rotate-token", a.rotateNodeToken)
	admin.Get("/services", a.listAllServices)
	admin.Patch("/services/:id", a.adminPatchService)
	admin.Get("/audit", a.listAuditEvents)
	admin.Get("/customers", a.listCustomers)
	admin.Patch("/customers/:userId/suspend", a.suspendCustomer)
	admin.Patch("/customers/:userId/unsuspend", a.unsuspendCustomer)

	// Multiplexed realtime WebSocket (one per dashboard session).
	apiGroup.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	apiGroup.Get("/ws", websocket.New(hub.Serve, websocket.Config{
		HandshakeTimeout:  15 * time.Second,
		EnableCompression: false,
	}))

	return app
}

// errorHandler renders fiber errors as JSON {error: msg}.
func errorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	var fe *fiber.Error
	if errors.As(err, &fe) {
		code = fe.Code
	}
	return c.Status(code).JSON(fiber.Map{"error": err.Error()})
}
