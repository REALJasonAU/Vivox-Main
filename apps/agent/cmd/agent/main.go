// Command agent is the Nexus Control stateless edge agent.
package main

import (
	"context"
	"flag"
	"log/slog"
	"math/rand"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/nexus-control/apps/agent/internal/client"
	"github.com/nexus-control/apps/agent/internal/docker"
	"github.com/nexus-control/apps/agent/internal/exec"
	"github.com/nexus-control/apps/agent/internal/files"
	"github.com/nexus-control/apps/agent/internal/health"
	gen "github.com/nexus-control/packages/proto/gen"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, mock := parseConfig(log)

	if cfg.AgentID == "" {
		log.Error("missing agent id")
		os.Exit(1)
	}
	if cfg.Address == "" {
		log.Error("missing control-plane address")
		os.Exit(1)
	}
	if !cfg.Insecure && (cfg.CertFile == "" || cfg.KeyFile == "" || cfg.CAFile == "") {
		log.Error("mTLS requires -cert, -key and -ca (or -insecure for dev)")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sender := client.NewSender(cfg.AgentID)

	var handler client.CommandHandler
	var fileHandler client.FileHandler
	var terminalHandler client.TerminalHandler
	if mock {
		log.Info("starting in mock mode")
		handler = newMockHandler(sender, cfg.MetricsInterval)
		fileHandler = newMockFileHandler()
		terminalHandler = exec.NewMockManager(sender)
	} else {
		mgr, err := docker.NewManager(sender, cfg.MetricsInterval)
		if err != nil {
			log.Error("docker init failed", "err", err)
			os.Exit(1)
		}
		defer mgr.Close()
		handler = mgr
		fh, err := files.NewHandler()
		if err != nil {
			log.Error("files handler init failed", "err", err)
			os.Exit(1)
		}
		defer fh.Close()
		fileHandler = &files.ClientAdapter{Handler: fh}
		termMgr, err := exec.NewTerminalManager(sender)
		if err != nil {
			log.Error("terminal handler init failed", "err", err)
			os.Exit(1)
		}
		defer termMgr.Close()
		terminalHandler = termMgr
	}

	runner := client.NewRunner(cfg, sender, handler, fileHandler, terminalHandler, log)

	healthAddr := cfg.HealthAddr
	if healthAddr == "" {
		healthAddr = ":8082"
	}
	healthSrv := health.NewServer(healthAddr, runner.ConnectionStatus)
	go healthSrv.Start(ctx)
	log.Info("health server listening", "addr", healthAddr)

	log.Info("agent starting", "agent_id", cfg.AgentID, "addr", cfg.Address, "insecure", cfg.Insecure, "mock", mock)

	if err := runner.Run(ctx); err != nil && err != context.Canceled {
		log.Error("agent stopped", "err", err)
		os.Exit(1)
	}
	log.Info("agent shut down cleanly")
}

func parseConfig(log *slog.Logger) (client.Config, bool) {
	var (
		configPath  = flag.String("config", "", "path to YAML config file")
		addr        = flag.String("addr", env("NEXUS_CONTROL_ADDR", ""), "control-plane gRPC address host:port")
		agentID     = flag.String("agent-id", env("NEXUS_AGENT_ID", ""), "this node's agent id")
		token       = flag.String("token", env("NEXUS_AGENT_TOKEN", ""), "agent bearer token")
		certFile    = flag.String("cert", env("NEXUS_AGENT_CERT", ""), "client TLS certificate (PEM)")
		keyFile     = flag.String("key", env("NEXUS_AGENT_KEY", ""), "client TLS private key (PEM)")
		caFile      = flag.String("ca", env("NEXUS_AGENT_CA", ""), "CA bundle to verify the control plane (PEM)")
		serverName  = flag.String("server-name", env("NEXUS_AGENT_SERVER_NAME", ""), "override TLS server name (SNI)")
		insecure    = flag.Bool("insecure", envBool("NEXUS_AGENT_INSECURE"), "disable mTLS (dev/-mock only)")
		mock        = flag.Bool("mock", envBool("NEXUS_AGENT_MOCK"), "run the fake log/metric generator instead of Docker")
		hbInterval  = flag.Duration("heartbeat-interval", 5*time.Second, "heartbeat cadence")
		mInterval   = flag.Duration("metrics-interval", 5*time.Second, "metrics sampling cadence")
		healthAddr  = flag.String("health-addr", env("NEXUS_AGENT_HEALTH_ADDR", ":8082"), "HTTP health listen address")
	)
	flag.Parse()

	var cfg client.Config
	if *configPath != "" {
		fileCfg, err := client.LoadConfigFile(*configPath)
		if err != nil {
			log.Error("load config file failed", "path", *configPath, "err", err)
			os.Exit(1)
		}
		cfg, err = fileCfg.ToConfig()
		if err != nil {
			log.Error("invalid config file", "err", err)
			os.Exit(1)
		}
		if fileCfg.Mock {
			*mock = true
		}
	}

	overrides := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { overrides[f.Name] = true })

	if overrides["addr"] || cfg.Address == "" {
		cfg.Address = *addr
	}
	if overrides["agent-id"] || cfg.AgentID == "" {
		cfg.AgentID = *agentID
	}
	if overrides["token"] || cfg.Token == "" {
		cfg.Token = *token
	}
	if overrides["cert"] || cfg.CertFile == "" {
		cfg.CertFile = *certFile
	}
	if overrides["key"] || cfg.KeyFile == "" {
		cfg.KeyFile = *keyFile
	}
	if overrides["ca"] || cfg.CAFile == "" {
		cfg.CAFile = *caFile
	}
	if overrides["server-name"] || cfg.ServerName == "" {
		cfg.ServerName = *serverName
	}
	if overrides["insecure"] {
		cfg.Insecure = *insecure
	}
	if overrides["heartbeat-interval"] {
		cfg.HeartbeatInterval = *hbInterval
	}
	if overrides["metrics-interval"] {
		cfg.MetricsInterval = *mInterval
	}
	if overrides["health-addr"] || cfg.HealthAddr == "" {
		cfg.HealthAddr = *healthAddr
	}

	return cfg, *mock
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func envBool(key string) bool {
	switch os.Getenv(key) {
	case "1", "true", "TRUE", "yes":
		return true
	default:
		return false
	}
}

// --- Mock mode -------------------------------------------------------------

type mockSink interface {
	SendLog(serviceID string, data []byte, streamType string) error
	SendMetric(serviceID string, cpuPercent float64, memBytes uint64) error
}

type mockHandler struct {
	sink            mockSink
	metricsInterval time.Duration
	mu              sync.Mutex
	running         map[string]context.CancelFunc
}

func newMockHandler(sink mockSink, metricsInterval time.Duration) *mockHandler {
	if metricsInterval <= 0 {
		metricsInterval = 5 * time.Second
	}
	return &mockHandler{
		sink:            sink,
		metricsInterval: metricsInterval,
		running:         make(map[string]context.CancelFunc),
	}
}

func (h *mockHandler) StartService(_ context.Context, t *gen.StartServiceTask) error {
	serviceID := t.GetServiceId()
	ctx, cancel := context.WithCancel(context.Background())
	h.mu.Lock()
	if old, ok := h.running[serviceID]; ok {
		old()
	}
	h.running[serviceID] = cancel
	h.mu.Unlock()
	go h.generate(ctx, serviceID, t.GetContainerImage())
	return nil
}

func (h *mockHandler) StopService(_ context.Context, t *gen.StopServiceTask) error {
	h.mu.Lock()
	if cancel, ok := h.running[t.GetServiceId()]; ok {
		cancel()
		delete(h.running, t.GetServiceId())
	}
	h.mu.Unlock()
	return nil
}

func (h *mockHandler) UpdateConfig(_ context.Context, _ *gen.UpdateConfigTask) error {
	return nil
}

type mockFileHandler struct{}

func newMockFileHandler() *mockFileHandler { return &mockFileHandler{} }

func (h *mockFileHandler) ListFiles(_ context.Context, t *gen.FileListTask) ([]*gen.FileEntry, error) {
	return []*gen.FileEntry{
		{Name: "data", IsDir: true, Size: 4096, Modified: "0", Permissions: "drwxr-xr-x"},
		{Name: "server.properties", IsDir: false, Size: 128, Modified: "0", Permissions: "-rw-r--r--"},
	}, nil
}

func (h *mockFileHandler) ReadFile(_ context.Context, t *gen.FileReadTask) ([]byte, error) {
	return []byte("# mock file content for " + t.GetPath() + "\n"), nil
}

func (h *mockFileHandler) WriteFile(_ context.Context, _ *gen.FileWriteTask) error {
	return nil
}

func (h *mockHandler) generate(ctx context.Context, serviceID, image string) {
	lines := []string{
		"Starting container image " + image,
		"[INFO] Loading configuration...",
		"[INFO] Bound to port 25565",
	}
	logTick := time.NewTicker(500 * time.Millisecond)
	defer logTick.Stop()
	metricTick := time.NewTicker(h.metricsInterval)
	defer metricTick.Stop()
	var i int
	for {
		select {
		case <-ctx.Done():
			return
		case <-logTick.C:
			line := lines[i%len(lines)] + "\n"
			i++
			_ = h.sink.SendLog(serviceID, []byte(line), "stdout")
		case <-metricTick.C:
			cpu := 5 + rand.Float64()*40
			mem := uint64(256+rand.Intn(768)) * 1024 * 1024
			_ = h.sink.SendMetric(serviceID, cpu, mem)
		}
	}
}
