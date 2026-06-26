package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/packages/domain"
	"gopkg.in/yaml.v3"
)

// ConfigurableField is a user-tunable template parameter surfaced in the deploy
// wizard. The supplied value is written into the service environment under Env.
type ConfigurableField struct {
	Key          string `yaml:"key" json:"key"`
	Label        string `yaml:"label" json:"label"`
	Default      string `yaml:"default" json:"default"`
	Env          string `yaml:"env" json:"env"`
	Description  string `yaml:"description" json:"description,omitempty"`
	Options      string `yaml:"options" json:"options,omitempty"`
	FieldType    string `yaml:"field_type" json:"field_type,omitempty"`
	Required     bool   `yaml:"required" json:"required,omitempty"`
}

// TemplateResources are the default resource limits applied to a service created
// from the template.
type TemplateResources struct {
	MemoryMB  int64 `yaml:"memory_mb" json:"memory_mb"`
	CPUShares int64 `yaml:"cpu_shares" json:"cpu_shares"`
	DiskGB    int64 `yaml:"disk_gb" json:"disk_gb"`
}

// Template is a one-click, Docker-backed service blueprint (plan section 9).
type Template struct {
	ID           string              `yaml:"id" json:"id"`
	Name         string              `yaml:"name" json:"name"`
	Description  string              `yaml:"description" json:"description"`
	Type         string              `yaml:"type" json:"type"` // game | docker | static
	Image        string              `yaml:"image" json:"image"`
	Ports        []string            `yaml:"ports" json:"ports"`
	Env          map[string]string   `yaml:"env" json:"env"`
	Configurable  []ConfigurableField `yaml:"configurable" json:"configurable"`
	StartupCmd     string              `yaml:"startup_cmd" json:"startup_cmd,omitempty"`
	InstallScript  string              `yaml:"install_script" json:"install_script,omitempty"`
	InstallerImage string              `yaml:"installer_image" json:"installer_image,omitempty"`
	Resources      TemplateResources   `yaml:"resources" json:"resources"`
}

// DefaultInstallScript runs when a template does not define its own install_script.
// Every service gets a persistent /mnt/server volume; this prepares it on first boot.
const DefaultInstallScript = `#!/bin/bash
set -euo pipefail
echo "[vivox] Preparing server data directory..."
mkdir -p /mnt/server
echo "[vivox] Install complete."
`

// NormalizeServiceConfig fills in defaults for persisted service config.
func NormalizeServiceConfig(cfg domain.ServiceConfig) domain.ServiceConfig {
	if strings.TrimSpace(cfg.InstallScript) == "" {
		cfg.InstallScript = DefaultInstallScript
	}
	return cfg
}

// LoadTemplates parses every *.yaml/*.yml file in dir into a template registry
// keyed by template id.
func LoadTemplates(dir string) (map[string]*Template, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read templates dir: %w", err)
	}
	out := make(map[string]*Template)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var t Template
		if err := yaml.Unmarshal(raw, &t); err != nil {
			return nil, fmt.Errorf("parse %s: %w", e.Name(), err)
		}
		if t.ID == "" {
			return nil, fmt.Errorf("template %s missing id", e.Name())
		}
		out[t.ID] = &t
	}
	return out, nil
}

// ServiceType maps the template's type string to the DB enum, defaulting to
// docker for unknown values.
func (t *Template) ServiceType() db.ServiceType {
	switch t.Type {
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

// Reserved param keys carry structural overrides (not environment variables):
// the container image and its port bindings. Used primarily by the generic
// Docker template's advanced deploy tab.
const (
	ParamImage = "image"
	ParamPort  = "port"
	ParamPorts = "ports"
)

// BuildConfig resolves the template into a concrete ServiceConfig. Configurable
// fields with a non-empty Env are injected as environment variables (overridable
// via params keyed by field Key); the reserved keys image/port(s) override the
// container image and port bindings.
func (t *Template) BuildConfig(params map[string]string) domain.ServiceConfig {
	env := make(map[string]string, len(t.Env)+len(t.Configurable))
	for k, v := range t.Env {
		env[k] = v
	}
	for _, f := range t.Configurable {
		if f.Env == "" {
			continue // structural field (e.g. image/port), handled below
		}
		val := f.Default
		if params != nil {
			if p, ok := params[f.Key]; ok && p != "" {
				val = p
			}
		}
		env[f.Env] = val
	}

	image := t.Image
	if v := params[ParamImage]; v != "" {
		image = v
	}

	ports := append([]string(nil), t.Ports...)
	if v := params[ParamPorts]; v != "" {
		ports = splitPorts(v)
	} else if v := params[ParamPort]; v != "" {
		ports = []string{v}
	}

	install := t.InstallScript
	if install == "" {
		install = DefaultInstallScript
	}

	return domain.ServiceConfig{
		Image:          image,
		Ports:          ports,
		Environment:    env,
		StartupCmd:     t.StartupCmd,
		InstallScript:  install,
		InstallerImage: t.InstallerImage,
	}
}

// splitPorts parses a comma-separated port-binding list.
func splitPorts(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ResourceLimits returns the default per-service limits for the template.
func (t *Template) ResourceLimits() domain.ResourceLimits {
	return domain.ResourceLimits{
		CPUShares: t.Resources.CPUShares,
		MemoryMB:  t.Resources.MemoryMB,
		DiskGB:    t.Resources.DiskGB,
	}
}

// MergeTemplateEnvironment adds missing keys from tmpl.Env and configurable field
// defaults without overwriting existing values in env.
func MergeTemplateEnvironment(tmpl *Template, env map[string]string) map[string]string {
	if tmpl == nil {
		return env
	}
	out := make(map[string]string, len(env)+len(tmpl.Env)+len(tmpl.Configurable))
	for k, v := range env {
		out[k] = v
	}
	for _, f := range tmpl.Configurable {
		if f.Env == "" {
			continue
		}
		if _, ok := out[f.Env]; !ok {
			out[f.Env] = f.Default
		}
	}
	for k, v := range tmpl.Env {
		if _, ok := out[k]; !ok {
			out[k] = v
		}
	}
	return out
}

func hasRustEnvMarkers(env map[string]string) bool {
	if env == nil {
		return false
	}
	for _, k := range []string{"RCON_PASS", "RCON_PORT", "QUERY_PORT", "SERVER_IDENTITY", "DOWNLOAD_METHOD"} {
		if _, ok := env[k]; ok {
			return true
		}
	}
	return false
}

func hasMinecraftEnvMarkers(env map[string]string) bool {
	if env == nil {
		return false
	}
	for _, k := range []string{"MC_VERSION", "MEMORY", "MOTD", "JVM_FLAGS"} {
		if _, ok := env[k]; ok {
			return true
		}
	}
	return false
}

func imageMatchesTemplate(image, templateImage string) bool {
	if image == "" || templateImage == "" {
		return false
	}
	if strings.EqualFold(image, templateImage) {
		return true
	}
	img := strings.ToLower(image)
	ti := strings.ToLower(templateImage)
	imgBase := strings.Split(img, ":")[0]
	tiBase := strings.Split(ti, ":")[0]
	return strings.Contains(img, tiBase) || strings.Contains(ti, imgBase)
}

// FindTemplateForConfig matches a persisted service config to a loaded template
// by container image or known game environment markers.
func FindTemplateForConfig(reg map[string]*Template, cfg domain.ServiceConfig) *Template {
	if len(reg) == 0 {
		return nil
	}
	for _, t := range reg {
		if imageMatchesTemplate(cfg.Image, t.Image) {
			return t
		}
	}
	env := cfg.Environment
	if hasRustEnvMarkers(env) {
		if t, ok := reg["rust"]; ok {
			return t
		}
	}
	if hasMinecraftEnvMarkers(env) && !hasRustEnvMarkers(env) {
		if t, ok := reg["minecraft"]; ok {
			return t
		}
	}
	if env != nil {
		if fw, ok := env["FRAMEWORK"]; ok {
			switch strings.ToLower(fw) {
			case "oxide", "carbon", "carbon-minimal":
				if t, ok := reg["rust"]; ok {
					return t
				}
			case "purpur", "vanilla", "fabric", "forge", "neoforge", "quilt", "spigot":
				if t, ok := reg["minecraft"]; ok {
					return t
				}
			}
		}
	}
	return nil
}

// List returns the templates sorted by id for stable API output.
func List(reg map[string]*Template) []*Template {
	ids := make([]string, 0, len(reg))
	for id := range reg {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*Template, 0, len(ids))
	for _, id := range ids {
		out = append(out, reg[id])
	}
	return out
}
