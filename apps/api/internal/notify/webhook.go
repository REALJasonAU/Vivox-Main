package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Event is the JSON payload POSTed to user-configured webhook URLs.
type Event struct {
	Event       string      `json:"event"`
	ServiceID   string      `json:"service_id"`
	ServiceName string      `json:"service_name"`
	Timestamp   int64       `json:"timestamp"`
	Meta        interface{} `json:"meta,omitempty"`
}

// Dispatcher delivers webhook events over HTTP.
type Dispatcher struct {
	client *http.Client
}

// NewDispatcher builds a webhook HTTP client.
func NewDispatcher() *Dispatcher {
	return &Dispatcher{client: &http.Client{Timeout: 10 * time.Second}}
}

// Fire POSTs event to url, optionally signing the body with secret.
func (d *Dispatcher) Fire(ctx context.Context, url, secret string, event Event) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Vivox-Webhook/1.0")
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-Vivox-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}
