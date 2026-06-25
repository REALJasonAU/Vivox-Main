package main

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/service"
)

func (a *api) listNotifications(c *fiber.Ctx) error {
	userID := auth.OwnerID(c)
	rows, err := a.q.ListNotifications(c.UserContext(), userID, 50)
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, n := range rows {
		var meta json.RawMessage
		if len(n.Meta) > 0 {
			meta = json.RawMessage(n.Meta)
		}
		out = append(out, fiber.Map{
			"id":           service.UUIDString(n.ID),
			"service_id":   service.UUIDString(n.ServiceID),
			"service_name": n.ServiceName,
			"kind":         n.Kind,
			"ts":           n.Ts.UnixMilli(),
			"read":         n.Read,
			"meta":         meta,
		})
	}
	return c.JSON(out)
}

func (a *api) markAllNotificationsRead(c *fiber.Ctx) error {
	userID := auth.OwnerID(c)
	if err := a.q.MarkAllNotificationsRead(c.UserContext(), userID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
