package files

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"

	gen "github.com/nexus-control/packages/proto/gen"
)

const (
	labelManagedBy = "managed-by"
	labelService   = "nexus.service_id"
	managedByValue = "nexus-agent"
	maxReadBytes   = 1 << 20   // 1 MiB (for regular files)
	serverDataRoot = "/mnt/server"

	// Special virtual paths for backup operations (no container exec needed).
	backupReadPrefix    = "/__backup_download__/"
	backupRestorePrefix = "/__backup_restore__/"
	backupDir           = "/var/lib/vivox/backups"
	backupImage         = "alpine:3"
)

// ErrContainerNotRunning is returned when file ops require a running container.
var ErrContainerNotRunning = errors.New("container is not running")

// Handler performs file operations inside a service container via docker exec.
type Handler struct {
	cli *client.Client
}

// NewHandler connects to the local Docker daemon.
func NewHandler() (*Handler, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("init docker client: %w", err)
	}
	return &Handler{cli: cli}, nil
}

// Close releases the Docker client.
func (h *Handler) Close() error {
	if h.cli == nil {
		return nil
	}
	return h.cli.Close()
}

// ListFiles runs ls -la inside the container and parses entries.
func (h *Handler) ListFiles(ctx context.Context, serviceID, path string) ([]*gen.FileEntry, error) {
	safe, err := validateServicePath(path)
	if err != nil {
		return nil, err
	}
	out, err := h.exec(ctx, serviceID, "ls", "-la", "--time-style=+%s", safe)
	if err != nil {
		return nil, err
	}
	return parseLsOutput(string(out)), nil
}

// ReadFile reads file contents. Special path /__backup_download__/{id} reads a
// backup archive directly from BackupDir without requiring a running container.
func (h *Handler) ReadFile(ctx context.Context, serviceID, path string) ([]byte, error) {
	if strings.HasPrefix(path, backupReadPrefix) {
		backupID := strings.TrimPrefix(path, backupReadPrefix)
		archivePath := filepath.Join(backupDir, backupID+".tar.gz")
		data, err := os.ReadFile(archivePath)
		if err != nil {
			return nil, fmt.Errorf("backup %q not found: %w", backupID, err)
		}
		return data, nil
	}

	safe, err := validateServicePath(path)
	if err != nil {
		return nil, err
	}
	out, err := h.exec(ctx, serviceID, "cat", safe)
	if err != nil {
		return nil, err
	}
	if len(out) > maxReadBytes {
		return nil, fmt.Errorf("file exceeds %d byte limit", maxReadBytes)
	}
	return out, nil
}

// RestoreBackup extracts a backup archive back into the service data volume.
// It runs an ephemeral alpine container with both the backup dir and the data
// volume mounted, then runs tar to overwrite /data with the archived contents.
func (h *Handler) RestoreBackup(ctx context.Context, serviceID, backupID string) error {
	archivePath := filepath.Join(backupDir, backupID+".tar.gz")
	if _, err := os.Stat(archivePath); err != nil {
		return fmt.Errorf("backup archive not found: %w", err)
	}

	// Find the service container to get its data volume.
	containerID, err := h.findContainer(ctx, serviceID)
	if err != nil {
		return fmt.Errorf("find service container: %w", err)
	}
	if containerID == "" {
		return fmt.Errorf("no container found for service %s — deploy the server first", serviceID)
	}

	// Pull alpine image (best-effort; might already be cached).
	if rc, err := h.cli.ImagePull(ctx, backupImage, image.PullOptions{}); err == nil {
		_, _ = io.Copy(io.Discard, rc)
		rc.Close()
	}

	// Create an ephemeral restore container:
	//   - VolumesFrom the service container (mounts its data volume at /data)
	//   - Bind the backup directory as /backup (read-only)
	//   - Extracts the archive, overwriting /data
	resp, err := h.cli.ContainerCreate(ctx, &container.Config{
		Image: backupImage,
		Cmd:   []string{"tar", "xzf", "/backup/" + backupID + ".tar.gz", "-C", "/data", "--overwrite"},
	}, &container.HostConfig{
		VolumesFrom: []string{containerID},
		Binds:       []string{backupDir + ":/backup:ro"},
	}, nil, nil, "")
	if err != nil {
		return fmt.Errorf("create restore container: %w", err)
	}
	defer func() {
		_ = h.cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
	}()

	if err := h.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start restore container: %w", err)
	}

	statusCh, errCh := h.cli.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("restore container error: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			return fmt.Errorf("restore exited with code %d", status.StatusCode)
		}
	}
	return nil
}

// WriteFile writes content to a path inside the container. Special path
// /__backup_restore__/{id} triggers a backup restore instead of a file write.
func (h *Handler) WriteFile(ctx context.Context, serviceID, path string, content []byte) error {
	if strings.HasPrefix(path, backupRestorePrefix) {
		backupID := strings.TrimPrefix(path, backupRestorePrefix)
		return h.RestoreBackup(ctx, serviceID, backupID)
	}

	safe, err := validateServicePath(path)
	if err != nil {
		return err
	}
	dir := safe[:strings.LastIndex(safe, "/")]
	if dir == "" {
		dir = serverDataRoot
	}
	if _, err := h.exec(ctx, serviceID, "sh", "-c", fmt.Sprintf("mkdir -p %s", shellQuote(dir))); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	if _, err := h.exec(ctx, serviceID, "sh", "-c", fmt.Sprintf("mkdir -p %s", shellQuote(dir))); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	id, err := h.ensureRunning(ctx, serviceID)
	if err != nil {
		return err
	}
	execCfg := container.ExecOptions{
		Cmd:          []string{"sh", "-c", "cat > " + shellQuote(safe)},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	}
	e, err := h.cli.ContainerExecCreate(ctx, id, execCfg)
	if err != nil {
		return err
	}
	attach, err := h.cli.ContainerExecAttach(ctx, e.ID, container.ExecStartOptions{})
	if err != nil {
		return err
	}
	defer attach.Close()
	if _, err := io.Copy(attach.Conn, bytes.NewReader(content)); err != nil {
		return err
	}
	attach.Close()
	inspect, err := h.cli.ContainerExecInspect(ctx, e.ID)
	if err != nil {
		return err
	}
	if inspect.ExitCode != 0 {
		return fmt.Errorf("write failed with exit code %d", inspect.ExitCode)
	}
	return nil
}

// DeleteFile removes a file inside the service container via docker exec.
func (h *Handler) DeleteFile(ctx context.Context, serviceID, path string) error {
	safe, err := validateServicePath(path)
	if err != nil {
		return err
	}
	_, err = h.exec(ctx, serviceID, "rm", "-f", "--", safe)
	return err
}

func validateServicePath(path string) (string, error) {
	if path == "" {
		path = serverDataRoot
	}
	clean := filepath.Clean(path)
	if clean != serverDataRoot && !strings.HasPrefix(clean, serverDataRoot+"/") {
		return "", fmt.Errorf("path must be under %s", serverDataRoot)
	}
	return clean, nil
}

func (h *Handler) exec(ctx context.Context, serviceID string, cmd ...string) ([]byte, error) {
	id, err := h.ensureRunning(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}
	e, err := h.cli.ContainerExecCreate(ctx, id, execCfg)
	if err != nil {
		return nil, err
	}
	attach, err := h.cli.ContainerExecAttach(ctx, e.ID, container.ExecStartOptions{})
	if err != nil {
		return nil, err
	}
	defer attach.Close()
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, attach.Reader)
	inspect, err := h.cli.ContainerExecInspect(ctx, e.ID)
	if err != nil {
		return buf.Bytes(), err
	}
	if inspect.ExitCode != 0 {
		return nil, fmt.Errorf("exec %v failed: %s", cmd, strings.TrimSpace(buf.String()))
	}
	return buf.Bytes(), nil
}

func (h *Handler) findContainer(ctx context.Context, serviceID string) (string, error) {
	list, err := h.cli.ContainerList(ctx, container.ListOptions{
		All: true,
		Filters: filters.NewArgs(
			filters.Arg("label", labelManagedBy+"="+managedByValue),
			filters.Arg("label", labelService+"="+serviceID),
		),
	})
	if err != nil {
		return "", err
	}
	if len(list) == 0 {
		return "", nil
	}
	return list[0].ID, nil
}

func (h *Handler) ensureRunning(ctx context.Context, serviceID string) (string, error) {
	id, err := h.findContainer(ctx, serviceID)
	if err != nil {
		return "", err
	}
	if id == "" {
		return "", fmt.Errorf("no container found for service %s", serviceID)
	}
	info, err := h.cli.ContainerInspect(ctx, id)
	if err == nil && !info.State.Running {
		return "", ErrContainerNotRunning
	}
	return id, nil
}

// parseLsOutput parses `ls -la --time-style=+%s` lines into FileEntry slices.
func parseLsOutput(output string) []*gen.FileEntry {
	lines := strings.Split(output, "\n")
	var entries []*gen.FileEntry
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		perms := fields[0]
		name := fields[len(fields)-1]
		if name == "." || name == ".." {
			continue
		}
		size, _ := strconv.ParseInt(fields[4], 10, 64)
		modified := fields[5]
		isDir := strings.HasPrefix(perms, "d")
		entries = append(entries, &gen.FileEntry{
			Name:        name,
			IsDir:       isDir,
			Size:        size,
			Modified:    modified,
			Permissions: perms,
		})
	}
	return entries
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

