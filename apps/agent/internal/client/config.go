package client

import "time"

// Config holds everything the agent needs to establish and maintain its single
// long-lived gRPC stream to the control plane. Values are populated from flags
// and environment variables in cmd/agent.
type Config struct {
	// Address is the control-plane gRPC endpoint, e.g. "control.nexus.internal:443".
	Address string
	// AgentID identifies this node to the control plane. It is stamped on every
	// UpstreamEnvelope and sent as request metadata.
	AgentID string
	// Token is the bearer agent token used for authentication. Sent as per-RPC
	// metadata ("authorization: Bearer <token>").
	Token string

	// mTLS material. Required unless Insecure is true.
	CertFile   string // client certificate (PEM)
	KeyFile    string // client private key (PEM)
	CAFile     string // CA bundle used to verify the control plane (PEM)
	ServerName string // overrides the SNI / cert name; optional

	// Insecure disables mTLS entirely. Intended only for local dev / -mock runs
	// against a plaintext gRPC server.
	Insecure bool

	// HeartbeatInterval is how often a Heartbeat UpstreamEnvelope is emitted.
	HeartbeatInterval time.Duration
	// MetricsInterval is how often container stats are sampled and reported.
	MetricsInterval time.Duration

	// HealthAddr is the listen address for the HTTP health server.
	HealthAddr string

	// Backoff bounds for the reconnect loop.
	MinBackoff time.Duration
	MaxBackoff time.Duration
}

// withDefaults returns a copy of cfg with zero-valued timing fields filled in.
func (c Config) withDefaults() Config {
	if c.HeartbeatInterval <= 0 {
		c.HeartbeatInterval = 5 * time.Second
	}
	if c.MetricsInterval <= 0 {
		c.MetricsInterval = 5 * time.Second
	}
	if c.MinBackoff <= 0 {
		c.MinBackoff = 1 * time.Second
	}
	if c.MaxBackoff <= 0 {
		c.MaxBackoff = 30 * time.Second
	}
	return c
}
