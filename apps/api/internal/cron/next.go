package cron

import (
	"strconv"
	"strings"
	"time"
)

// Next returns the next time at or after from that matches the 5-field cron expression.
// Supports *, */n, and single integer values per field.
func Next(expr string, from time.Time) time.Time {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return time.Time{}
	}
	start := from.Truncate(time.Minute).Add(time.Minute)
	limit := start.AddDate(4, 0, 0)
	for t := start; t.Before(limit); t = t.Add(time.Minute) {
		if matches(fields, t) {
			return t
		}
	}
	return time.Time{}
}

func matches(fields []string, t time.Time) bool {
	return fieldMatch(t.Minute(), fields[0], 0, 59) &&
		fieldMatch(t.Hour(), fields[1], 0, 23) &&
		fieldMatch(t.Day(), fields[2], 1, 31) &&
		fieldMatch(int(t.Month()), fields[3], 1, 12) &&
		fieldMatch(int(t.Weekday()), fields[4], 0, 6)
}

func fieldMatch(val int, field string, min, max int) bool {
	field = strings.TrimSpace(field)
	if field == "*" {
		return true
	}
	if strings.HasPrefix(field, "*/") {
		step, err := strconv.Atoi(field[2:])
		if err != nil || step <= 0 {
			return false
		}
		return val%step == 0
	}
	n, err := strconv.Atoi(field)
	if err != nil {
		return false
	}
	return n >= min && n <= max && n == val
}
