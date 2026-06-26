// Package ufw manages host firewall rules via the ufw CLI. It is called by the
// docker package whenever a service's port bindings change: Allow opens rules
// on container start, Remove closes them on container removal.
//
// All operations are best-effort — if ufw is not installed or returns an error,
// the call is silently ignored so the agent continues normally.
package ufw

import (
	"fmt"
	"os/exec"
	"strings"
)

// Allow opens UFW rules for the given "port/proto" strings (e.g. "28015/udp").
// Runs: ufw allow <rule>
func Allow(rules []string) {
	for _, rule := range rules {
		cmd := exec.Command("ufw", "allow", rule)
		_ = cmd.Run() // best-effort
	}
}

// Remove closes UFW rules for the given "port/proto" strings.
// Runs: ufw delete allow <rule>
func Remove(rules []string) {
	for _, rule := range rules {
		cmd := exec.Command("ufw", "delete", "allow", rule)
		_ = cmd.Run() // best-effort
	}
}

// ParseDockerBindings extracts "host_port/proto" UFW rule strings from Docker-style
// port binding specs (e.g. "0.0.0.0:28015:28015/udp" → "28015/udp").
// The sentinel value "host" (host networking) is skipped.
func ParseDockerBindings(bindings []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, b := range bindings {
		if b == "host" {
			continue
		}
		rule := parseRule(b)
		if rule == "" {
			continue
		}
		if _, ok := seen[rule]; !ok {
			seen[rule] = struct{}{}
			out = append(out, rule)
		}
	}
	return out
}

// parseRule converts a single Docker port spec into "port/proto".
// Supported formats:
//   - "port/proto"                             → "port/proto"
//   - "host_port:container_port/proto"         → "host_port/proto"
//   - "host_ip:host_port:container_port/proto" → "host_port/proto"
func parseRule(spec string) string {
	proto := "tcp"
	if idx := strings.LastIndex(spec, "/"); idx != -1 {
		proto = spec[idx+1:]
		spec = spec[:idx]
	}
	parts := strings.Split(spec, ":")
	var hostPort string
	switch len(parts) {
	case 1:
		hostPort = parts[0]
	case 2:
		hostPort = parts[0]
	case 3:
		hostPort = parts[1]
	default:
		return ""
	}
	if hostPort == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s", hostPort, proto)
}
