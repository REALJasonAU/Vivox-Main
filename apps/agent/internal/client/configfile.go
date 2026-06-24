package client

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// ConfigFile is the YAML configuration schema for nexus-agent.yaml.
type ConfigFile struct {
	Addr              string `yaml:"addr"`
	AgentID           string `yaml:"agent_id"`
	Token             string `yaml:"token"`
	Insecure          bool   `yaml:"insecure"`
	HeartbeatInterval string `yaml:"heartbeat_interval"`
	MetricsInterval   string `yaml:"metrics_interval"`
	CertFile          string `yaml:"cert_file"`
	KeyFile           string `yaml:"key_file"`
	CAFile            string `yaml:"ca_file"`
	ServerName        string `yaml:"server_name"`
	HealthAddr        string `yaml:"health_addr"`
	Mock              bool   `yaml:"mock"`
}

// LoadConfigFile reads and parses a YAML agent config file.
func LoadConfigFile(path string) (ConfigFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ConfigFile{}, err
	}
	var f ConfigFile
	if err := yaml.Unmarshal(data, &f); err != nil {
		return ConfigFile{}, fmt.Errorf("parse config: %w", err)
	}
	return f, nil
}

// ToConfig converts a ConfigFile into a runtime Config.
func (f ConfigFile) ToConfig() (Config, error) {
	cfg := Config{
		Address:    f.Addr,
		AgentID:    f.AgentID,
		Token:      f.Token,
		Insecure:   f.Insecure,
		CertFile:   f.CertFile,
		KeyFile:    f.KeyFile,
		CAFile:     f.CAFile,
		ServerName: f.ServerName,
		HealthAddr: f.HealthAddr,
	}
	if f.HeartbeatInterval != "" {
		d, err := time.ParseDuration(f.HeartbeatInterval)
		if err != nil {
			return Config{}, fmt.Errorf("heartbeat_interval: %w", err)
		}
		cfg.HeartbeatInterval = d
	}
	if f.MetricsInterval != "" {
		d, err := time.ParseDuration(f.MetricsInterval)
		if err != nil {
			return Config{}, fmt.Errorf("metrics_interval: %w", err)
		}
		cfg.MetricsInterval = d
	}
	return cfg, nil
}
