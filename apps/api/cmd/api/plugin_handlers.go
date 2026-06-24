package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/apps/api/internal/service"
	gen "github.com/nexus-control/packages/proto/gen"
)

type servicePluginView struct {
	ID           string   `json:"id"`
	ServiceID    string   `json:"service_id"`
	Source       string   `json:"source"`
	ExternalID   string   `json:"external_id"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	VersionID    string   `json:"version_id"`
	JarFilename  string   `json:"jar_filename"`
	PluginDir    string   `json:"plugin_dir"`
	AutoUpdate   bool     `json:"auto_update"`
	InstalledAt  string   `json:"installed_at"`
	Dependencies []string `json:"dependencies"`
}

func toServicePluginView(p db.ServicePlugin) servicePluginView {
	v := servicePluginView{
		ID:           service.UUIDString(p.ID),
		ServiceID:    service.UUIDString(p.ServiceID),
		Source:       p.Source,
		ExternalID:   p.ExternalID,
		Name:         p.Name,
		Version:      p.Version,
		VersionID:    p.VersionID,
		JarFilename:  p.JarFilename,
		PluginDir:    p.PluginDir,
		AutoUpdate:   p.AutoUpdate,
		Dependencies: []string{},
	}
	if len(p.Dependencies) > 0 {
		_ = json.Unmarshal(p.Dependencies, &v.Dependencies)
	}
	if v.Dependencies == nil {
		v.Dependencies = []string{}
	}
	if ts := formatTimestamptz(p.InstalledAt); ts != nil {
		v.InstalledAt = *ts
	}
	return v
}

type PluginResult struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Name        string `json:"name"`
	Description string `json:"description"`
	IconURL     string `json:"icon_url"`
	Downloads   int64  `json:"downloads"`
	Version     string `json:"version"`
	VersionID   string `json:"version_id"`
	DownloadURL string `json:"download_url"`
	PageURL     string `json:"page_url"`
	JarFilename string `json:"jar_filename"`
	IsPaid      bool   `json:"is_paid"`
}

type InstallPluginRequest struct {
	Source      string `json:"source"`
	ExternalID  string `json:"external_id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	VersionID   string `json:"version_id"`
	DownloadURL string `json:"download_url"`
	JarFilename string `json:"jar_filename"`
	AutoUpdate  bool   `json:"auto_update"`
}

var frameworkToModrinthLoaders = map[string][]string{
	"Paper":    {"paper", "spigot", "bukkit"},
	"Purpur":   {"purpur", "paper", "spigot", "bukkit"},
	"Fabric":   {"fabric"},
	"Forge":    {"forge"},
	"NeoForge": {"neoforge", "forge"},
	"Quilt":    {"quilt", "fabric"},
	"Mohist":   {"mohist", "forge", "paper", "spigot", "bukkit"},
	"Arclight": {"fabric", "paper", "spigot", "bukkit"},
	"Vanilla":  {},
}

func (a *api) listPlugins(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	plugins, err := a.q.ListServicePlugins(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	out := make([]servicePluginView, 0, len(plugins))
	for _, p := range plugins {
		out = append(out, toServicePluginView(p))
	}
	return c.JSON(out)
}

func (a *api) searchPlugins(c *fiber.Ctx) error {
	if _, err := a.loadOwned(c); err != nil {
		return err
	}
	query := c.Query("q", "")
	source := c.Query("source", "all")
	mcVer := c.Query("mc_version", "1.21.4")
	fw := c.Query("framework", "Paper")
	page, _ := strconv.Atoi(c.Query("page", "0"))

	if isRustService(fw) && strings.ToLower(fw) != "vanilla" {
		var results []PluginResult
		if source == "all" || source == "umod" {
			if r, err := searchUmod(query, page); err == nil {
				results = append(results, r...)
			}
		}
		if source == "all" || source == "codefling" {
			cats := "2"
			fwLower := strings.ToLower(fw)
			if fwLower == "carbon" || fwLower == "carbon-minimal" {
				cats = "2,21"
			}
			if r, err := searchCodefling(query, cats); err == nil {
				results = append(results, r...)
			}
		}
		if results == nil {
			results = []PluginResult{}
		}
		return c.JSON(fiber.Map{"results": results})
	}

	var results []PluginResult
	if source == "all" || source == "modrinth" {
		if r, err := searchModrinth(query, mcVer, fw, page); err == nil {
			results = append(results, r...)
		}
	}
	if (source == "all" || source == "spigot") && isPluginFramework(fw) {
		if r, err := searchSpiget(query, page); err == nil {
			results = append(results, r...)
		}
	}
	if (source == "all" || source == "curseforge") && a.cfg.CurseForgeAPIKey != "" {
		if r, err := searchCurseForge(query, mcVer, fw, page, a.cfg.CurseForgeAPIKey); err == nil {
			results = append(results, r...)
		}
	}
	if results == nil {
		results = []PluginResult{}
	}
	return c.JSON(fiber.Map{"results": results})
}

func (a *api) installPlugin(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	var req InstallPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	if req.DownloadURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "no direct download URL available; install manually via Files tab"})
	}

	jarBytes, err := downloadPluginFile(req.DownloadURL, 200<<20)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": fmt.Sprintf("download failed: %v", err)})
	}

	fw := svc.Config.Environment["FRAMEWORK"]
	dir, err := resolvePluginDir(fw)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	jarName := sanitizePluginFilenameForService(fw, req.JarFilename)
	remotePath := fmt.Sprintf("/mnt/server/%s/%s", dir, jarName)

	if _, err := a.dispatchFileCommandWithTimeout(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_WriteFile{
			WriteFile: &gen.FileWriteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      remotePath,
				Content:   jarBytes,
			},
		},
	}, 60*time.Second); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	plugin, err := a.q.UpsertServicePlugin(c.UserContext(), db.ServicePlugin{
		ServiceID:   svc.ID,
		Source:      req.Source,
		ExternalID:  req.ExternalID,
		Name:        req.Name,
		Version:     req.Version,
		VersionID:   req.VersionID,
		JarFilename: jarName,
		PluginDir:   dir,
		AutoUpdate:  req.AutoUpdate,
	})
	if err != nil {
		return err
	}
	if strings.HasSuffix(strings.ToLower(jarName), ".cs") {
		_ = a.q.UpdatePluginDependencies(c.UserContext(), plugin.ID, parsePluginReferences(jarBytes))
		plugin, _ = a.q.GetServicePluginByFilename(c.UserContext(), svc.ID, jarName)
	}
	return c.Status(201).JSON(toServicePluginView(plugin))
}

func (a *api) uninstallPlugin(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	pluginID, err := service.ParseUUID(c.Params("pluginId"))
	if err != nil {
		return fiber.ErrBadRequest
	}

	plugins, err := a.q.ListServicePlugins(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	var target *db.ServicePlugin
	for _, p := range plugins {
		if p.ID == pluginID {
			pp := p
			target = &pp
			break
		}
	}
	if target == nil {
		return fiber.ErrNotFound
	}

	remotePath := fmt.Sprintf("/mnt/server/%s/%s", target.PluginDir, target.JarFilename)
	if _, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_DeleteFile{
			DeleteFile: &gen.FileDeleteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      remotePath,
			},
		},
	}); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	if err := a.q.DeleteServicePlugin(c.UserContext(), pluginID, svc.ID); err != nil {
		return err
	}
	return c.SendStatus(204)
}

func (a *api) updatePlugin(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}
	pluginID, err := service.ParseUUID(c.Params("pluginId"))
	if err != nil {
		return fiber.ErrBadRequest
	}
	var req InstallPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	if req.DownloadURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "no download URL"})
	}

	plugins, err := a.q.ListServicePlugins(c.UserContext(), svc.ID)
	if err != nil {
		return err
	}
	var existing *db.ServicePlugin
	for _, p := range plugins {
		if p.ID == pluginID {
			pp := p
			existing = &pp
			break
		}
	}
	if existing == nil {
		return fiber.ErrNotFound
	}

	jarBytes, err := downloadPluginFile(req.DownloadURL, 200<<20)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": fmt.Sprintf("download failed: %v", err)})
	}

	fw := svc.Config.Environment["FRAMEWORK"]
	dir, err := resolvePluginDir(fw)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	jarName := sanitizePluginFilenameForService(fw, req.JarFilename)

	if existing.JarFilename != jarName {
		oldPath := fmt.Sprintf("/mnt/server/%s/%s", existing.PluginDir, existing.JarFilename)
		_, _ = a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
			Action: &gen.DownstreamEnvelope_DeleteFile{
				DeleteFile: &gen.FileDeleteTask{
					ServiceId: service.UUIDString(svc.ID),
					Path:      oldPath,
				},
			},
		})
	}

	remotePath := fmt.Sprintf("/mnt/server/%s/%s", dir, jarName)
	if _, err := a.dispatchFileCommandWithTimeout(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_WriteFile{
			WriteFile: &gen.FileWriteTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      remotePath,
				Content:   jarBytes,
			},
		},
	}, 60*time.Second); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}

	plugin, err := a.q.UpdateServicePlugin(c.UserContext(), pluginID, svc.ID, db.ServicePlugin{
		Source:      req.Source,
		ExternalID:  req.ExternalID,
		Name:        req.Name,
		Version:     req.Version,
		VersionID:   req.VersionID,
		JarFilename: jarName,
		PluginDir:   dir,
		AutoUpdate:  req.AutoUpdate,
	})
	if err != nil {
		return err
	}
	if strings.HasSuffix(strings.ToLower(jarName), ".cs") {
		_ = a.q.UpdatePluginDependencies(c.UserContext(), plugin.ID, parsePluginReferences(jarBytes))
		plugin, _ = a.q.GetServicePluginByFilename(c.UserContext(), svc.ID, jarName)
	}
	return c.JSON(toServicePluginView(plugin))
}

func (a *api) scanPlugins(c *fiber.Ctx) error {
	svc, err := a.loadOwned(c)
	if err != nil {
		return err
	}

	fw := svc.Config.Environment["FRAMEWORK"]
	dir, err := resolvePluginDir(fw)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	result, err := a.dispatchFileCommand(svc, &gen.DownstreamEnvelope{
		Action: &gen.DownstreamEnvelope_ListFiles{
			ListFiles: &gen.FileListTask{
				ServiceId: service.UUIDString(svc.ID),
				Path:      fmt.Sprintf("/mnt/server/%s/", dir),
			},
		},
	})
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	if result.Error != "" {
		return c.Status(502).JSON(fiber.Map{"error": result.Error})
	}

	installed, _ := a.q.ListServicePlugins(c.UserContext(), svc.ID)
	knownFiles := map[string]bool{}
	for _, p := range installed {
		knownFiles[p.JarFilename] = true
	}

	scanExt := ".jar"
	if isRustService(fw) {
		scanExt = ".cs"
	}
	for _, e := range result.Entries {
		if e == nil || e.GetIsDir() || !strings.HasSuffix(strings.ToLower(e.GetName()), scanExt) {
			continue
		}
		if knownFiles[e.GetName()] {
			continue
		}
		displayName := e.GetName()
		if strings.HasSuffix(strings.ToLower(displayName), scanExt) {
			displayName = displayName[:len(displayName)-len(scanExt)]
		}
		_, _ = a.q.UpsertServicePlugin(c.UserContext(), db.ServicePlugin{
			ServiceID:   svc.ID,
			Source:      "manual",
			ExternalID:  e.GetName(),
			Name:        displayName,
			Version:     "unknown",
			VersionID:   "",
			JarFilename: e.GetName(),
			PluginDir:   dir,
			AutoUpdate:  false,
		})
	}

	plugins, _ := a.q.ListServicePlugins(c.UserContext(), svc.ID)
	out := make([]servicePluginView, 0, len(plugins))
	for _, p := range plugins {
		out = append(out, toServicePluginView(p))
	}
	return c.JSON(out)
}

func isPluginFramework(fw string) bool {
	switch fw {
	case "Paper", "Purpur", "Mohist", "Arclight":
		return true
	default:
		return false
	}
}

func frameworkProjectType(fw string) string {
	switch fw {
	case "Paper", "Purpur":
		return "plugin"
	case "Fabric", "Forge", "NeoForge", "Quilt":
		return "mod"
	default:
		return ""
	}
}

func frameworkPluginDir(fw string) (string, error) {
	switch fw {
	case "Fabric", "Forge", "NeoForge", "Quilt":
		return "mods", nil
	case "Paper", "Purpur", "Mohist", "Arclight":
		return "plugins", nil
	default:
		return "plugins", nil
	}
}

func rustPluginDir(fw string) string {
	switch strings.ToLower(fw) {
	case "oxide":
		return "oxide/plugins"
	case "carbon", "carbon-minimal":
		return "carbon/plugins"
	default:
		return "oxide/plugins"
	}
}

func isRustService(fw string) bool {
	fw = strings.ToLower(fw)
	return fw == "oxide" || fw == "carbon" || fw == "carbon-minimal" || fw == "vanilla"
}

func resolvePluginDir(fw string) (string, error) {
	if isRustService(fw) {
		return rustPluginDir(fw), nil
	}
	return frameworkPluginDir(fw)
}

func searchUmod(query string, page int) ([]PluginResult, error) {
	u := fmt.Sprintf(
		"https://umod.org/plugins/search.json?query=%s&page=%d&sort=latest_release_at&sortdir=desc&filter=&categories%%5B%%5D=rust&author=",
		url.QueryEscape(query), page+1)

	resp, err := pluginHTTPGet(u, map[string]string{"User-Agent": "Vivox-Panel/1.0"})
	if err != nil {
		return nil, err
	}

	var body struct {
		Data []struct {
			Name                         string `json:"name"`
			Title                        string `json:"title"`
			Slug                         string `json:"slug"`
			Description                  string `json:"description"`
			Downloads                    int64  `json:"downloads"`
			IconURL                      string `json:"icon_url"`
			DownloadURL                  string `json:"download_url"`
			URL                          string `json:"url"`
			LatestReleaseVersion         string `json:"latest_release_version"`
			LatestReleaseVersionChecksum string `json:"latest_release_version_checksum"`
			Author                       string `json:"author"`
			StatusDetail                 struct {
				Value int `json:"value"`
			} `json:"status_detail"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp, &body); err != nil {
		return nil, err
	}

	var out []PluginResult
	for _, p := range body.Data {
		if p.StatusDetail.Value != 1 {
			continue
		}
		jarName := p.Name + ".cs"
		if p.DownloadURL != "" {
			parts := strings.Split(p.DownloadURL, "/")
			if len(parts) > 0 {
				jarName = parts[len(parts)-1]
			}
		}
		out = append(out, PluginResult{
			ID:          p.Slug,
			Source:      "umod",
			Name:        p.Title,
			Description: p.Description,
			IconURL:     p.IconURL,
			Downloads:   p.Downloads,
			Version:     p.LatestReleaseVersion,
			VersionID:   p.LatestReleaseVersionChecksum,
			DownloadURL: p.DownloadURL,
			PageURL:     p.URL,
			JarFilename: jarName,
		})
	}
	return out, nil
}

type CodeflingPlugin struct {
	ID                int      `json:"id"`
	Title             string   `json:"title"`
	Author            string   `json:"author"`
	Description       string   `json:"description"`
	FileName          string   `json:"fileName"`
	Tags              []string `json:"tags"`
	Rating            float64  `json:"rating"`
	IsPaid            bool     `json:"isPaid"`
	IsPurchasable     bool     `json:"isPurchasable"`
	URL               string   `json:"url"`
	PrimaryScreenshot string   `json:"primaryScreenshot"`
	Downloads         int64    `json:"downloads"`
	Version           string   `json:"version"`
	Compatibility     int      `json:"compatibility"`
}

func codeflingIsPaid(p CodeflingPlugin) bool {
	return p.IsPaid || p.IsPurchasable
}

func codeflingID(p CodeflingPlugin) string {
	return fmt.Sprintf("%d", p.ID)
}

func searchCodefling(query, categories string) ([]PluginResult, error) {
	u := fmt.Sprintf("https://www.codefling.com/db?category=%s", categories)

	resp, err := pluginHTTPGet(u, map[string]string{
		"User-Agent": "Vivox-Panel/1.0",
		"Accept":     "application/json",
	})
	if err != nil {
		return nil, err
	}

	preview := resp
	if len(preview) > 500 {
		preview = preview[:500]
	}
	slog.Debug("codefling raw", "body", string(preview))

	var items []CodeflingPlugin
	if err := json.Unmarshal(resp, &items); err != nil {
		var wrapped struct {
			Data []CodeflingPlugin `json:"data"`
		}
		if err2 := json.Unmarshal(resp, &wrapped); err2 != nil {
			return nil, err
		}
		items = wrapped.Data
	}

	queryLower := strings.ToLower(query)
	var out []PluginResult
	for _, it := range items {
		if codeflingIsPaid(it) {
			continue
		}
		if queryLower != "" &&
			!strings.Contains(strings.ToLower(it.Title), queryLower) &&
			!strings.Contains(strings.ToLower(it.Description), queryLower) {
			continue
		}
		filename := it.FileName
		if filename == "" {
			filename = sanitizeFilenameWithExt(it.Title, ".cs")
		}
		if !strings.HasSuffix(strings.ToLower(filename), ".cs") && !strings.Contains(filename, ".") {
			filename += ".cs"
		}

		pageURL := it.URL
		if pageURL == "" {
			pageURL = fmt.Sprintf("https://codefling.com/plugins/%s", strings.ToLower(strings.ReplaceAll(it.Title, " ", "-")))
		}

		out = append(out, PluginResult{
			ID:          codeflingID(it),
			Source:      "codefling",
			Name:        it.Title,
			Description: it.Description,
			IconURL:     it.PrimaryScreenshot,
			Downloads:   it.Downloads,
			Version:     it.Version,
			VersionID:   it.Version,
			DownloadURL: "",
			PageURL:     pageURL,
			JarFilename: filename,
		})
	}
	return out, nil
}

func parsePluginReferences(src []byte) []string {
	re1 := regexp.MustCompile(`\[PluginReference\("([^"]+)"\)\]`)
	re2 := regexp.MustCompile(`\[PluginReference\]\s*(?:private|public|protected|internal)?\s+Plugin\s+(\w+)`)

	seen := map[string]bool{}
	for _, m := range re1.FindAllSubmatch(src, -1) {
		seen[string(m[1])] = true
	}
	for _, m := range re2.FindAllSubmatch(src, -1) {
		seen[string(m[1])] = true
	}
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func searchModrinth(query, mcVer, fw string, page int) ([]PluginResult, error) {
	loaders := frameworkToModrinthLoaders[fw]
	if len(loaders) == 0 {
		return nil, nil
	}
	pt := frameworkProjectType(fw)

	facets := [][]string{{fmt.Sprintf("game_versions:%s", mcVer)}}
	loaderFacet := make([]string, len(loaders))
	for i, l := range loaders {
		loaderFacet[i] = fmt.Sprintf("loaders:%s", l)
	}
	facets = append(facets, loaderFacet)
	if pt != "" {
		facets = append(facets, []string{fmt.Sprintf("project_type:%s", pt)})
	}

	facetJSON, _ := json.Marshal(facets)
	u := fmt.Sprintf("https://api.modrinth.com/v2/search?query=%s&facets=%s&limit=20&offset=%d",
		url.QueryEscape(query), url.QueryEscape(string(facetJSON)), page*20)

	resp, err := pluginHTTPGet(u, nil)
	if err != nil {
		return nil, err
	}

	var body struct {
		Hits []struct {
			ProjectID   string   `json:"project_id"`
			Title       string   `json:"title"`
			Description string   `json:"description"`
			IconURL     string   `json:"icon_url"`
			Downloads   int64    `json:"downloads"`
			Slug        string   `json:"slug"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(resp, &body); err != nil {
		return nil, err
	}

	var out []PluginResult
	for _, h := range body.Hits {
		ver, verID, dlURL, jarName := modrinthLatestVersion(h.ProjectID, mcVer, loaders)
		out = append(out, PluginResult{
			ID:          h.ProjectID,
			Source:      "modrinth",
			Name:        h.Title,
			Description: h.Description,
			IconURL:     h.IconURL,
			Downloads:   h.Downloads,
			Version:     ver,
			VersionID:   verID,
			DownloadURL: dlURL,
			PageURL:     fmt.Sprintf("https://modrinth.com/mod/%s", h.Slug),
			JarFilename: jarName,
		})
	}
	return out, nil
}

func modrinthLatestVersion(projectID, mcVer string, loaders []string) (ver, verID, dlURL, jarName string) {
	loaderJSON, _ := json.Marshal(loaders)
	mcJSON, _ := json.Marshal([]string{mcVer})
	u := fmt.Sprintf("https://api.modrinth.com/v2/project/%s/version?game_versions=%s&loaders=%s",
		projectID, url.QueryEscape(string(mcJSON)), url.QueryEscape(string(loaderJSON)))
	resp, err := pluginHTTPGet(u, nil)
	if err != nil {
		return
	}
	var versions []struct {
		ID            string `json:"id"`
		VersionNumber string `json:"version_number"`
		Files         []struct {
			URL      string `json:"url"`
			Filename string `json:"filename"`
			Primary  bool   `json:"primary"`
		} `json:"files"`
	}
	if err := json.Unmarshal(resp, &versions); err != nil || len(versions) == 0 {
		return
	}
	v := versions[0]
	ver = v.VersionNumber
	verID = v.ID
	for _, f := range v.Files {
		if f.Primary || dlURL == "" {
			dlURL = f.URL
			jarName = f.Filename
		}
	}
	return
}

func searchSpiget(query string, page int) ([]PluginResult, error) {
	var u string
	if query == "" {
		u = fmt.Sprintf("https://api.spiget.org/v2/resources/free?size=20&page=%d&sort=-downloads&fields=id,name,tag,downloads,rating,version,icon,external,links,premium,file", page)
	} else {
		u = fmt.Sprintf("https://api.spiget.org/v2/search/resources/%s?size=20&page=%d&sort=-downloads&fields=id,name,tag,downloads,rating,version,icon,external,links,premium,file",
			url.PathEscape(query), page)
	}

	resp, err := pluginHTTPGet(u, map[string]string{"User-Agent": "Vivox-Panel/1.0"})
	if err != nil {
		return nil, err
	}

	var items []struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		Tag       string `json:"tag"`
		Downloads int64  `json:"downloads"`
		Version   struct {
			ID string `json:"id"`
		} `json:"version"`
		Icon struct {
			URL string `json:"url"`
		} `json:"icon"`
		External bool `json:"external"`
		Premium  bool `json:"premium"`
		Links    struct {
			URL string `json:"url"`
		} `json:"links"`
	}
	if err := json.Unmarshal(resp, &items); err != nil {
		return nil, err
	}

	var out []PluginResult
	for _, it := range items {
		if it.Premium {
			continue
		}
		dlURL := ""
		jarName := fmt.Sprintf("%s.jar", sanitizePluginFilename(strings.TrimSuffix(it.Name, ".jar")))
		if it.External {
			dlURL = fmt.Sprintf("https://api.spiget.org/v2/resources/%d/download", it.ID)
		}
		iconURL := ""
		if it.Icon.URL != "" {
			iconURL = fmt.Sprintf("https://www.spigotmc.org/%s", it.Icon.URL)
		}
		out = append(out, PluginResult{
			ID:          fmt.Sprintf("%d", it.ID),
			Source:      "spigot",
			Name:        it.Name,
			Description: it.Tag,
			IconURL:     iconURL,
			Downloads:   it.Downloads,
			Version:     it.Version.ID,
			VersionID:   it.Version.ID,
			DownloadURL: dlURL,
			PageURL:     fmt.Sprintf("https://www.spigotmc.org/resources/%d/", it.ID),
			JarFilename: jarName,
		})
	}
	return out, nil
}

func searchCurseForge(query, mcVer, fw string, page int, apiKey string) ([]PluginResult, error) {
	classID := 6
	if isPluginFramework(fw) {
		classID = 5
	}

	u := fmt.Sprintf(
		"https://api.curseforge.com/v1/mods/search?gameId=432&classId=%d&searchFilter=%s&gameVersion=%s&index=%d&pageSize=20",
		classID, url.QueryEscape(query), mcVer, page*20)

	resp, err := pluginHTTPGet(u, map[string]string{"x-api-key": apiKey})
	if err != nil {
		return nil, err
	}

	var body struct {
		Data []struct {
			ID          int     `json:"id"`
			Name        string  `json:"name"`
			Summary     string  `json:"summary"`
			Links       struct{ WebsiteURL string `json:"websiteUrl"` } `json:"links"`
			Logo        struct{ ThumbnailURL string `json:"thumbnailUrl"` } `json:"logo"`
			DownloadCount float64 `json:"downloadCount"`
			LatestFilesIndexes []struct {
				GameVersion string `json:"gameVersion"`
				FileID      int    `json:"fileId"`
				Filename    string `json:"filename"`
				ReleaseType int    `json:"releaseType"`
			} `json:"latestFilesIndexes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp, &body); err != nil {
		return nil, err
	}

	var out []PluginResult
	for _, m := range body.Data {
		fileID, filename, ver := 0, "", ""
		for _, f := range m.LatestFilesIndexes {
			if f.GameVersion == mcVer && f.ReleaseType == 1 {
				fileID = f.FileID
				filename = f.Filename
				ver = f.Filename
				break
			}
		}
		if fileID == 0 && len(m.LatestFilesIndexes) > 0 {
			f := m.LatestFilesIndexes[0]
			fileID = f.FileID
			filename = f.Filename
			ver = f.Filename
		}
		dlURL := ""
		if fileID != 0 {
			dlResp, err := pluginHTTPGet(
				fmt.Sprintf("https://api.curseforge.com/v1/mods/%d/files/%d/download-url", m.ID, fileID),
				map[string]string{"x-api-key": apiKey})
			if err == nil {
				var dlBody struct {
					Data string `json:"data"`
				}
				if json.Unmarshal(dlResp, &dlBody) == nil {
					dlURL = dlBody.Data
				}
			}
		}
		out = append(out, PluginResult{
			ID:          fmt.Sprintf("%d", m.ID),
			Source:      "curseforge",
			Name:        m.Name,
			Description: m.Summary,
			IconURL:     m.Logo.ThumbnailURL,
			Downloads:   int64(m.DownloadCount),
			Version:     ver,
			VersionID:   fmt.Sprintf("%d", fileID),
			DownloadURL: dlURL,
			PageURL:     m.Links.WebsiteURL,
			JarFilename: filename,
		})
	}
	return out, nil
}

func pluginHTTPGet(u string, headers map[string]string) ([]byte, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

func downloadPluginFile(u string, maxBytes int64) ([]byte, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Vivox-Panel/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxBytes))
}

func sanitizePluginFilename(s string) string {
	return sanitizeFilenameWithExt(s, ".jar")
}

func sanitizeFilenameWithExt(s, expectedExt string) string {
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '-' || r == '_' || r == '.' {
			return r
		}
		return '_'
	}, s)
	if !strings.HasSuffix(strings.ToLower(s), expectedExt) {
		s += expectedExt
	}
	return s
}

func sanitizePluginFilenameForService(fw, filename string) string {
	if isRustService(fw) {
		return sanitizeFilenameWithExt(filename, ".cs")
	}
	return sanitizePluginFilename(filename)
}
