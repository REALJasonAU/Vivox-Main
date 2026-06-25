//go:build !linux

package system

func detectRAMMB() int64 { return 0 }

func detectDiskGB() int64 { return 0 }
