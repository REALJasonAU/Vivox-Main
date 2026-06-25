package grpc

import (
	"testing"

	"github.com/nexus-control/packages/domain"
)

func TestMergeNodeCapacity(t *testing.T) {
	t.Parallel()
	existing := domain.NodeCapacity{CPUCores: 8, RAMMb: 16384, DiskGb: 500}
	incoming := domain.NodeCapacity{CPUCores: 16, RAMMb: 0, DiskGb: 1000}
	got := mergeNodeCapacity(existing, incoming)
	if got.CPUCores != 16 || got.RAMMb != 16384 || got.DiskGb != 1000 {
		t.Fatalf("mergeNodeCapacity() = %+v, want cpu=16 ram=16384 disk=1000", got)
	}
}

func TestMergeNodeCapacity_allIncoming(t *testing.T) {
	t.Parallel()
	existing := domain.NodeCapacity{CPUCores: 4}
	incoming := domain.NodeCapacity{CPUCores: 8, RAMMb: 8192, DiskGb: 256}
	got := mergeNodeCapacity(existing, incoming)
	if got.CPUCores != 8 || got.RAMMb != 8192 || got.DiskGb != 256 {
		t.Fatalf("mergeNodeCapacity() = %+v", got)
	}
}
