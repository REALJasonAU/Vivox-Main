package health

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Result is the outcome of a single HTTP health probe.
type Result struct {
	ServiceID   string
	Healthy     bool
	StatusCode  int
	LatencyMs   int64
	Error       string
	IntervalSec int32
}

// Checker polls an HTTP endpoint inside a container network namespace.
type Checker struct {
	serviceID   string
	containerIP string
	path        string
	port        int
	interval    time.Duration
	timeout     time.Duration
	intervalSec int32
	notify      func(Result)
}

// NewChecker builds a health poller for one service container.
func NewChecker(serviceID, containerIP, path string, port int, interval, timeout time.Duration, intervalSec int32, notify func(Result)) *Checker {
	return &Checker{
		serviceID:   serviceID,
		containerIP: containerIP,
		path:        path,
		port:        port,
		interval:    interval,
		timeout:     timeout,
		intervalSec: intervalSec,
		notify:      notify,
	}
}

// Run probes on a ticker until ctx is cancelled.
func (c *Checker) Run(ctx context.Context) {
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	c.check()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.check()
		}
	}
}

func (c *Checker) check() {
	url := fmt.Sprintf("http://%s:%d%s", c.containerIP, c.port, c.path)
	client := &http.Client{Timeout: c.timeout}
	start := time.Now()
	resp, err := client.Get(url)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		c.notify(Result{
			ServiceID:   c.serviceID,
			Healthy:     false,
			LatencyMs:   latency,
			Error:       err.Error(),
			IntervalSec: c.intervalSec,
		})
		return
	}
	defer resp.Body.Close()
	healthy := resp.StatusCode >= 200 && resp.StatusCode < 400
	c.notify(Result{
		ServiceID:   c.serviceID,
		Healthy:     healthy,
		StatusCode:  resp.StatusCode,
		LatencyMs:   latency,
		IntervalSec: c.intervalSec,
	})
}
