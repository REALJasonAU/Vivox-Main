package main

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	gen "github.com/nexus-control/packages/proto/gen"
)

var domainRE = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$`)

func (a *api) listWebhooks(c *fiber.Ctx) error {
	rows, err := a.q.ListWebhooksForUser(c.UserContext(), auth.OwnerID(c))
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, w := range rows {
		out = append(out, webhookView(w))
	}
	return c.JSON(out)
}

type createWebhookReq struct {
	URL    string   `json:"url"`
	Secret string   `json:"secret"`
	Events []string `json:"events"`
}

func (a *api) createWebhook(c *fiber.Ctx) error {
	var req createWebhookReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	url := strings.TrimSpace(req.URL)
	if !strings.HasPrefix(url, "https://") {
		return fiber.NewError(400, "url must start with https://")
	}
	events := req.Events
	if len(events) == 0 {
		events = []string{"crash", "alert", "stopped"}
	}
	secret := pgtype.Text{}
	if s := strings.TrimSpace(req.Secret); s != "" {
		secret = pgtype.Text{String: s, Valid: true}
	}
	w, err := a.q.CreateWebhook(c.UserContext(), db.CreateWebhookParams{
		UserID: auth.OwnerID(c),
		URL:    url,
		Secret: secret,
		Events: events,
	})
	if err != nil {
		return err
	}
	return c.Status(201).JSON(webhookView(w))
}

func (a *api) patchWebhook(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.ErrBadRequest
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.ErrBadRequest
	}
	w, err := a.q.ToggleWebhook(c.UserContext(), id, auth.OwnerID(c), body.Enabled)
	if err != nil {
		return err
	}
	return c.JSON(webhookView(w))
}

func (a *api) deleteWebhook(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.ErrBadRequest
	}
	if err := a.q.DeleteWebhook(c.UserContext(), id, auth.OwnerID(c)); err != nil {
		return err
	}
	return c.SendStatus(204)
}

func webhookView(w db.WebhookConfig) fiber.Map {
	return fiber.Map{
		"id":            service.UUIDString(w.ID),
		"url":           w.URL,
		"events":        w.Events,
		"enabled":       w.Enabled,
		"last_fired_at": formatTimestamptz(w.LastFiredAt),
		"created_at":    formatTimestamptz(w.CreatedAt),
	}
}

func (a *api) createBackup(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	if !svc.NodeID.Valid {
		return fiber.NewError(409, "service has no node")
	}
	maxBackups := svc.ResourceLimits.MaxBackups
	if maxBackups <= 0 {
		return fiber.NewError(
			fiber.StatusForbidden,
			"backups are not allocated for this service — increase max_backups when deploying or in settings",
		)
	}
	count, err := a.q.CountActiveBackupsForService(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	if count >= maxBackups {
		return fiber.NewError(
			fiber.StatusConflict,
			fmt.Sprintf("backup limit reached (%d/%d) — delete an old backup first", count, maxBackups),
		)
	}
	backup, err := a.q.CreateBackup(c.UserContext(), db.CreateBackupParams{
		ServiceID: svc.ID,
		NodeID:    svc.NodeID,
		Status:    db.BackupStatusPending,
	})
	if err != nil {
		return err
	}
	if err := a.reg.Send(service.UUIDString(svc.NodeID), &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_BackupTask{
			BackupTask: &gen.BackupTask{
				ServiceId: service.UUIDString(svc.ID),
				BackupId:  service.UUIDString(backup.ID),
			},
		},
	}); err != nil {
		return fiber.NewError(503, "node offline")
	}
	return c.Status(202).JSON(backupView(backup))
}

func (a *api) listBackups(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	rows, err := a.q.ListBackupsForService(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, b := range rows {
		out = append(out, backupView(b))
	}
	return c.JSON(out)
}

func (a *api) deleteBackup(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	backupID, err := service.ParseUUID(c.Params("backupId"))
	if err != nil {
		return fiber.ErrBadRequest
	}
	if err := a.q.DeleteBackup(c.UserContext(), backupID, svc.ID); err != nil {
		return err
	}
	return c.SendStatus(204)
}

func (a *api) dismissBackup(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	backupID, err := service.ParseUUID(c.Params("backupId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid backup id")
	}
	if err := a.q.DismissBackup(c.UserContext(), backupID, svc.ID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func backupView(b db.Backup) fiber.Map {
	var size *int64
	if b.SizeBytes.Valid {
		v := b.SizeBytes.Int64
		size = &v
	}
	return fiber.Map{
		"id":           service.UUIDString(b.ID),
		"service_id":   service.UUIDString(b.ServiceID),
		"node_id":      service.UUIDString(b.NodeID),
		"status":       string(b.Status),
		"size_bytes":   size,
		"error":        textPtr(b.Error),
		"created_at":   formatTimestamptz(b.CreatedAt),
		"completed_at": formatTimestamptz(b.CompletedAt),
	}
}

type addDomainReq struct {
	Domain string `json:"domain"`
}

func (a *api) addServiceDomain(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var req addDomainReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if !domainRE.MatchString(domain) {
		return fiber.NewError(400, "invalid domain format")
	}

	status := db.DomainStatusPending
	var errText pgtype.Text
	if a.caddy == nil || a.cfg.CaddyAdminURL == "" {
		// Caddy disabled — keep pending for UI development.
	} else if resolveUpstream(a.cfg.NodePublicHost, svc.Config.Ports) == "" {
		status = db.DomainStatusError
		errText = pgtype.Text{String: "no host port configured", Valid: true}
	}

	row, err := a.q.CreateServiceDomain(c.UserContext(), db.CreateServiceDomainParams{
		ServiceID: svc.ID,
		OwnerID:   svc.OwnerID,
		Domain:    domain,
		Status:    status,
		Error:     errText,
	})
	if err != nil {
		return err
	}

	if a.caddy != nil && a.cfg.CaddyAdminURL != "" && status == db.DomainStatusPending {
		upstream := resolveUpstream(a.cfg.NodePublicHost, svc.Config.Ports)
		if err := a.caddy.AddDomain(c.UserContext(), service.UUIDString(row.ID), domain, upstream); err != nil {
			row, _ = a.q.UpdateServiceDomainStatus(c.UserContext(), row.ID, db.DomainStatusError, pgtype.Text{String: err.Error(), Valid: true})
		} else {
			row, _ = a.q.UpdateServiceDomainStatus(c.UserContext(), row.ID, db.DomainStatusActive, pgtype.Text{})
		}
	}

	return c.Status(201).JSON(domainView(row))
}

func (a *api) listServiceDomains(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	rows, err := a.q.ListServiceDomains(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, d := range rows {
		out = append(out, domainView(d))
	}
	return c.JSON(out)
}

func (a *api) deleteServiceDomain(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	domainID, err := service.ParseUUID(c.Params("domainId"))
	if err != nil {
		return fiber.ErrBadRequest
	}
	dom, err := a.q.GetServiceDomain(c.UserContext(), domainID, svc.ID)
	if err != nil {
		return fiber.ErrNotFound
	}
	if a.caddy != nil && a.cfg.CaddyAdminURL != "" {
		_ = a.caddy.RemoveDomain(c.UserContext(), service.UUIDString(dom.ID))
	}
	if err := a.q.DeleteServiceDomain(c.UserContext(), domainID, svc.ID); err != nil {
		return err
	}
	return c.SendStatus(204)
}

func domainView(d db.ServiceDomain) fiber.Map {
	return fiber.Map{
		"id":         service.UUIDString(d.ID),
		"service_id": service.UUIDString(d.ServiceID),
		"domain":     d.Domain,
		"status":     string(d.Status),
		"error":      textPtr(d.Error),
		"created_at": formatTimestamptz(d.CreatedAt),
	}
}

func resolveUpstream(host string, ports []string) string {
	if len(ports) == 0 || ports[0] == "host" {
		return ""
	}
	hostPort := strings.Split(ports[0], ":")[0]
	if hostPort == "" {
		return ""
	}
	return host + ":" + hostPort
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func formatTimestamptz(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format("2006-01-02T15:04:05Z")
	return &s
}
