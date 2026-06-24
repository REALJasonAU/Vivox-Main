package main

import (
	"encoding/base64"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nexus-control/apps/api/internal/auth"
	filestrack "github.com/nexus-control/apps/api/internal/files"
	"github.com/nexus-control/apps/api/internal/cron"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	"github.com/nexus-control/packages/domain"
	gen "github.com/nexus-control/packages/proto/gen"
)

type fileEntryView struct {
	Name        string `json:"name"`
	IsDir       bool   `json:"is_dir"`
	Size        int64  `json:"size"`
	Modified    string `json:"modified"`
	Permissions string `json:"permissions"`
}

func toFileEntryViews(entries []*gen.FileEntry) []fileEntryView {
	out := make([]fileEntryView, 0, len(entries))
	for _, e := range entries {
		if e == nil {
			continue
		}
		out = append(out, fileEntryView{
			Name:        e.GetName(),
			IsDir:       e.GetIsDir(),
			Size:        e.GetSize(),
			Modified:    e.GetModified(),
			Permissions: e.GetPermissions(),
		})
	}
	return out
}

const serviceDataRoot = "/mnt/server"

func validateServiceFilePath(path string) (string, error) {
	if path == "" {
		return "", fiber.NewError(fiber.StatusBadRequest, "path is required")
	}
	clean := filepath.Clean(path)
	if clean != serviceDataRoot && !strings.HasPrefix(clean, serviceDataRoot+"/") {
		return "", fiber.NewError(fiber.StatusForbidden, "path must be under /mnt/server")
	}
	return clean, nil
}

func (a *api) dispatchFileCommand(svc db.Service, env *gen.DownstreamEnvelope) (filestrack.Result, error) {
	return a.dispatchFileCommandWithTimeout(svc, env, 10*time.Second)
}

func (a *api) dispatchFileCommandWithTimeout(svc db.Service, env *gen.DownstreamEnvelope, timeout time.Duration) (filestrack.Result, error) {
	if !svc.NodeID.Valid {
		return filestrack.Result{}, fiber.NewError(fiber.StatusConflict, "service not assigned to a node")
	}
	nodeID := service.UUIDString(svc.NodeID)
	if !a.reg.Online(nodeID) {
		return filestrack.Result{}, fiber.NewError(fiber.StatusServiceUnavailable, "node offline")
	}
	commandID := randomToken()
	ch := a.fileTracker.Expect(commandID)
	env.CommandId = commandID
	if err := a.reg.Send(nodeID, env); err != nil {
		a.fileTracker.Cancel(commandID)
		return filestrack.Result{}, err
	}
	result, ok := filestrack.Wait(ch, timeout)
	if !ok {
		a.fileTracker.Cancel(commandID)
		return filestrack.Result{}, fiber.NewError(fiber.StatusGatewayTimeout, "agent timeout")
	}
	if result.CommandResponse && !result.Success {
		return result, fiber.NewError(fiber.StatusInternalServerError, result.Error)
	}
	return result, nil
}

func (a *api) listFiles(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	path := c.Query("path", serviceDataRoot)
	safe, err := validateServiceFilePath(path)
	if err != nil {
		return err
	}
	result, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_ListFiles{
			ListFiles: &gen.FileListTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      safe,
			},
		},
	})
	if err != nil {
		return err
	}
	if result.Error != "" {
		return fiber.NewError(fiber.StatusInternalServerError, result.Error)
	}
	return c.JSON(toFileEntryViews(result.Entries))
}

func (a *api) readFile(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	path := c.Query("path")
	safe, err := validateServiceFilePath(path)
	if err != nil {
		return err
	}
	result, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_ReadFile{
			ReadFile: &gen.FileReadTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      safe,
			},
		},
	})
	if err != nil {
		return err
	}
	if result.Error != "" {
		return fiber.NewError(fiber.StatusInternalServerError, result.Error)
	}
	return c.JSON(fiber.Map{
		"content":  base64.StdEncoding.EncodeToString(result.Content),
		"encoding": "base64",
	})
}

type writeFileReq struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type mkdirReq struct {
	Path string `json:"path"`
}

func (a *api) mkdirFile(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var req mkdirReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Path == "" {
		return fiber.NewError(fiber.StatusBadRequest, "path is required")
	}
	safe, err := validateServiceFilePath(req.Path)
	if err != nil {
		return err
	}
	placeholder := safe + "/.vivox-dir"
	_, err = a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_WriteFile{
			WriteFile: &gen.FileWriteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      placeholder,
				Content:   []byte{},
			},
		},
	})
	if err != nil {
		return err
	}
	_, err = a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_DeleteFile{
			DeleteFile: &gen.FileDeleteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      placeholder,
			},
		},
	})
	if err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (a *api) writeFile(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var req writeFileReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Path == "" {
		return fiber.NewError(fiber.StatusBadRequest, "path is required")
	}
	safe, err := validateServiceFilePath(req.Path)
	if err != nil {
		return err
	}
	data, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid base64 content")
	}
	_, err = a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_WriteFile{
			WriteFile: &gen.FileWriteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      safe,
				Content:   data,
			},
		},
	})
	if err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

type updateConfigReq struct {
	StartupCmd  *string                  `json:"startup_cmd"`
	Image       *string                  `json:"image"`
	HealthCheck *domain.HealthCheck      `json:"health_check"`
	ClearHealth *bool                    `json:"clear_health_check"`
}

func (a *api) updateServiceConfig(c *fiber.Ctx) error {
	var req updateConfigReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	if isTransientStatus(svc.Status) {
		return fiber.NewError(fiber.StatusConflict, "cannot edit config during transition")
	}
	cfg := svc.Config
	if req.StartupCmd != nil {
		cfg.StartupCmd = *req.StartupCmd
	}
	if req.Image != nil {
		cfg.Image = *req.Image
	}
	if req.ClearHealth != nil && *req.ClearHealth {
		cfg.HealthCheck = nil
	} else if req.HealthCheck != nil {
		cfg.HealthCheck = req.HealthCheck
	}
	updated, err := a.q.UpdateServiceConfig(c.UserContext(), db.UpdateServiceConfigParams{
		ID:             svc.ID,
		ResourceLimits: svc.ResourceLimits,
		Config:         cfg,
	})
	if err != nil {
		return err
	}
	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "service.config.update", "service", service.UUIDString(svc.ID), nil)
	return c.JSON(toServiceView(updated))
}

type createScheduleReq struct {
	Name     string `json:"name"`
	CronExpr string `json:"cron_expr"`
	Action   string `json:"action"`
	Status   string `json:"status"`
}

type scheduledTaskView struct {
	ID         string     `json:"id"`
	ServiceID  string     `json:"service_id"`
	OwnerID    string     `json:"owner_id"`
	Name       string     `json:"name"`
	CronExpr   string     `json:"cron_expr"`
	Action     string     `json:"action"`
	Status     string     `json:"status"`
	LastRunAt  *time.Time `json:"last_run_at,omitempty"`
	NextRunAt  *time.Time `json:"next_run_at,omitempty"`
	LastResult *string    `json:"last_result,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func toScheduleView(t db.ScheduledTask) scheduledTaskView {
	v := scheduledTaskView{
		ID:        service.UUIDString(t.ID),
		ServiceID: service.UUIDString(t.ServiceID),
		OwnerID:   t.OwnerID,
		Name:      t.Name,
		CronExpr:  t.CronExpr,
		Action:    t.Action,
		Status:    string(t.Status),
		CreatedAt: t.CreatedAt.Time,
	}
	if t.LastRunAt.Valid {
		v.LastRunAt = &t.LastRunAt.Time
	}
	if t.NextRunAt.Valid {
		v.NextRunAt = &t.NextRunAt.Time
	}
	if t.LastResult != nil {
		v.LastResult = t.LastResult
	}
	return v
}

func (a *api) listScheduledTasks(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	rows, err := a.q.ListScheduledTasksByService(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	out := make([]scheduledTaskView, 0, len(rows))
	for _, row := range rows {
		out = append(out, toScheduleView(row))
	}
	return c.JSON(out)
}

func (a *api) createScheduledTask(c *fiber.Ctx) error {
	var req createScheduleReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Name == "" || req.CronExpr == "" || req.Action == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name, cron_expr, and action are required")
	}
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	status := db.TaskStatusActive
	if req.Status == "paused" {
		status = db.TaskStatusPaused
	}
	next := cron.Next(req.CronExpr, time.Now())
	if next.IsZero() {
		next = time.Now().Add(time.Hour)
	}
	row, err := a.q.CreateScheduledTask(c.UserContext(), db.CreateScheduledTaskParams{
		ServiceID: svc.ID,
		OwnerID:   auth.OwnerID(c),
		Name:      req.Name,
		CronExpr:  req.CronExpr,
		Action:    req.Action,
		Status:    status,
		NextRunAt: pgtype.Timestamptz{Time: next, Valid: true},
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toScheduleView(row))
}

func (a *api) deleteScheduledTask(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	taskID, err := service.ParseUUID(c.Params("taskId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid task id")
	}
	if err := a.q.DeleteScheduledTask(c.UserContext(), db.DeleteScheduledTaskParams{
		ID:        taskID,
		ServiceID: svc.ID,
	}); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "task not found")
	}
	return c.SendStatus(fiber.StatusNoContent)
}
