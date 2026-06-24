package main

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexus-control/apps/api/internal/auth"
)

// GET /api/admin/customers
func (a *api) listCustomers(c *fiber.Ctx) error {
	rows, err := a.q.ListCustomers(c.UserContext())
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, cust := range rows {
		out = append(out, fiber.Map{
			"id":            cust.ID,
			"email":         cust.Email,
			"name":          cust.Name,
			"role":          cust.Role,
			"created_at":    cust.CreatedAt,
			"is_suspended":  cust.IsSuspended,
			"service_count": cust.ServiceCount,
			"running_count": cust.RunningCount,
		})
	}
	return c.JSON(out)
}

type suspendReq struct {
	Reason string `json:"reason"`
}

// PATCH /api/admin/customers/:userId/suspend
func (a *api) suspendCustomer(c *fiber.Ctx) error {
	userID := strings.TrimSpace(c.Params("userId"))
	if userID == "" {
		return fiber.ErrBadRequest
	}
	var req suspendReq
	_ = c.BodyParser(&req)

	if err := a.q.SuspendCustomer(c.UserContext(), userID, req.Reason, auth.OwnerID(c)); err != nil {
		return err
	}
	a.rdb.Set(c.UserContext(), "suspended:"+userID, "1", 0)
	return c.SendStatus(204)
}

// PATCH /api/admin/customers/:userId/unsuspend
func (a *api) unsuspendCustomer(c *fiber.Ctx) error {
	userID := strings.TrimSpace(c.Params("userId"))
	if userID == "" {
		return fiber.ErrBadRequest
	}
	if err := a.q.UnsuspendCustomer(c.UserContext(), userID); err != nil {
		return err
	}
	a.rdb.Del(c.UserContext(), "suspended:"+userID)
	return c.SendStatus(204)
}

// suspendCheck rejects API calls from suspended users (admins are never blocked).
func suspendCheck(rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if auth.IsAdmin(c) {
			return c.Next()
		}
		uid := auth.OwnerID(c)
		if uid == "" {
			return c.Next()
		}
		val, _ := rdb.Get(c.Context(), "suspended:"+uid).Result()
		if val == "1" {
			return fiber.NewError(fiber.StatusForbidden, "account suspended — contact support")
		}
		return c.Next()
	}
}
