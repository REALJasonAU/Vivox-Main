package files

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"

	gen "github.com/nexus-control/packages/proto/gen"
)

const (
	labelManagedBy = "managed-by"
	labelService   = "nexus.service_id"
	managedByValue = "nexus-agent"
	maxReadBytes   = 1 << 20 // 1 MiB
)

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
	if path == "" {
		path = "/"
	}
	out, err := h.exec(ctx, serviceID, "ls", "-la", "--time-style=+%s", path)
	if err != nil {
		return nil, err
	}
	return parseLsOutput(string(out)), nil
}

// ReadFile reads file contents up to maxReadBytes.
func (h *Handler) ReadFile(ctx context.Context, serviceID, path string) ([]byte, error) {
	out, err := h.exec(ctx, serviceID, "cat", path)
	if err != nil {
		return nil, err
	}
	if len(out) > maxReadBytes {
		return nil, fmt.Errorf("file exceeds %d byte limit", maxReadBytes)
	}
	return out, nil
}

// WriteFile writes content to a path inside the container.
func (h *Handler) WriteFile(ctx context.Context, serviceID, path string, content []byte) error {
	id, err := h.findContainer(ctx, serviceID)
	if err != nil {
		return err
	}
	if id == "" {
		return fmt.Errorf("no container found for service %s", serviceID)
	}
	execCfg := container.ExecOptions{
		Cmd:          []string{"sh", "-c", "cat > " + shellQuote(path)},
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

func (h *Handler) exec(ctx context.Context, serviceID string, cmd ...string) ([]byte, error) {
	id, err := h.findContainer(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, fmt.Errorf("no container found for service %s", serviceID)
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

