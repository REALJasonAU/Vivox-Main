package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	gen "github.com/nexus-control/packages/proto/gen"
)

// ─── Convar cache ─────────────────────────────────────────────────────────────

type convarCache struct {
	mu      sync.RWMutex
	data    []byte
	fetchAt time.Time
	ttl     time.Duration
}

var globalConvarCache = &convarCache{ttl: time.Hour}

func (c *convarCache) get() ([]byte, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.data) == 0 || time.Since(c.fetchAt) > c.ttl {
		return nil, false
	}
	return c.data, true
}

func (c *convarCache) set(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data = data
	c.fetchAt = time.Now()
}

func (a *api) cfgConvars(c *fiber.Ctx) error {
	if _, err := a.loadOwned(c); err != nil {
		return err
	}
	if cached, ok := globalConvarCache.get(); ok {
		c.Set("Content-Type", "application/json")
		return c.Send(cached)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Get("https://api.carbonmod.gg/meta/rust/convars.json")
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "upstream unavailable"})
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "read failed"})
	}
	globalConvarCache.set(data)
	c.Set("Content-Type", "application/json")
	return c.Send(data)
}

// ─── Path resolution ──────────────────────────────────────────────────────────

func candidateCfgPaths(identity string) []string {
	if identity == "" {
		identity = "rust"
	}
	return []string{
		fmt.Sprintf("/mnt/server/server/%s/cfg/server.cfg", identity),
		"/mnt/server/server/rust/cfg/server.cfg",
		"/mnt/server/cfg/server.cfg",
		"/mnt/server/server.cfg",
	}
}

type cfgReadResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Found   bool   `json:"found"`
}

func (a *api) tryReadCfgFile(svc db.Service, path string) ([]byte, bool, error) {
	result, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_ReadFile{
			ReadFile: &gen.FileReadTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      path,
			},
		},
	})
	if err != nil {
		return nil, false, err
	}
	if result.Error != "" {
		return nil, false, nil
	}
	return result.Content, true, nil
}

func (a *api) tryListCfgDir(svc db.Service, path string) ([]*gen.FileEntry, bool, error) {
	result, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_ListFiles{
			ListFiles: &gen.FileListTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      path,
			},
		},
	})
	if err != nil {
		return nil, false, err
	}
	if result.Error != "" {
		return nil, false, nil
	}
	return result.Entries, true, nil
}

func (a *api) cfgRead(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	if !svc.NodeID.Valid {
		return c.Status(503).JSON(fiber.Map{"error": "service not assigned to a node"})
	}

	identity := svc.Config.Environment["SERVER_IDENTITY"]
	candidates := candidateCfgPaths(identity)

	for _, path := range candidates {
		data, found, err := a.tryReadCfgFile(svc, path)
		if err != nil {
			return err
		}
		if found {
			return c.JSON(cfgReadResponse{Path: path, Content: string(data), Found: true})
		}
	}

	entries, ok, err := a.tryListCfgDir(svc, "/mnt/server/server/")
	if err != nil {
		return err
	}
	if ok {
		for _, e := range entries {
			if e == nil || !e.GetIsDir() {
				continue
			}
			subEntries, subOk, err := a.tryListCfgDir(svc, "/mnt/server/server/"+e.GetName()+"/cfg/")
			if err != nil {
				return err
			}
			if !subOk {
				continue
			}
			for _, f := range subEntries {
				if f == nil || f.GetName() != "server.cfg" {
					continue
				}
				path := "/mnt/server/server/" + e.GetName() + "/cfg/server.cfg"
				data, found, err := a.tryReadCfgFile(svc, path)
				if err != nil {
					return err
				}
				if found {
					return c.JSON(cfgReadResponse{Path: path, Content: string(data), Found: true})
				}
			}
		}
	}

	defaultIdentity := identity
	if defaultIdentity == "" {
		defaultIdentity = "rust"
	}
	defaultPath := fmt.Sprintf("/mnt/server/server/%s/cfg/server.cfg", defaultIdentity)
	return c.JSON(cfgReadResponse{Path: defaultPath, Content: "", Found: false})
}

type cfgWriteRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (a *api) cfgWrite(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}

	var req cfgWriteRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	if req.Path == "" || !strings.HasPrefix(req.Path, "/mnt/server/") {
		return c.Status(400).JSON(fiber.Map{"error": "invalid path"})
	}

	_, err = a.dispatchFileCommandWithTimeout(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_WriteFile{
			WriteFile: &gen.FileWriteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      req.Path,
				Content:   []byte(req.Content),
			},
		},
	}, 30*time.Second)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"path": req.Path, "ok": true})
}
