//go:build linux

package system

import "testing"

func TestParseMemTotalKB(t *testing.T) {
	t.Parallel()
	sample := `MemTotal:       16384000 kB
MemFree:         8192000 kB
MemAvailable:   12288000 kB
`
	got := parseMemTotalKB([]byte(sample))
	if got != 16384000 {
		t.Fatalf("parseMemTotalKB() = %d, want 16384000", got)
	}
}

func TestParseMemTotalKB_missing(t *testing.T) {
	t.Parallel()
	if got := parseMemTotalKB([]byte("MemFree: 100 kB\n")); got != 0 {
		t.Fatalf("parseMemTotalKB() = %d, want 0", got)
	}
}

func TestDetectRAMMB_fromSample(t *testing.T) {
	t.Parallel()
	kb := parseMemTotalKB([]byte("MemTotal:       8192000 kB\n"))
	wantMB := kb / 1024
	if wantMB != 8000 {
		t.Fatalf("expected 8000 MB, got %d", wantMB)
	}
}
