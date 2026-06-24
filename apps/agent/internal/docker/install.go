package docker

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
)

const markerCheckImage = "alpine:3.20"

// buildInstallWrapper prepares an install script for the JDK installer container.
func buildInstallWrapper(installScript string) string {
	body := strings.TrimSpace(installScript)
	var b strings.Builder
	b.WriteString("set -euo pipefail\n")
	b.WriteString("apk add --no-cache bash curl python3 2>/dev/null || true\n")
	b.WriteString(fmt.Sprintf("mkdir -p %s\n", dataMountPath))
	b.WriteString(fmt.Sprintf("cd %s\n", dataMountPath))
	b.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		b.WriteString("\n")
	}
	b.WriteString(fmt.Sprintf("touch %s/%s\n", dataMountPath, installMarker))
	return b.String()
}

func (m *Manager) installMarkerExists(ctx context.Context, serviceID string) (bool, error) {
	if err := m.pullImage(ctx, markerCheckImage); err != nil {
		return false, fmt.Errorf("pull marker check image: %w", err)
	}
	script := fmt.Sprintf("test -f %s/%s", dataMountPath, installMarker)
	code, err := m.runEphemeralOnVolume(ctx, serviceID+"-marker-check", markerCheckImage, dataVolumeName(serviceID), script, nil)
	if err != nil {
		return false, err
	}
	return code == 0, nil
}

func (m *Manager) clearInstallMarker(ctx context.Context, serviceID string) error {
	if err := m.pullImage(ctx, markerCheckImage); err != nil {
		return fmt.Errorf("pull marker check image: %w", err)
	}
	script := fmt.Sprintf("rm -f %s/%s", dataMountPath, installMarker)
	_, err := m.runEphemeralOnVolume(ctx, serviceID+"-clear-marker", markerCheckImage, dataVolumeName(serviceID), script, nil)
	return err
}

func (m *Manager) runExternalInstall(ctx context.Context, serviceID, installerImage, installScript string, containerEnv map[string]string) error {
	if err := m.pullImage(ctx, installerImage); err != nil {
		return fmt.Errorf("pull installer image %q: %w", installerImage, err)
	}
	script := buildInstallWrapper(installScript)
	_, err := m.runEphemeralOnVolume(ctx, serviceID+"-install", installerImage, dataVolumeName(serviceID), script, containerEnv)
	if err != nil {
		return fmt.Errorf("external install: %w", err)
	}
	return nil
}

// runEphemeralOnVolume runs a one-shot shell script in a throwaway container with
// the service data volume mounted at dataMountPath. Returns the exit code.
func (m *Manager) runEphemeralOnVolume(
	ctx context.Context,
	name, image, volumeName, script string,
	env map[string]string,
) (int, error) {
	cfg := &container.Config{
		Image:      image,
		Env:        envSlice(env),
		Cmd:        []string{"/bin/sh", "-c", script},
		WorkingDir: dataMountPath,
	}
	hostCfg := &container.HostConfig{
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeVolume,
				Source: volumeName,
				Target: dataMountPath,
			},
		},
		AutoRemove: false,
	}

	created, err := m.cli.ContainerCreate(ctx, cfg, hostCfg, nil, nil, name)
	if err != nil {
		return -1, fmt.Errorf("create ephemeral container: %w", err)
	}
	defer func() {
		_ = m.cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})
	}()

	if err := m.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		return -1, fmt.Errorf("start ephemeral container: %w", err)
	}

	statusCh, errCh := m.cli.ContainerWait(ctx, created.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return -1, fmt.Errorf("wait ephemeral container: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			logs, _ := m.cli.ContainerLogs(ctx, created.ID, container.LogsOptions{ShowStdout: true, ShowStderr: true})
			if logs != nil {
				buf, _ := io.ReadAll(logs)
				_ = logs.Close()
				return int(status.StatusCode), fmt.Errorf("script exited %d: %s", status.StatusCode, string(buf))
			}
			return int(status.StatusCode), fmt.Errorf("script exited %d", status.StatusCode)
		}
		return 0, nil
	case <-ctx.Done():
		return -1, ctx.Err()
	}
	return 0, nil
}
