// Package docker is the agent's Docker Engine SDK wrapper. It turns the
// control plane's StartServiceTask / StopServiceTask / UpdateConfigTask commands
// into real container lifecycle operations, and for each running container it
// spins up the exec log pump and the metrics poller that feed telemetry back up
// the gRPC stream.
//
// The agent is stateless: the only durable source of truth is the Docker daemon
// itself. Containers are tagged with nexus labels so that after a reconnect the
// agent can still find and act on a service it did not start in this process.
package docker

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"

	"github.com/nexus-control/apps/agent/internal/exec"
	"github.com/nexus-control/apps/agent/internal/health"
	"github.com/nexus-control/apps/agent/internal/metrics"
	"github.com/nexus-control/apps/agent/internal/backup"
	gen "github.com/nexus-control/packages/proto/gen"
)

const (
	labelManagedBy = "managed-by"
	labelService   = "nexus.service_id"
	managedByValue = "nexus-agent"
	namePrefix     = "nexus-"
	// hostNetworkSentinel: a StartServiceTask whose port_bindings is exactly
	// ["host"] requests host networking (per plan section 5 — games).
	hostNetworkSentinel = "host"
)

// Sink is the upstream telemetry interface the per-container pumps need.
// *client.Sender satisfies it.
type Sink interface {
	SendLog(serviceID string, data []byte, streamType string) error
	SendMetric(serviceID string, sample metrics.Sample) error
	SendHealthCheck(serviceID string, healthy bool, statusCode int, latencyMs int64, errMsg string, intervalSec int32) error
}

// Manager implements client.CommandHandler using the Docker SDK.
type Manager struct {
	cli             *client.Client
	sink            Sink
	metricsInterval time.Duration

	mu      sync.Mutex
	running map[string]*serviceHandle // serviceID -> handle
}

// serviceHandle tracks the goroutines (log pump + metrics poller) for one
// running container so StopService can cancel them.
type serviceHandle struct {
	containerID string
	cancel      context.CancelFunc
}

// NewManager connects to the local Docker daemon (honoring DOCKER_HOST et al.)
// with API-version negotiation so it works across daemon versions.
func NewManager(sink Sink, metricsInterval time.Duration) (*Manager, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("init docker client: %w", err)
	}
	if metricsInterval <= 0 {
		metricsInterval = 5 * time.Second
	}
	return &Manager{
		cli:             cli,
		sink:            sink,
		metricsInterval: metricsInterval,
		running:         make(map[string]*serviceHandle),
	}, nil
}

// Close releases the Docker client.
func (m *Manager) Close() error { return m.cli.Close() }

// StartService pulls the image (pre-caching it), removes any stale container for
// the same service, creates and starts the new container, then launches the log
// and metrics pumps. It returns once the container is started; telemetry then
// flows asynchronously.
func (m *Manager) StartService(ctx context.Context, t *gen.StartServiceTask) error {
	serviceID := t.GetServiceId()
	if serviceID == "" || t.GetContainerImage() == "" {
		return fmt.Errorf("start: service_id and container_image are required")
	}

	// Pre-cache the image so the subsequent start is sub-2s for warm nodes.
	if err := m.pullImage(ctx, t.GetContainerImage()); err != nil {
		return fmt.Errorf("pull image %q: %w", t.GetContainerImage(), err)
	}

	if err := m.removeService(ctx, serviceID, 5); err != nil {
		return fmt.Errorf("reconcile existing container: %w", err)
	}

	containerEnv, runtime := peelRuntimeEnv(t.GetEnvVars())

	if runtime.ForceReinstall {
		if err := m.clearInstallMarker(ctx, serviceID); err != nil {
			return fmt.Errorf("clear install marker for reinstall: %w", err)
		}
	}

	installScript := strings.TrimSpace(runtime.InstallScript)
	if runtime.InstallerImage != "" && installScript != "" {
		needInstall := runtime.ForceReinstall
		if !needInstall {
			exists, err := m.installMarkerExists(ctx, serviceID)
			if err != nil {
				return fmt.Errorf("check install marker: %w", err)
			}
			needInstall = !exists
		}
		if needInstall {
			if err := m.runExternalInstall(ctx, serviceID, runtime.InstallerImage, installScript, containerEnv); err != nil {
				return fmt.Errorf("run installer: %w", err)
			}
		}
	}

	imgEntrypoint, imgCmd, err := m.imageCommand(ctx, t.GetContainerImage())
	if err != nil {
		return fmt.Errorf("inspect image %q: %w", t.GetContainerImage(), err)
	}

	lifecycle := buildLifecycleScript(runtime, imgEntrypoint, imgCmd)

	cfg := &container.Config{
		Image: t.GetContainerImage(),
		Env:   envSlice(containerEnv),
		Cmd:   []string{"/bin/sh", "-c", lifecycle},
		Labels: map[string]string{
			labelManagedBy: managedByValue,
			labelService:   serviceID,
		},
		WorkingDir: dataMountPath,
	}

	hostCfg := &container.HostConfig{
		Resources: container.Resources{Memory: t.GetMemoryLimitBytes()},
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeVolume,
				Source: dataVolumeName(serviceID),
				Target: dataMountPath,
			},
		},
	}
	if runtime.CPUShares > 0 {
		threads := runtime.CPUShares / 1024
		if threads < 1 {
			threads = 1
		}
		hostCfg.Resources.NanoCPUs = threads * 1_000_000_000
	}
	if runtime.DiskGB > 0 {
		hostCfg.StorageOpt = map[string]string{
			"size": fmt.Sprintf("%dG", runtime.DiskGB),
		}
	}

	if err := applyNetworking(cfg, hostCfg, t.GetPortBindings()); err != nil {
		return fmt.Errorf("port bindings: %w", err)
	}

	created, err := m.cli.ContainerCreate(ctx, cfg, hostCfg, nil, nil, namePrefix+serviceID)
	if err != nil {
		return fmt.Errorf("create container: %w", err)
	}
	if err := m.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start container: %w", err)
	}

	m.track(serviceID, created.ID, t)
	return nil
}

// StopService gracefully stops (SIGTERM + timeout) and removes the service's
// container, cancelling its telemetry pumps. It works whether or not this
// process started the container (stateless reconcile via labels).
func (m *Manager) StopService(ctx context.Context, t *gen.StopServiceTask) error {
	serviceID := t.GetServiceId()
	if serviceID == "" {
		return fmt.Errorf("stop: service_id is required")
	}
	timeout := int(t.GetTimeoutSeconds())
	if timeout <= 0 {
		timeout = 10
	}
	return m.removeService(ctx, serviceID, timeout)
}

// UpdateConfig applies new environment variables. Docker cannot mutate env on a
// live container, so the container is inspected, recreated with merged env, and
// restarted — preserving image, port bindings, and resource limits.
func (m *Manager) UpdateConfig(ctx context.Context, t *gen.UpdateConfigTask) error {
	serviceID := t.GetServiceId()
	if serviceID == "" {
		return fmt.Errorf("update: service_id is required")
	}

	id, ok, err := m.findContainer(ctx, serviceID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("update: no container found for service %s", serviceID)
	}

	inspected, err := m.cli.ContainerInspect(ctx, id)
	if err != nil {
		return fmt.Errorf("inspect container: %w", err)
	}

	newCfg := *inspected.Config
	newCfg.Env = mergeEnv(inspected.Config.Env, t.GetNewEnvVars())

	if err := m.removeService(ctx, serviceID, 5); err != nil {
		return fmt.Errorf("remove for recreate: %w", err)
	}

	created, err := m.cli.ContainerCreate(ctx, &newCfg, inspected.HostConfig, nil, nil, namePrefix+serviceID)
	if err != nil {
		return fmt.Errorf("recreate container: %w", err)
	}
	if err := m.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("restart container: %w", err)
	}

	m.track(serviceID, created.ID, nil)
	return nil
}

// RunBackup archives container volume data for a service.
func (m *Manager) RunBackup(ctx context.Context, serviceID, backupID string) (int64, error) {
	return backup.Run(ctx, m.cli, serviceID, backupID)
}

// pullImage fetches a container image (the pull is async in the daemon but we wait until the reader
// actually completes before we return).
func (m *Manager) pullImage(ctx context.Context, ref string) error {
	rc, err := m.cli.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return err
	}
	defer rc.Close()
	_, err = io.Copy(io.Discard, rc)
	return err
}

// removeDataVolume deletes the persistent server files volume for a service.
func (m *Manager) removeDataVolume(ctx context.Context, serviceID string) error {
	name := dataVolumeName(serviceID)
	if err := m.cli.VolumeRemove(ctx, name, true); err != nil {
		if client.IsErrNotFound(err) {
			return nil
		}
		return err
	}
	return nil
}

// imageCommand returns the image default ENTRYPOINT and CMD for post-install startup.
func (m *Manager) imageCommand(ctx context.Context, ref string) (entrypoint, cmd []string, err error) {
	inspect, _, err := m.cli.ImageInspectWithRaw(ctx, ref)
	if err != nil {
		return nil, nil, err
	}
	return append([]string{}, inspect.Config.Entrypoint...), append([]string{}, inspect.Config.Cmd...), nil
}

// track records the running handle and starts the log + metrics pumps under a
// per-service context that StopService cancels.
func (m *Manager) track(serviceID, containerID string, startTask *gen.StartServiceTask) {
	pumpCtx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	m.running[serviceID] = &serviceHandle{containerID: containerID, cancel: cancel}
	m.mu.Unlock()

	// Log pump: attach to stdout/stderr and follow.
	go func() {
		logs, err := m.cli.ContainerLogs(pumpCtx, containerID, container.LogsOptions{
			ShowStdout: true,
			ShowStderr: true,
			Follow:     true,
			Timestamps: false,
		})
		if err != nil {
			return
		}
		_ = exec.Stream(pumpCtx, logs, serviceID, m.sink)
	}()

	// Metrics poller: sample container stats on an interval.
	opener := func(ctx context.Context) (io.ReadCloser, error) {
		stats, err := m.cli.ContainerStats(ctx, containerID, false)
		if err != nil {
			return nil, err
		}
		return stats.Body, nil
	}
	diskReader := func(ctx context.Context) (uint64, bool) {
		n, err := m.measureDataDirBytes(ctx, containerID)
		if err != nil {
			return 0, false
		}
		return n, true
	}
	go metrics.Poll(pumpCtx, serviceID, m.metricsInterval, opener, diskReader, m.sink)

	if startTask != nil && startTask.GetHealthPath() != "" && startTask.GetHealthPort() > 0 {
		go m.startHealthChecker(pumpCtx, serviceID, containerID, startTask)
	}
}

func (m *Manager) startHealthChecker(ctx context.Context, serviceID, containerID string, t *gen.StartServiceTask) {
	inspected, err := m.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return
	}
	ip := ""
	if inspected.NetworkSettings != nil {
		for _, net := range inspected.NetworkSettings.Networks {
			if net != nil && net.IPAddress != "" {
				ip = net.IPAddress
				break
			}
		}
	}
	if ip == "" {
		return
	}
	intervalSec := t.GetHealthIntervalSec()
	if intervalSec <= 0 {
		intervalSec = 30
	}
	timeoutSec := t.GetHealthTimeoutSec()
	if timeoutSec <= 0 {
		timeoutSec = 5
	}
	checker := health.NewChecker(
		serviceID, ip, t.GetHealthPath(), int(t.GetHealthPort()),
		time.Duration(intervalSec)*time.Second,
		time.Duration(timeoutSec)*time.Second,
		intervalSec,
		func(r health.Result) {
			_ = m.sink.SendHealthCheck(r.ServiceID, r.Healthy, r.StatusCode, r.LatencyMs, r.Error, r.IntervalSec)
		},
	)
	checker.Run(ctx)
}

// removeService cancels pumps and stops+removes the service's container if it
// exists. Missing containers are not an error (idempotent stop).
func (m *Manager) removeService(ctx context.Context, serviceID string, timeoutSecs int) error {
	m.mu.Lock()
	if h, ok := m.running[serviceID]; ok {
		h.cancel()
		delete(m.running, serviceID)
	}
	m.mu.Unlock()

	id, ok, err := m.findContainer(ctx, serviceID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}

	to := timeoutSecs
	if err := m.cli.ContainerStop(ctx, id, container.StopOptions{Timeout: &to}); err != nil {
		// Continue to removal even if stop reports an error (already stopped).
		_ = err
	}
	if err := m.cli.ContainerRemove(ctx, id, container.RemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("remove container: %w", err)
	}
	return nil
}

// findContainer locates a (possibly stopped) container for a service by label.
func (m *Manager) findContainer(ctx context.Context, serviceID string) (id string, found bool, err error) {
	f := filters.NewArgs(
		filters.Arg("label", labelManagedBy+"="+managedByValue),
		filters.Arg("label", labelService+"="+serviceID),
	)
	list, err := m.cli.ContainerList(ctx, container.ListOptions{All: true, Filters: f})
	if err != nil {
		return "", false, fmt.Errorf("list containers: %w", err)
	}
	if len(list) == 0 {
		return "", false, nil
	}
	return list[0].ID, true, nil
}

// applyNetworking sets either host networking (sentinel) or explicit published
// port bindings parsed from Docker-style specs (e.g. "25565:25565/tcp").
func applyNetworking(cfg *container.Config, hostCfg *container.HostConfig, bindings []string) error {
	if len(bindings) == 0 {
		return nil
	}
	if len(bindings) == 1 && bindings[0] == hostNetworkSentinel {
		hostCfg.NetworkMode = container.NetworkMode(hostNetworkSentinel)
		return nil
	}
	exposed, portMap, err := nat.ParsePortSpecs(bindings)
	if err != nil {
		return err
	}
	cfg.ExposedPorts = exposed
	hostCfg.PortBindings = portMap
	return nil
}

// envSlice converts an env map into a deterministic "KEY=VALUE" slice.
func envSlice(env map[string]string) []string {
	if len(env) == 0 {
		return nil
	}
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return out
}

// peelRuntimeEnv strips Vivox control-plane env vars consumed by the agent
// before passing the remainder to the container.
func peelRuntimeEnv(env map[string]string) (map[string]string, runtimeEnv) {
	if len(env) == 0 {
		return nil, runtimeEnv{}
	}
	out := make(map[string]string, len(env))
	var rt runtimeEnv
	for k, v := range env {
		switch k {
		case envVivoxCPU:
			rt.CPUShares, _ = strconv.ParseInt(v, 10, 64)
		case envVivoxDisk:
			rt.DiskGB, _ = strconv.ParseInt(v, 10, 64)
		case envVivoxStartup:
			rt.StartupCmd = v
		case envVivoxInstall:
			rt.InstallScript = v
		case envVivoxInstallerImage:
			rt.InstallerImage = v
		case envVivoxSkipInlineInstall:
			rt.SkipInlineInstall = v == "1" || strings.EqualFold(v, "true")
		case envVivoxForce:
			rt.ForceReinstall = v == "1" || strings.EqualFold(v, "true")
		default:
			out[k] = v
		}
	}
	return out, rt
}

// mergeEnv overlays updates onto an existing "KEY=VALUE" env slice.
func mergeEnv(existing []string, updates map[string]string) []string {
	merged := map[string]string{}
	for _, kv := range existing {
		for i := 0; i < len(kv); i++ {
			if kv[i] == '=' {
				merged[kv[:i]] = kv[i+1:]
				break
			}
		}
	}
	for k, v := range updates {
		merged[k] = v
	}
	return envSlice(merged)
}

// measureDataDirBytes runs du inside the container against /mnt/server.
func (m *Manager) measureDataDirBytes(ctx context.Context, containerID string) (uint64, error) {
	execResp, err := m.cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          []string{"du", "-sb", "/mnt/server"},
		AttachStdout: true,
		AttachStderr: false,
	})
	if err != nil {
		return 0, err
	}
	attach, err := m.cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return 0, err
	}
	defer attach.Close()

	sc := bufio.NewScanner(attach.Reader)
	if !sc.Scan() {
		return 0, fmt.Errorf("du produced no output")
	}
	fields := strings.Fields(sc.Text())
	if len(fields) == 0 {
		return 0, fmt.Errorf("parse du output")
	}
	return strconv.ParseUint(fields[0], 10, 64)
}
