package scheduler

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/db"
	"github.com/nexus-control/packages/domain"
)

// OnlineChecker reports whether a node currently has an active agent stream.
type OnlineChecker interface {
	Online(nodeID string) bool
}

// Scheduler picks the best node for a new service.
type Scheduler struct {
	q       *db.Queries
	online  OnlineChecker
}

// New builds a scheduler.
func New(q *db.Queries, online OnlineChecker) *Scheduler {
	return &Scheduler{q: q, online: online}
}

// SelectInput describes scheduling requirements.
type SelectInput struct {
	Region string
	Limits domain.ResourceLimits
}

// Select returns the best node id for a new service, or an invalid UUID if none
// qualify. Preference order:
//  1. Online nodes in the requested region with enough free capacity
//  2. Any online node with enough capacity
//  3. Any registered node in region (offline — deploy may fail until agent connects)
//  4. First registered node
func (s *Scheduler) Select(ctx context.Context, in SelectInput) (pgtype.UUID, error) {
	nodes, err := s.q.ListNodes(ctx)
	if err != nil {
		return pgtype.UUID{}, err
	}
	if len(nodes) == 0 {
		return pgtype.UUID{}, nil
	}

	loads, err := s.q.NodeServiceLoads(ctx)
	if err != nil {
		return pgtype.UUID{}, err
	}
	loadByNode := make(map[string]db.NodeServiceLoadsRow, len(loads))
	for _, row := range loads {
		loadByNode[uuidStr(row.NodeID)] = row
	}

	var (
		best       pgtype.UUID
		bestScore  = -1.0
		fallback   pgtype.UUID
		fallbackOn bool
	)

	for _, n := range nodes {
		id := uuidStr(n.ID)
		if in.Region != "" && n.Region != in.Region {
			continue
		}
		if !fallback.Valid {
			fallback = n.ID
		}
		if s.online != nil && s.online.Online(id) && !fallbackOn {
			fallback = n.ID
			fallbackOn = true
		}

		load := loadByNode[id]
		if !fits(n.Capacity, load, in.Limits) {
			continue
		}

		online := s.online != nil && s.online.Online(id)
		score := scoreNode(n.Capacity, load, in.Limits, online, n.Region == in.Region)
		if score > bestScore {
			bestScore = score
			best = n.ID
		}
	}

	if best.Valid {
		return best, nil
	}

	// Relax region: try all nodes with capacity.
	if in.Region != "" {
		relaxed := in
		relaxed.Region = ""
		return s.Select(ctx, relaxed)
	}

	// Prefer any online node even if over capacity (deploy may fail at runtime).
	for _, n := range nodes {
		if s.online != nil && s.online.Online(uuidStr(n.ID)) {
			return n.ID, nil
		}
	}

	return fallback, nil
}

func fits(cap domain.NodeCapacity, load db.NodeServiceLoadsRow, req domain.ResourceLimits) bool {
	usedRAM := load.TotalMemoryMb
	usedCPU := load.ServiceCount * 1024 // rough share units
	if cap.RAMMb > 0 && usedRAM+req.MemoryMB > cap.RAMMb {
		return false
	}
	if cap.CPUCores > 0 && int64(usedCPU)+req.CPUShares > cap.CPUCores*1024 {
		return false
	}
	_ = load.ServiceCount
	return true
}

func scoreNode(cap domain.NodeCapacity, load db.NodeServiceLoadsRow, req domain.ResourceLimits, online, regionMatch bool) float64 {
	score := 0.0
	if online {
		score += 1000
	}
	if regionMatch {
		score += 100
	}
	ramFree := float64(cap.RAMMb - load.TotalMemoryMb - req.MemoryMB)
	if ramFree < 0 {
		ramFree = 0
	}
	score += ramFree
	score -= float64(load.ServiceCount) * 10
	return score
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	const hexd = "0123456789abcdef"
	buf := make([]byte, 36)
	j := 0
	for i := 0; i < 16; i++ {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			buf[j] = '-'
			j++
		}
		buf[j] = hexd[u.Bytes[i]>>4]
		buf[j+1] = hexd[u.Bytes[i]&0x0f]
		j += 2
	}
	return string(buf)
}
