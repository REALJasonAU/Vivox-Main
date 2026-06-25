//go:build linux

package system

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

func detectRAMMB() int64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	kb := parseMemTotalKB(data)
	if kb <= 0 {
		return 0
	}
	return kb / 1024
}

func detectDiskGB() int64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	totalBytes := uint64(stat.Blocks) * uint64(stat.Bsize)
	return int64(totalBytes / (1024 * 1024 * 1024))
}

// parseMemTotalKB extracts MemTotal from /proc/meminfo content (kB).
func parseMemTotalKB(data []byte) int64 {
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kb
	}
	return 0
}
