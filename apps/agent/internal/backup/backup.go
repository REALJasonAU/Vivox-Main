package backup

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

const (
	BackupDir      = "/var/lib/vivox/backups"
	backupImage    = "alpine:3"
	labelManagedBy   = "managed-by"
	labelService     = "nexus.service_id"
	managedByValue   = "nexus-agent"
)

// Run creates a .tar.gz backup of the named service's container data directory.
func Run(ctx context.Context, docker *client.Client, serviceID, backupID string) (int64, error) {
	containers, err := docker.ContainerList(ctx, container.ListOptions{
		All: true,
		Filters: filters.NewArgs(
			filters.Arg("label", labelManagedBy+"="+managedByValue),
			filters.Arg("label", labelService+"="+serviceID),
		),
	})
	if err != nil {
		return 0, err
	}
	if len(containers) == 0 {
		return 0, fmt.Errorf("container not found for service %s", serviceID)
	}
	containerID := containers[0].ID

	if err := os.MkdirAll(BackupDir, 0o755); err != nil {
		return 0, err
	}

	archivePath := filepath.Join(BackupDir, backupID+".tar.gz")

	pullReader, pullErr := docker.ImagePull(ctx, backupImage, image.PullOptions{})
	if pullErr == nil {
		_, _ = io.Copy(io.Discard, pullReader)
		pullReader.Close()
	}

	resp, err := docker.ContainerCreate(ctx, &container.Config{
		Image: backupImage,
		Cmd:   []string{"tar", "czf", "/backup/" + backupID + ".tar.gz", "-C", "/data", "."},
	}, &container.HostConfig{
		VolumesFrom: []string{containerID},
		Binds:       []string{BackupDir + ":/backup"},
	}, nil, nil, "")
	if err != nil {
		return 0, err
	}

	defer func() {
		_ = docker.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
	}()

	if err := docker.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return 0, err
	}

	statusCh, errCh := docker.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return 0, err
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			return 0, fmt.Errorf("backup exited %d", status.StatusCode)
		}
	}

	info, err := os.Stat(archivePath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}
