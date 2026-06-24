package domain

import "fmt"

// PortsForDocker returns Docker-style port specs for the agent.
// Prefers explicit Ports strings; otherwise builds from PortMappings.
func PortsForDocker(cfg ServiceConfig) []string {
	if len(cfg.Ports) > 0 {
		return cfg.Ports
	}
	out := make([]string, 0, len(cfg.PortMappings))
	for _, m := range cfg.PortMappings {
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
