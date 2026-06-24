package caddy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Client talks to the Caddy admin API.
type Client struct {
	adminURL string
	http     *http.Client
}

// NewClient creates a Caddy admin API client.
func NewClient(adminURL string) *Client {
	return &Client{adminURL: adminURL, http: &http.Client{}}
}

// Route describes a single HTTP route in Caddy's JSON config.
type Route struct {
	Match  []Match  `json:"match"`
	Handle []Handle `json:"handle"`
}

// Match matches requests by host header.
type Match struct {
	Host []string `json:"host"`
}

// Handle is a Caddy handler block.
type Handle struct {
	Handler   string `json:"handler"`
	Upstreams []struct {
		Dial string `json:"dial"`
	} `json:"upstreams,omitempty"`
}

// AddDomain registers a reverse_proxy route for domain → upstream (host:port).
func (c *Client) AddDomain(ctx context.Context, routeID, domain, upstream string) error {
	route := Route{
		Match: []Match{{Host: []string{domain}}},
		Handle: []Handle{{
			Handler: "reverse_proxy",
			Upstreams: []struct {
				Dial string `json:"dial"`
			}{{Dial: upstream}},
		}},
	}
	body, err := json.Marshal(route)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		c.adminURL+"/config/apps/http/servers/srv0/routes/"+routeID,
		bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("caddy error %d", resp.StatusCode)
	}
	return nil
}

// RemoveDomain deletes a route from Caddy.
func (c *Client) RemoveDomain(ctx context.Context, routeID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		c.adminURL+"/config/apps/http/servers/srv0/routes/"+routeID, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode != 404 {
		return fmt.Errorf("caddy error %d", resp.StatusCode)
	}
	return nil
}
