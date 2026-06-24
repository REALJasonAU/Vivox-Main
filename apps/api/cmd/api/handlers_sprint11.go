package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
)

// ---------------------------------------------------------------------------
// Metrics history
// ---------------------------------------------------------------------------

type metricsPoint struct {
	T   int64   `json:"t"`
	CPU float64 `json:"cpu"`
	Mem int64   `json:"mem"`
}

func (a *api) getMetricsHistory(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	serviceID := service.UUIDString(svc.ID)
	rangeStr := c.Query("range", "1h")

	durations := map[string]time.Duration{
		"15m": 15 * time.Minute,
		"1h":  1 * time.Hour,
		"6h":  6 * time.Hour,
		"24h": 24 * time.Hour,
	}
	dur, ok := durations[rangeStr]
	if !ok {
		dur = time.Hour
	}

	histKey := "metrics:hist:" + serviceID
	from := float64(time.Now().Add(-dur).UnixMilli())
	to := float64(time.Now().UnixMilli())

	results, err := a.rdb.ZRangeByScoreWithScores(c.Context(), histKey, &redis.ZRangeBy{
		Min: strconv.FormatFloat(from, 'f', 0, 64),
		Max: strconv.FormatFloat(to, 'f', 0, 64),
	}).Result()
	if err != nil {
		return err
	}

	step := 1
	if len(results) > 300 {
		step = len(results) / 300
	}

	points := make([]metricsPoint, 0, 300)
	for i := 0; i < len(results); i += step {
		z := results[i]
		var m struct {
			CPU float64 `json:"cpu"`
			Mem int64   `json:"mem"`
		}
		member, ok := z.Member.(string)
		if !ok {
			continue
		}
		if err := json.Unmarshal([]byte(member), &m); err != nil {
			continue
		}
		points = append(points, metricsPoint{T: int64(z.Score), CPU: m.CPU, Mem: m.Mem})
	}
	return c.JSON(points)
}

// ---------------------------------------------------------------------------
// Service health
// ---------------------------------------------------------------------------

func (a *api) getServiceHealth(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	serviceID := service.UUIDString(svc.ID)
	val, err := a.rdb.Get(c.Context(), "health:"+serviceID).Bytes()
	if err == redis.Nil {
		return c.JSON(fiber.Map{"available": false})
	}
	if err != nil {
		return err
	}
	var h map[string]interface{}
	_ = json.Unmarshal(val, &h)
	h["available"] = true
	return c.JSON(h)
}

// ---------------------------------------------------------------------------
// Redeploy webhook
// ---------------------------------------------------------------------------

func (a *api) redeployService(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	owner := auth.OwnerID(c)
	if err := a.enq.EnqueueDeploy(c.UserContext(), service.UUIDString(svc.ID), owner); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"status": "queued"})
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

type apiKeyView struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"key_prefix"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

func toApiKeyView(k db.ApiKey) apiKeyView {
	v := apiKeyView{
		ID:        service.UUIDString(k.ID),
		Name:      k.Name,
		KeyPrefix: k.KeyPrefix,
		CreatedAt: k.CreatedAt.Time,
	}
	if k.LastUsedAt.Valid {
		v.LastUsedAt = &k.LastUsedAt.Time
	}
	return v
}

func generateApiKey() (plaintext, hash, prefix string, err error) {
	b := make([]byte, 16)
	if _, err = rand.Read(b); err != nil {
		return "", "", "", err
	}
	plaintext = "vvx_" + hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(plaintext))
	hash = hex.EncodeToString(sum[:])
	if len(plaintext) >= 12 {
		prefix = plaintext[:12]
	} else {
		prefix = plaintext
	}
	return plaintext, hash, prefix, nil
}

func (a *api) listApiKeys(c *fiber.Ctx) error {
	rows, err := a.q.ListApiKeysByUser(c.UserContext(), auth.OwnerID(c))
	if err != nil {
		return err
	}
	out := make([]apiKeyView, 0, len(rows))
	for _, row := range rows {
		out = append(out, toApiKeyView(row))
	}
	return c.JSON(out)
}

type createApiKeyReq struct {
	Name string `json:"name"`
}

func (a *api) createApiKey(c *fiber.Ctx) error {
	var req createApiKeyReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if req.Name == "" {
		return fiber.NewError(fiber.StatusBadRequest, "name is required")
	}
	plaintext, hash, prefix, err := generateApiKey()
	if err != nil {
		return err
	}
	row, err := a.q.CreateApiKey(c.UserContext(), db.CreateApiKeyParams{
		UserID:    auth.OwnerID(c),
		Name:      req.Name,
		KeyHash:   hash,
		KeyPrefix: prefix,
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"key":        toApiKeyView(row),
		"plaintext":  plaintext,
	})
}

func (a *api) deleteApiKey(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid id")
	}
	if err := a.q.DeleteApiKey(c.UserContext(), db.DeleteApiKeyParams{
		ID:     id,
		UserID: auth.OwnerID(c),
	}); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "key not found")
	}
	return c.SendStatus(fiber.StatusNoContent)
}
