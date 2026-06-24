package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
)

// ---------------------------------------------------------------------------
// Log history
// ---------------------------------------------------------------------------

type logLine struct {
	T    float64 `json:"t"`
	S    string  `json:"s"`
	Line string  `json:"line"`
}

func (a *api) getServiceLogs(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	serviceID := service.UUIDString(svc.ID)
	rangeStr := c.Query("range", "1h")
	query := strings.ToLower(c.Query("q", ""))
	stream := c.Query("stream", "all")

	durations := map[string]time.Duration{
		"1h":  time.Hour,
		"6h":  6 * time.Hour,
		"24h": 24 * time.Hour,
	}
	dur := durations[rangeStr]
	if dur == 0 {
		dur = time.Hour
	}

	logKey := "logs:hist:" + serviceID
	from := float64(time.Now().Add(-dur).UnixMilli())
	to := float64(time.Now().UnixMilli())

	results, err := a.rdb.ZRangeByScoreWithScores(c.Context(), logKey, &redis.ZRangeBy{
		Min: strconv.FormatFloat(from, 'f', 0, 64),
		Max: strconv.FormatFloat(to, 'f', 0, 64),
	}).Result()
	if err != nil {
		return err
	}

	out := make([]logLine, 0, len(results))
	for _, z := range results {
		member, ok := z.Member.(string)
		if !ok {
			continue
		}
		var ll logLine
		if err := json.Unmarshal([]byte(member), &ll); err != nil {
			continue
		}
		if stream != "all" && ll.S != stream {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(ll.Line), query) {
			continue
		}
		out = append(out, ll)
	}

	truncated := len(results) > 2000
	if len(out) > 2000 {
		out = out[len(out)-2000:]
	}

	return c.JSON(fiber.Map{"lines": out, "total": len(out), "truncated": truncated})
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

type alertRuleView struct {
	ID         string     `json:"id"`
	ServiceID  string     `json:"service_id"`
	Metric     string     `json:"metric"`
	Operator   string     `json:"operator"`
	Threshold  int32      `json:"threshold"`
	Enabled    bool       `json:"enabled"`
	NotifiedAt *time.Time `json:"notified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func toAlertRuleView(r db.AlertRule) alertRuleView {
	v := alertRuleView{
		ID:        service.UUIDString(r.ID),
		ServiceID: service.UUIDString(r.ServiceID),
		Metric:    string(r.Metric),
		Operator:  string(r.Operator),
		Threshold: r.Threshold,
		Enabled:   r.Enabled,
		CreatedAt: r.CreatedAt.Time,
	}
	if r.NotifiedAt.Valid {
		v.NotifiedAt = &r.NotifiedAt.Time
	}
	return v
}

func (a *api) listAlertRules(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	rows, err := a.q.ListAlertRulesForService(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	out := make([]alertRuleView, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAlertRuleView(row))
	}
	return c.JSON(out)
}

type createAlertRuleReq struct {
	Metric    string `json:"metric"`
	Operator  string `json:"operator"`
	Threshold int32  `json:"threshold"`
}

func (a *api) createAlertRule(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var req createAlertRuleReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Metric != "cpu" && req.Metric != "memory" {
		return fiber.NewError(fiber.StatusBadRequest, "metric must be cpu or memory")
	}
	if req.Operator != "gt" && req.Operator != "lt" {
		req.Operator = "gt"
	}
	if req.Threshold <= 0 {
		return fiber.NewError(fiber.StatusBadRequest, "threshold must be positive")
	}
	row, err := a.q.CreateAlertRule(c.UserContext(), db.CreateAlertRuleParams{
		ServiceID: svc.ID,
		OwnerID:   auth.OwnerID(c),
		Metric:    db.AlertMetric(req.Metric),
		Operator:  db.AlertOperator(req.Operator),
		Threshold: req.Threshold,
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toAlertRuleView(row))
}

func (a *api) deleteAlertRule(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	ruleID, err := service.ParseUUID(c.Params("ruleId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid rule id")
	}
	if err := a.q.DeleteAlertRule(c.UserContext(), ruleID, svc.ID); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "rule not found")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

type patchAlertRuleReq struct {
	Enabled bool `json:"enabled"`
}

func (a *api) patchAlertRule(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	ruleID, err := service.ParseUUID(c.Params("ruleId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid rule id")
	}
	var req patchAlertRuleReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	row, err := a.q.ToggleAlertRule(c.UserContext(), db.ToggleAlertRuleParams{
		ID:        ruleID,
		Enabled:   req.Enabled,
		ServiceID: svc.ID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "rule not found")
	}
	return c.JSON(toAlertRuleView(row))
}
