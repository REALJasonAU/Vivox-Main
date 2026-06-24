package main

import (
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/nexus-control/apps/api/internal/auth"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	"github.com/nexus-control/packages/domain"
)

type adminPatchServiceReq struct {
	OwnerID        *string                 `json:"owner_id"`
	ResourceLimits *domain.ResourceLimits  `json:"resource_limits"`
	Ports          *[]string               `json:"ports"`
	PortMappings   *[]domain.PortMapping   `json:"port_mappings"`
	MainPort       *int                    `json:"main_port"`
}

func (a *api) adminPatchService(c *fiber.Ctx) error {
	id, err := service.ParseUUID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid service id")
	}

	svc, err := a.q.GetService(c.UserContext(), id)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "service not found")
	}

	var req adminPatchServiceReq
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}

	limits := svc.ResourceLimits
	if req.ResourceLimits != nil {
		if req.ResourceLimits.MemoryMB <= 0 || req.ResourceLimits.CPUShares <= 0 {
			return fiber.NewError(fiber.StatusBadRequest, "memory_mb and cpu_shares must be positive")
		}
		limits = *req.ResourceLimits
	}

	cfg := svc.Config
	if req.PortMappings != nil {
		cfg.PortMappings = *req.PortMappings
		cfg.Ports = rebuildPortsFromMappings(cfg.PortMappings)
	} else if req.Ports != nil {
		cfg.Ports = *req.Ports
	}
	if req.MainPort != nil {
		cfg.MainPort = *req.MainPort
	}

	updated, err := a.q.UpdateServiceConfig(c.UserContext(), db.UpdateServiceConfigParams{
		ID:             svc.ID,
		ResourceLimits: limits,
		Config:         cfg,
	})
	if err != nil {
		return err
	}

	if req.OwnerID != nil && *req.OwnerID != "" && *req.OwnerID != svc.OwnerID {
		updated, err = a.q.UpdateServiceOwner(c.UserContext(), svc.ID, *req.OwnerID)
		if err != nil {
			return err
		}
	}

	a.mgr.Audit(c.UserContext(), auth.OwnerID(c), "admin.service.update", "service", service.UUIDString(svc.ID), nil)
	return c.JSON(toServiceView(updated))
}

func rebuildPortsFromMappings(mappings []domain.PortMapping) []string {
	out := make([]string, 0, len(mappings))
	for _, m := range mappings {
		ip := m.HostIP
		if ip == "" {
			ip = "0.0.0.0"
		}
		proto := m.Proto
		if proto == "" {
			proto = "tcp"
		}
		out = append(out, fmt.Sprintf("%s:%d:%d/%s", ip, m.HostPort, m.ContainerPort, proto))
	}
	return out
}
