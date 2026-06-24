package grpc

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Dev mTLS material filenames written into the cert dir.
const (
	caCertFile     = "ca.crt"
	caKeyFile      = "ca.key"
	serverCertFile = "server.crt"
	serverKeyFile  = "server.key"
	clientCertFile = "client.crt"
	clientKeyFile  = "client.key"
)

// LoadServerTLSConfig builds a mutual-TLS config for the gRPC server: it
// presents the server cert and requires + verifies a client cert signed by the
// dev CA. This enforces the zero-trust edge contract — only agents holding a
// CA-issued client certificate may open a stream.
func LoadServerTLSConfig(certDir string) (*tls.Config, error) {
	serverCert, err := tls.LoadX509KeyPair(filepath.Join(certDir, serverCertFile), filepath.Join(certDir, serverKeyFile))
	if err != nil {
		return nil, fmt.Errorf("load server keypair: %w", err)
	}
	caPEM, err := os.ReadFile(filepath.Join(certDir, caCertFile))
	if err != nil {
		return nil, fmt.Errorf("read ca cert: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("parse ca cert")
	}
	return &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS13,
	}, nil
}

// EnsureDevCerts generates a self-signed dev CA plus server and client
// (agent) certificates into certDir if they are not already present. The agent
// uses client.crt/client.key + ca.crt to dial out. Never use these in prod.
func EnsureDevCerts(certDir string) error {
	if _, err := os.Stat(filepath.Join(certDir, serverCertFile)); err == nil {
		return nil // already generated
	}
	if err := os.MkdirAll(certDir, 0o755); err != nil {
		return err
	}

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Nexus Control Dev CA", Organization: []string{"Nexus Control"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		return err
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return err
	}
	if err := writeCertPEM(filepath.Join(certDir, caCertFile), caDER); err != nil {
		return err
	}
	if err := writeKeyPEM(filepath.Join(certDir, caKeyFile), caKey); err != nil {
		return err
	}

	// Server certificate (control plane), valid for localhost dev names.
	if err := issueLeaf(certDir, serverCertFile, serverKeyFile, caCert, caKey, "nexus-api", 2,
		[]string{"localhost", "nexus-api"}, []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}, x509.ExtKeyUsageServerAuth); err != nil {
		return err
	}
	// Client certificate (edge agent).
	if err := issueLeaf(certDir, clientCertFile, clientKeyFile, caCert, caKey, "nexus-agent", 3,
		nil, nil, x509.ExtKeyUsageClientAuth); err != nil {
		return err
	}
	return nil
}

func issueLeaf(dir, certFile, keyFile string, caCert *x509.Certificate, caKey *ecdsa.PrivateKey, cn string, serial int64, dns []string, ips []net.IP, eku x509.ExtKeyUsage) error {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: cn, Organization: []string{"Nexus Control"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(5, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{eku},
		DNSNames:     dns,
		IPAddresses:  ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &key.PublicKey, caKey)
	if err != nil {
		return err
	}
	if err := writeCertPEM(filepath.Join(dir, certFile), der); err != nil {
		return err
	}
	return writeKeyPEM(filepath.Join(dir, keyFile), key)
}

func writeCertPEM(path string, der []byte) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644)
}

func writeKeyPEM(path string, key *ecdsa.PrivateKey) error {
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), 0o600)
}
