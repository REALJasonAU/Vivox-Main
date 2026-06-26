package client

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// dial constructs a gRPC client connection to the control plane.
//
// Transport security is mTLS by default: the agent presents its client
// certificate and verifies the control plane against the provided CA bundle.
// This satisfies the zero-trust edge requirement — the agent only ever dials
// OUT over an authenticated, encrypted channel and exposes no inbound ports.
//
// The agent token is attached as per-RPC metadata so the control plane can
// authorize the stream independently of the TLS client cert.
//
// grpc.NewClient is used (non-blocking); the actual TCP/TLS handshake happens
// lazily when ConnectStream opens the stream, which is exactly where the
// reconnect loop wants to observe failures.
func dial(cfg Config) (*grpc.ClientConn, error) {
	var transport credentials.TransportCredentials
	if cfg.Insecure {
		transport = insecure.NewCredentials()
	} else {
		tlsCfg, err := loadClientTLS(cfg)
		if err != nil {
			return nil, err
		}
		transport = credentials.NewTLS(tlsCfg)
	}

	// Allow up to 512 MiB for backup file transfers over gRPC.
	const maxMsgSize = 512 * 1024 * 1024

	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(transport),
		grpc.WithPerRPCCredentials(tokenAuth{
			token:   cfg.Token,
			agentID: cfg.AgentID,
			secure:  !cfg.Insecure,
		}),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallSendMsgSize(maxMsgSize),
			grpc.MaxCallRecvMsgSize(maxMsgSize),
		),
	}

	conn, err := grpc.NewClient(cfg.Address, opts...)
	if err != nil {
		return nil, fmt.Errorf("dial control plane %q: %w", cfg.Address, err)
	}
	return conn, nil
}

// loadClientTLS builds the mTLS config from the configured cert/key/CA files.
func loadClientTLS(cfg Config) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load client keypair: %w", err)
	}

	caPEM, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read CA bundle: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("CA bundle %q contained no valid certificates", cfg.CAFile)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
		ServerName:   cfg.ServerName,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// tokenAuth implements credentials.PerRPCCredentials, attaching the agent token
// and id to every RPC as gRPC metadata.
type tokenAuth struct {
	token   string
	agentID string
	secure  bool
}

func (t tokenAuth) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	// The control plane authenticates the stream by hashing the token it reads
	// from the "x-agent-token" metadata key (see internal/grpc.MetadataTokenKey).
	// It must match exactly, so this is the authoritative key.
	return map[string]string{
		"x-agent-token": t.token,
		"x-agent-id":    t.agentID,
	}, nil
}

// RequireTransportSecurity reports whether the credentials require a secure
// channel. In dev/-mock (insecure) mode we allow the token over plaintext.
func (t tokenAuth) RequireTransportSecurity() bool { return t.secure }
