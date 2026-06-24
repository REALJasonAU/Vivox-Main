// Package domain holds strict Go types used as sqlc JSONB go_type overrides.
// These types are the single source of truth for the shape of JSONB columns
// (services.resource_limits, services.config, nodes.capacity) so that the
// generated db layer is fully type-safe and cannot drift from the schema.
package domain

// NodeCapacity describes the total resources advertised by an edge node.
// Stored in nodes.capacity (JSONB).
type NodeCapacity struct {
	CPUCores int64 `json:"cpu_cores"`
	RAMMb    int64 `json:"ram_mb"`
	DiskGb   int64 `json:"disk_gb"`
}

// ResourceLimits describes the resource ceiling applied to a single service.
// Stored in services.resource_limits (JSONB).
type ResourceLimits struct {
	CPUShares     int64    `json:"cpu_shares"`
	MemoryMB      int64    `json:"memory_mb"`
	DiskGB        int64    `json:"disk_gb"`
	MaxBackups    int      `json:"max_backups,omitempty"`
	BackupStorage string   `json:"backup_storage,omitempty"`
	DatabaseSlots int      `json:"database_slots,omitempty"`
	DatabaseTypes []string `json:"database_types,omitempty"`
}

// HealthCheck configures HTTP health probing for a service container.
type HealthCheck struct {
	Path     string `json:"path"`               // e.g. "/health"
	Port     int    `json:"port"`               // container port to check
	Interval int    `json:"interval,omitempty"` // seconds (default 30)
	Timeout  int    `json:"timeout,omitempty"`  // seconds (default 5)
}

// PortMapping is a structured published port with optional bind IP and alias.
type PortMapping struct {
	HostIP        string `json:"host_ip,omitempty"`
	HostPort      int    `json:"host_port"`
	ContainerPort int    `json:"container_port"`
	Proto         string `json:"proto,omitempty"`
	Alias         string `json:"alias,omitempty"`
}

// ServiceConfig is the per-service launch configuration.
// Stored in services.config (JSONB).
type ServiceConfig struct {
	Image        string            `json:"image,omitempty"`
	Ports        []string          `json:"ports,omitempty"`
	PortMappings []PortMapping     `json:"port_mappings,omitempty"`
	Environment  map[string]string `json:"environment,omitempty"`
	StartupCmd    string            `json:"startup_cmd,omitempty"`
	InstallScript string            `json:"install_script,omitempty"`
	InstallerImage string           `json:"installer_image,omitempty"`
	MainPort       int              `json:"main_port,omitempty"`
	AssetURL      string            `json:"asset_url,omitempty"`
	HealthCheck  *HealthCheck      `json:"health_check,omitempty"`
}
