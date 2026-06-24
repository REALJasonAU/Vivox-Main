package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nexus-control/apps/api/internal/auth"
	caddyclient "github.com/nexus-control/apps/api/internal/caddy"
	"github.com/nexus-control/apps/api/internal/config"
	"github.com/nexus-control/apps/api/internal/db"
	filestrack "github.com/nexus-control/apps/api/internal/files"
	grpcsrv "github.com/nexus-control/apps/api/internal/grpc"
	"github.com/nexus-control/apps/api/internal/scheduler"
	"github.com/nexus-control/apps/api/internal/service"
	"github.com/nexus-control/apps/api/internal/worker"
	"github.com/nexus-control/packages/domain"
)

// api carries the dependencies shared by the REST handlers.
type api struct {
	cfg         config.Config
	q           *db.Queries
	pool        *pgxpool.Pool
	rdb         *redis.Client
	mgr         *service.Manager
	sched       *scheduler.Scheduler
	enq         *worker.Enqueuer
	reg         *grpcsrv.Registry
	fileTracker *filestrack.Tracker
	caddy       *caddyclient.Client
	log         *slog.Logger
}

// ---------------------------------------------------------------------------
// Views (clean JSON shapes; never leak pgtype internals or token hashes)
// ---------------------------------------------------------------------------

type serviceView struct {
	ID             string                `json:"id"`
	OwnerID        string                `json:"owner_id"`
	TeamID         *string               `json:"team_id,omitempty"`
	Name           string                `json:"name"`
	Type           string                `json:"type"`
	Status         string                `json:"status"`
	NodeID         string                `json:"node_id,omitempty"`
	ResourceLimits domain.ResourceLimits `json:"resource_limits"`
	Config         domain.ServiceConfig  `json:"config"`
	Tags           []string              `json:"tags"`
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

func toServiceView(s db.Service) serviceView {
	tags := s.Tags
	if tags == nil {
		tags = []string{}
	}
	return serviceView{
		ID:             service.UUIDString(s.ID),
		OwnerID:        s.OwnerID,
		TeamID:         s.TeamID,
		Name:           s.Name,
		Type:           string(s.Type),
		Status:         string(s.Status),
		NodeID:         service.UUIDString(s.NodeID),
		ResourceLimits: s.ResourceLimits,
		Config:         s.Config,
		Tags:           tags,
		CreatedAt:      s.CreatedAt.Time,
		UpdatedAt:      s.UpdatedAt.Time,
	}
}

type nodeView struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	Region       string              `json:"region"`
	Status       string              `json:"status"`
	Online       bool                `json:"online"`
	AgentID      string              `json:"agent_id,omitempty"`
	Capacity     domain.NodeCapacity `json:"capacity"`
	ServiceCount int                 `json:"service_count"`
	MemoryUsedMb int64               `json:"memory_used_mb"`
	CreatedAt    time.Time           `json:"created_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
}

func (a *api) toNodeView(n db.Node) nodeView {
	id := service.UUIDString(n.ID)
	return nodeView{
		ID:        id,
		Name:      n.Name,
		Region:    n.Region,
		Status:    n.Status,
		Online:    a.reg.Online(id),
		AgentID:   a.reg.AgentID(id),
		Capacity:  n.Capacity,
		CreatedAt: n.CreatedAt.Time,
		UpdatedAt: n.UpdatedAt.Time,
	}
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

func (a *api) listTemplates(c *fiber.Ctx) error {
	return c.JSON(service.List(a.mgr.Templates()))
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

type createServiceReq struct {
	Name       string            `json:"name"`
	TemplateID string            `json:"template_id"`
	NodeID     string            `json:"node_id"`
	Region     string            `json:"region"`
	Params     map[string]string `json:"params"`

	// Advanced (template-less) deploy. The limits key is "resource_limits" to
	// match the web client's CreateServiceInput and the domain/Service shape.
	Type   string                 `json:"type"`
	Config *domain.ServiceConfig  `json:"config"`
	Limits *domain.ResourceLimits `json:"resource_limits"`
	// OwnerID may be set by an admin to create a service on behalf of a customer.
	OwnerID string `json:"owner_id"`
}

func (a *api) createService(c *fiber.Ctx) error {
	var req createServiceReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Name == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name is required")
	}
	owner := auth.OwnerID(c)
	if auth.IsAdmin(c) {
		if override := strings.TrimSpace(req.OwnerID); override != "" {
			owner = override
		}
	}

	var limits domain.ResourceLimits
	in := service.CreateServiceInput{OwnerID: owner, Name: req.Name}

	switch {
	case req.TemplateID != "":
		tmpl, ok := a.mgr.Template(req.TemplateID)
		if !ok {
			return fiber.NewError(fiber.StatusBadRequest, "unknown template")
		}
		in.Type = tmpl.ServiceType()
		in.Config = tmpl.BuildConfig(req.Params)
		in.Limits = tmpl.ResourceLimits()
		limits = in.Limits
	case req.Config != nil:
		in.Type = parseServiceType(req.Type)
		in.Config = *req.Config
		if req.Limits != nil {
			in.Limits = *req.Limits
		} else {
			in.Limits = domain.ResourceLimits{MemoryMB: 512, CPUShares: 512}
		}
		limits = in.Limits
	default:
		return fiber.NewError(fiber.StatusBadRequest, "template_id or config is required")
	}

	in.NodeID = a.resolveNode(c, req.NodeID, req.Region, limits)

	svc, err := a.mgr.CreateService(c.UserContext(), in)
	if err != nil {
		return err
	}
	if err := a.enq.EnqueueDeploy(c.UserContext(), service.UUIDString(svc.ID), owner); err != nil {
		a.log.Warn("enqueue deploy failed", "err", err)
	}
	return c.Status(fiber.StatusCreated).JSON(toServiceView(svc))
}

func (a *api) listServices(c *fiber.Ctx) error {
	tag := c.Query("tag", "")
	var rows []db.Service
	var err error
	if tag != "" {
		rows, err = a.q.ListUserServicesByTag(c.UserContext(), auth.OwnerID(c), strings.ToLower(strings.TrimSpace(tag)))
	} else {
		rows, err = a.q.ListUserServices(c.UserContext(), auth.OwnerID(c))
	}
	if err != nil {
		return err
	}
	return c.JSON(viewServices(rows))
}

func (a *api) listAllServices(c *fiber.Ctx) error {
	rows, err := a.q.ListAllServices(c.UserContext())
	if err != nil {
		return err
	}
	return c.JSON(viewServices(rows))
}

func (a *api) getService(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	return c.JSON(toServiceView(svc))
}

func (a *api) startService(c *fiber.Ctx) error   { return a.control(c, a.mgr.StartService) }
func (a *api) stopService(c *fiber.Ctx) error    { return a.control(c, a.mgr.StopService) }
func (a *api) restartService(c *fiber.Ctx) error { return a.control(c, a.mgr.RestartService) }

// control runs an ownership check then invokes a Manager action, mapping domain
// errors to HTTP status codes.
func (a *api) control(c *fiber.Ctx, action func(ctx context.Context, actorID string, id pgtype.UUID) (db.Service, error)) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	updated, err := action(c.UserContext(), auth.OwnerID(c), svc.ID)
	if err != nil {
		return mapServiceErr(err)
	}
	return c.JSON(toServiceView(updated))
}

// updateEnvReq is the PATCH /services/:id/env body. The web client sends the
// full desired environment map (the env editor is authoritative).
type updateEnvReq struct {
	Environment map[string]string `json:"environment"`
}

// updateServiceEnv replaces a service's config.environment, leaving image,
// ports, and resource limits untouched. The change applies on next restart.
func (a *api) updateServiceEnv(c *fiber.Ctx) error {
	var req updateEnvReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	cfg := svc.Config
	cfg.Environment = req.Environment
	updated, err := a.q.UpdateServiceConfig(c.UserContext(), db.UpdateServiceConfigParams{
		ID:             svc.ID,
		ResourceLimits: svc.ResourceLimits,
		Config:         cfg,
	})
	if err != nil {
		return err
	}
	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "service.env.update", "service", service.UUIDString(svc.ID), nil)
	return c.JSON(toServiceView(updated))
}

type updateLimitsReq struct {
	MemoryMB  int64 `json:"memory_mb"`
	CPUShares int64 `json:"cpu_shares"`
	DiskGB    int64 `json:"disk_gb"`
}

func isTransientStatus(s db.ServiceStatus) bool {
	return s == db.ServiceStatusPROVISIONING || s == db.ServiceStatusSTARTING || s == db.ServiceStatusSTOPPING
}

func (a *api) updateServiceLimits(c *fiber.Ctx) error {
	var req updateLimitsReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.MemoryMB <= 0 || req.CPUShares <= 0 {
		return fiber.NewError(fiber.StatusBadRequest, "memory_mb and cpu_shares must be positive")
	}
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	if isTransientStatus(svc.Status) {
		return fiber.NewError(fiber.StatusConflict, "cannot edit limits during transition")
	}
	updated, err := a.q.UpdateServiceConfig(c.UserContext(), db.UpdateServiceConfigParams{
		ID:             svc.ID,
		ResourceLimits: domain.ResourceLimits{MemoryMB: req.MemoryMB, CPUShares: req.CPUShares, DiskGB: req.DiskGB},
		Config:         svc.Config,
	})
	if err != nil {
		return err
	}
	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "service.limits.update", "service", service.UUIDString(svc.ID), map[string]any{
		"memory_mb": req.MemoryMB, "cpu_shares": req.CPUShares,
	})
	return c.JSON(toServiceView(updated))
}

// deleteService removes a service after an ownership check, best-effort stopping
// its container on the owning node first (the agent reconciles by label if the
// node is offline). Returns 204 to match the web client's expectation.
func (a *api) deleteService(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	if err := a.mgr.DeleteService(c.UserContext(), auth.OwnerID(c), svc.ID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Nodes (admin)
// ---------------------------------------------------------------------------

type registerNodeReq struct {
	Name       string              `json:"name"`
	Region     string              `json:"region"`
	AgentToken string              `json:"agent_token"`
	Capacity   domain.NodeCapacity `json:"capacity"`
}

func (a *api) registerNode(c *fiber.Ctx) error {
	var req registerNodeReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Name == "" || req.Region == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name and region are required")
	}
	token := req.AgentToken
	if token == "" {
		token = randomToken()
	}
	sum := sha256.Sum256([]byte(token))
	node, err := a.q.CreateNode(c.UserContext(), db.CreateNodeParams{
		Name:           req.Name,
		Region:         req.Region,
		AgentTokenHash: hex.EncodeToString(sum[:]),
		Status:         "offline",
		Capacity:       req.Capacity,
	})
	if err != nil {
		return err
	}
	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "node.register", "node", service.UUIDString(node.ID), map[string]any{
		"name": req.Name, "region": req.Region,
	})
	// Return the plaintext token exactly once so the admin can configure the agent.
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"node":        a.toNodeView(node),
		"agent_token": token,
	})
}

func (a *api) listNodes(c *fiber.Ctx) error {
	rows, err := a.q.ListNodes(c.UserContext())
	if err != nil {
		return err
	}
	loads, _ := a.q.NodeServiceLoads(c.UserContext())
	loadByNode := map[string]db.NodeServiceLoadsRow{}
	for _, row := range loads {
		loadByNode[service.UUIDString(row.NodeID)] = row
	}
	out := make([]nodeView, 0, len(rows))
	for _, n := range rows {
		v := a.toNodeView(n)
		if load, ok := loadByNode[v.ID]; ok {
			v.ServiceCount = int(load.ServiceCount)
			v.MemoryUsedMb = load.TotalMemoryMb
		}
		out = append(out, v)
	}
	return c.JSON(out)
}

func (a *api) getNode(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid node id")
	}
	n, err := a.q.GetNode(c.UserContext(), id)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "node not found")
	}
	v := a.toNodeView(n)
	if loads, err := a.q.NodeServiceLoads(c.UserContext()); err == nil {
		for _, row := range loads {
			if service.UUIDString(row.NodeID) == v.ID {
				v.ServiceCount = int(row.ServiceCount)
				v.MemoryUsedMb = row.TotalMemoryMb
				break
			}
		}
	}
	return c.JSON(v)
}

func (a *api) listNodeServices(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid node id")
	}
	if _, err := a.q.GetNode(c.UserContext(), id); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "node not found")
	}
	rows, err := a.q.ListServicesByNode(c.UserContext(), id)
	if err != nil {
		return err
	}
	return c.JSON(viewServices(rows))
}

func (a *api) rotateNodeToken(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid node id")
	}
	if _, err := a.q.GetNode(c.UserContext(), id); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "node not found")
	}
	token := randomToken()
	sum := sha256.Sum256([]byte(token))
	node, err := a.q.UpdateNodeTokenHash(c.UserContext(), db.UpdateNodeTokenHashParams{
		ID:             id,
		AgentTokenHash: hex.EncodeToString(sum[:]),
	})
	if err != nil {
		return err
	}
	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "node.token.rotate", "node", service.UUIDString(id), nil)
	return c.JSON(fiber.Map{
		"node":        a.toNodeView(node),
		"agent_token": token,
	})
}

type auditView struct {
	ID         string         `json:"id"`
	ActorID    string         `json:"actor_id"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   string         `json:"target_id"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (a *api) listAuditEvents(c *fiber.Ctx) error {
	limit := int32(100)
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = int32(n)
		}
	}
	var from, to pgtype.Timestamptz
	if v := c.Query("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	if v := c.Query("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	rows, err := a.q.ListAuditEvents(c.UserContext(), db.ListAuditEventsParams{
		Column1: c.Query("actor_id"),
		Column2: c.Query("target_type"),
		Column3: c.Query("target_id"),
		Column4: from,
		Column5: to,
		Limit:   limit,
	})
	if err != nil {
		return err
	}
	out := make([]auditView, 0, len(rows))
	for _, e := range rows {
		var meta map[string]any
		if len(e.Metadata) > 0 {
			_ = json.Unmarshal(e.Metadata, &meta)
		}
		out = append(out, auditView{
			ID:         service.UUIDString(e.ID),
			ActorID:    e.ActorID,
			Action:     e.Action,
			TargetType: e.TargetType,
			TargetID:   e.TargetID,
			Metadata:   meta,
			CreatedAt:  e.CreatedAt.Time,
		})
	}
	return c.JSON(out)
}

func (a *api) listDeployments(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	rows, err := a.q.ListDeploymentsByService(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	type depView struct {
		ID        string    `json:"id"`
		ServiceID string    `json:"service_id"`
		Status    string    `json:"status"`
		CommitSha *string   `json:"commit_sha,omitempty"`
		LogsRef   *string   `json:"logs_ref,omitempty"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := make([]depView, 0, len(rows))
	for _, d := range rows {
		out = append(out, depView{
			ID:        service.UUIDString(d.ID),
			ServiceID: service.UUIDString(d.ServiceID),
			Status:    string(d.Status),
			CommitSha: d.CommitSha,
			LogsRef:   d.LogsRef,
			CreatedAt: d.CreatedAt.Time,
		})
	}
	return c.JSON(out)
}

// ---------------------------------------------------------------------------
// Service tags
// ---------------------------------------------------------------------------

func (a *api) updateServiceTags(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	tags := make([]string, 0, len(body.Tags))
	seen := make(map[string]struct{})
	for _, t := range body.Tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if len(t) == 0 || len(t) > 20 {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		tags = append(tags, t)
		if len(tags) >= 10 {
			break
		}
	}
	updated, err := a.q.UpdateServiceTags(c.UserContext(), svc.ID, tags)
	if err != nil {
		return err
	}
	return c.JSON(toServiceView(updated))
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

func (a *api) updateProfile(c *fiber.Ctx) error {
	userID := auth.OwnerID(c)
	var body struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	name := strings.TrimSpace(body.Name)
	if len(name) < 1 || len(name) > 100 {
		return fiber.NewError(fiber.StatusBadRequest, "name must be 1-100 characters")
	}
	if a.pool == nil {
		return fiber.NewError(fiber.StatusInternalServerError, "database unavailable")
	}
	if _, err := a.pool.Exec(c.UserContext(), `UPDATE "user" SET name = $1 WHERE id = $2`, name, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"name": name})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// loadOwned loads the :id service and enforces ownership (admins bypass).
func (a *api) loadOwned(c *fiber.Ctx) (db.Service, error) {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return db.Service{}, fiber.NewError(fiber.StatusBadRequest, "invalid service id")
	}
	svc, err := a.q.GetService(c.UserContext(), id)
	if err != nil {
		return db.Service{}, fiber.NewError(fiber.StatusNotFound, "service not found")
	}
	if !auth.IsAdmin(c) && svc.OwnerID != auth.OwnerID(c) {
		return db.Service{}, fiber.NewError(fiber.StatusForbidden, "forbidden")
	}
	return svc, nil
}

// resolveNode picks the node a new service is scheduled onto.
func (a *api) resolveNode(c *fiber.Ctx, explicit, region string, limits domain.ResourceLimits) pgtype.UUID {
	if explicit != "" {
		if id, err := service.ParseUUID(explicit); err == nil {
			return id
		}
	}
	if a.sched != nil {
		id, err := a.sched.Select(c.UserContext(), scheduler.SelectInput{Region: region, Limits: limits})
		if err == nil && id.Valid {
			return id
		}
	}
	return pgtype.UUID{}
}

func viewServices(rows []db.Service) []serviceView {
	out := make([]serviceView, 0, len(rows))
	for _, s := range rows {
		out = append(out, toServiceView(s))
	}
	return out
}

func parseServiceType(s string) db.ServiceType {
	switch s {
	case "game":
		return db.ServiceTypeGame
	case "static":
		return db.ServiceTypeStatic
	case "database":
		return db.ServiceTypeDatabase
	default:
		return db.ServiceTypeDocker
	}
}

// mapServiceErr translates Manager domain errors into HTTP errors.
func mapServiceErr(err error) error {
	switch {
	case errors.Is(err, service.ErrServiceTransient):
		return fiber.NewError(fiber.StatusConflict, err.Error())
	case errors.Is(err, service.ErrIllegalTransition):
		return fiber.NewError(fiber.StatusConflict, err.Error())
	case errors.Is(err, service.ErrNoNode):
		return fiber.NewError(fiber.StatusConflict, err.Error())
	case errors.Is(err, service.ErrNodeOffline):
		return fiber.NewError(fiber.StatusServiceUnavailable, err.Error())
	default:
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
