package files

import (
	"context"

	gen "github.com/nexus-control/packages/proto/gen"
)

// ClientAdapter adapts Handler to client.FileHandler.
type ClientAdapter struct {
	*Handler
}

// ListFiles implements client.FileHandler.
func (a *ClientAdapter) ListFiles(ctx context.Context, t *gen.FileListTask) ([]*gen.FileEntry, error) {
	return a.Handler.ListFiles(ctx, t.GetServiceId(), t.GetPath())
}

// ReadFile implements client.FileHandler.
func (a *ClientAdapter) ReadFile(ctx context.Context, t *gen.FileReadTask) ([]byte, error) {
	return a.Handler.ReadFile(ctx, t.GetServiceId(), t.GetPath())
}

// WriteFile implements client.FileHandler.
func (a *ClientAdapter) WriteFile(ctx context.Context, t *gen.FileWriteTask) error {
	return a.Handler.WriteFile(ctx, t.GetServiceId(), t.GetPath(), t.GetContent())
}
