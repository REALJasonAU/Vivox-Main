package system

import (
	"runtime"

	gen "github.com/nexus-control/packages/proto/gen"
)

// Version is the agent release version reported to the control plane.
const Version = "0.1.0"

// CollectInfo gathers host capacity for heartbeats.
func CollectInfo() *gen.SystemInfo {
	return &gen.SystemInfo{
		CpuCores:     int64(runtime.NumCPU()),
		RamMb:        detectRAMMB(),
		DiskGb:       detectDiskGB(),
		Os:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		AgentVersion: Version,
	}
}
