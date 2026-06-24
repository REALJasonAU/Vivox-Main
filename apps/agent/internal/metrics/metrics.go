// Package metrics samples container resource usage and reports it upstream as
// MetricSnapshot frames. Like exec, it is decoupled from the Docker SDK: the
// docker package supplies a StatsOpener closure that yields a fresh stats
// reader, and metrics owns the polling cadence and the CPU/memory math.
package metrics

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

// MetricSink receives a computed snapshot. *client.Sender satisfies it.
type MetricSink interface {
	SendMetric(serviceID string, cpuPercent float64, memBytes uint64) error
}

// StatsOpener returns a one-shot container stats stream (Docker's
// ContainerStats with stream=false). The caller closes the returned reader.
type StatsOpener func(ctx context.Context) (io.ReadCloser, error)

// Poll samples stats every interval and forwards a snapshot until ctx is
// cancelled. Individual sampling errors are non-fatal (the container may be
// briefly unavailable around start/stop); they skip a tick rather than abort.
func Poll(ctx context.Context, serviceID string, interval time.Duration, open StatsOpener, sink MetricSink) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cpu, mem, ok := sample(ctx, open)
			if !ok {
				continue
			}
			_ = sink.SendMetric(serviceID, cpu, mem)
		}
	}
}

// sample reads one stats document and computes CPU percent + memory bytes.
func sample(ctx context.Context, open StatsOpener) (cpuPercent float64, memBytes uint64, ok bool) {
	r, err := open(ctx)
	if err != nil {
		return 0, 0, false
	}
	defer r.Close()

	var s statsJSON
	if err := json.NewDecoder(r).Decode(&s); err != nil {
		return 0, 0, false
	}
	return calcCPUPercent(s), calcMemoryBytes(s), true
}

// calcCPUPercent applies Docker's standard CPU-percentage formula:
// (containerDelta / systemDelta) * onlineCPUs * 100.
func calcCPUPercent(s statsJSON) float64 {
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	if cpuDelta <= 0 || sysDelta <= 0 {
		return 0
	}
	cpus := float64(s.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpus == 0 {
		cpus = 1
	}
	return (cpuDelta / sysDelta) * cpus * 100.0
}

// calcMemoryBytes returns working-set memory: usage minus reclaimable page
// cache (cgroup v1 "cache" or v2 "inactive_file"), matching `docker stats`.
func calcMemoryBytes(s statsJSON) uint64 {
	usage := s.MemoryStats.Usage
	var cache uint64
	if v, ok := s.MemoryStats.Stats["cache"]; ok {
		cache = v
	} else if v, ok := s.MemoryStats.Stats["inactive_file"]; ok {
		cache = v
	}
	if cache > usage {
		return usage
	}
	return usage - cache
}

// statsJSON is the subset of Docker's container stats document we consume. It is
// decoded directly from the stats stream so the metrics package stays
// independent of Docker SDK type renames across versions.
type statsJSON struct {
	CPUStats    cpuStats `json:"cpu_stats"`
	PreCPUStats cpuStats `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64            `json:"usage"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
}

type cpuStats struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PercpuUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	SystemUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs  uint32 `json:"online_cpus"`
}
