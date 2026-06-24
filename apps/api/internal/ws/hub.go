// Package ws implements the browser-facing realtime hub: a single multiplexed
// WebSocket per dashboard session. Clients send {event:"subscribe", topic} and
// receive {topic, payload}. Each subscribed topic maps to a Redis Stream that a
// blocking XREAD reader fans out to the connection (plan section 7).
package ws

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/redis/go-redis/v9"
	"log/slog"
)

// Redis Stream key prefixes (must match internal/grpc ingestion).
const (
	consoleStreamPrefix  = "console:"
	metricsStreamPrefix  = "metrics:"
	statusStreamPrefix   = "status:"
	nodeStatusPrefix     = "nodestatus:"
	healthStreamPrefix   = "health:"
	alertStreamPrefix    = "alert:"
	terminalStreamPrefix = "terminal:"
	readBlock            = 5 * time.Second
	readCount            = 200
	outBuffer            = 256
)

// TerminalBridge dispatches interactive terminal I/O to the agent.
type TerminalBridge interface {
	StartTerminal(ctx context.Context, serviceID, sessionID string, cols, rows int32) error
	SendTerminalInput(ctx context.Context, serviceID, sessionID string, data []byte) error
	ResizeTerminal(ctx context.Context, serviceID, sessionID string, cols, rows int32) error
	StopTerminal(ctx context.Context, serviceID, sessionID string)
}

// inFrame is a client -> server control frame.
type inFrame struct {
	Event     string `json:"event"` // subscribe | unsubscribe | terminal_input | terminal_resize
	Topic     string `json:"topic"`
	SessionID string `json:"session_id,omitempty"`
	Data      string `json:"data,omitempty"` // base64 stdin
	Cols      int32  `json:"cols,omitempty"`
	Rows      int32  `json:"rows,omitempty"`
}

// outFrame is a server -> client data frame.
type outFrame struct {
	Topic   string `json:"topic"`
	Payload any    `json:"payload"`
}

// Hub serves multiplexed WebSocket connections backed by Redis Streams.
type Hub struct {
	rdb     *redis.Client
	log     *slog.Logger
	bridge  TerminalBridge
	termMu  sync.Mutex
	terminals map[string]chan []byte
}

// NewHub builds the realtime hub.
func NewHub(rdb *redis.Client, log *slog.Logger, bridge TerminalBridge) *Hub {
	return &Hub{
		rdb:       rdb,
		log:       log,
		bridge:    bridge,
		terminals: make(map[string]chan []byte),
	}
}

// RegisterTerminal creates a stdin channel for a terminal session.
func (h *Hub) RegisterTerminal(sessionID string) (<-chan []byte, func()) {
	ch := make(chan []byte, 32)
	h.termMu.Lock()
	h.terminals[sessionID] = ch
	h.termMu.Unlock()
	cancel := func() {
		h.termMu.Lock()
		delete(h.terminals, sessionID)
		h.termMu.Unlock()
	}
	return ch, cancel
}

// Serve handles one WebSocket connection for its full lifetime. It owns a single
// writer goroutine (gorilla/fasthttp websockets are not safe for concurrent
// writes) and one reader goroutine per subscribed topic.
func (h *Hub) Serve(c *websocket.Conn) {
	connCtx, cancelAll := context.WithCancel(context.Background())
	defer cancelAll()

	out := make(chan outFrame, outBuffer)
	var subsMu sync.Mutex
	subs := make(map[string]context.CancelFunc)
	termServices := make(map[string]string) // sessionID -> serviceID

	// Writer goroutine: the single owner of c.WriteJSON/WriteMessage.
	// Sends a ping every 30s so reverse proxies (Pangolin/Traefik/nginx) don't
	// close idle WebSocket connections due to their read-idle timeout.
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()

	// Reset read deadline on every pong (browsers respond to pings automatically).
	// If no pong arrives within 90s the read loop exits and the connection is torn down.
	c.SetPongHandler(func(string) error {
		_ = c.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	_ = c.SetReadDeadline(time.Now().Add(90 * time.Second))

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case <-connCtx.Done():
				return
			case frame := <-out:
				if err := c.WriteJSON(frame); err != nil {
					cancelAll()
					return
				}
			case <-pingTicker.C:
				if err := c.WriteMessage(websocket.PingMessage, nil); err != nil {
					cancelAll()
					return
				}
			}
		}
	}()

	// Read loop: process subscribe/unsubscribe frames until the client leaves.
	for {
		_ = c.SetReadDeadline(time.Now().Add(90 * time.Second))
		_, data, err := c.ReadMessage()
		if err != nil {
			break
		}
		var f inFrame
		if err := json.Unmarshal(data, &f); err != nil {
			continue
		}
		switch f.Event {
		case "subscribe":
			streamKey, serviceID, sessionID, ok := streamKeyForTopic(f.Topic)
			if !ok {
				continue
			}
			subsMu.Lock()
			if _, exists := subs[f.Topic]; !exists {
				topicCtx, cancel := context.WithCancel(connCtx)
				subs[f.Topic] = cancel
				go h.readStream(topicCtx, f.Topic, streamKey, out)
				if sessionID != "" && h.bridge != nil {
					termServices[sessionID] = serviceID
					if err := h.bridge.StartTerminal(topicCtx, serviceID, sessionID, 80, 24); err != nil {
						h.log.Warn("terminal start failed", "service", serviceID, "session", sessionID, "err", err)
					}
				}
			}
			subsMu.Unlock()
		case "unsubscribe":
			subsMu.Lock()
			if cancel, exists := subs[f.Topic]; exists {
				cancel()
				delete(subs, f.Topic)
			}
			if _, serviceID, sessionID, ok := streamKeyForTopic(f.Topic); ok && sessionID != "" {
				delete(termServices, sessionID)
				if h.bridge != nil {
					h.bridge.StopTerminal(connCtx, serviceID, sessionID)
				}
			}
			subsMu.Unlock()
		case "terminal_input":
			if f.SessionID == "" || h.bridge == nil {
				continue
			}
			raw, err := base64.StdEncoding.DecodeString(f.Data)
			if err != nil {
				continue
			}
			h.termMu.Lock()
			ch, inMap := h.terminals[f.SessionID]
			h.termMu.Unlock()
			if inMap {
				select {
				case ch <- raw:
				default:
				}
			}
			serviceID := termServices[f.SessionID]
			if serviceID != "" {
				if err := h.bridge.SendTerminalInput(connCtx, serviceID, f.SessionID, raw); err != nil {
					h.log.Warn("terminal input failed", "session", f.SessionID, "err", err)
				}
			}
		case "terminal_resize":
			if f.SessionID == "" || h.bridge == nil {
				continue
			}
			serviceID := termServices[f.SessionID]
			if serviceID != "" {
				if err := h.bridge.ResizeTerminal(connCtx, serviceID, f.SessionID, f.Cols, f.Rows); err != nil {
					h.log.Warn("terminal resize failed", "session", f.SessionID, "err", err)
				}
			}
		}
	}

	cancelAll()
	<-writerDone
	_ = c.Close()
}

// readStream tails a Redis Stream from the moment of subscription and forwards
// each entry as a {topic, payload} frame.
func (h *Hub) readStream(ctx context.Context, topic, streamKey string, out chan<- outFrame) {
	lastID := "$" // only new entries from subscription time onward
	for {
		if ctx.Err() != nil {
			return
		}
		res, err := h.rdb.XRead(ctx, &redis.XReadArgs{
			Streams: []string{streamKey, lastID},
			Block:   readBlock,
			Count:   readCount,
		}).Result()
		if err != nil {
			if err == redis.Nil || ctx.Err() != nil {
				continue
			}
			// Transient Redis error: brief backoff, then retry.
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		for _, stream := range res {
			for _, msg := range stream.Messages {
				lastID = msg.ID
				frame := outFrame{Topic: topic, Payload: buildPayload(topic, msg.Values)}
				select {
				case out <- frame:
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

// streamKeyForTopic maps a dashboard topic to its backing Redis Stream key.
func streamKeyForTopic(topic string) (streamKey, serviceID, sessionID string, ok bool) {
	parts := strings.Split(topic, ":")
	if len(parts) >= 3 && parts[0] == "node" && parts[2] == "status" {
		id := parts[1]
		if id == "" {
			return "", "", "", false
		}
		return nodeStatusPrefix + id, "", "", true
	}
	if len(parts) < 3 || parts[0] != "service" {
		return "", "", "", false
	}
	id := parts[1]
	if id == "" {
		return "", "", "", false
	}
	if len(parts) == 4 && parts[2] == "terminal" {
		return terminalStreamPrefix + id + ":" + parts[3], id, parts[3], true
	}
	if len(parts) != 3 {
		return "", "", "", false
	}
	switch parts[2] {
	case "console":
		return consoleStreamPrefix + id, id, "", true
	case "metrics":
		return metricsStreamPrefix + id, id, "", true
	case "status":
		return statusStreamPrefix + id, id, "", true
	case "health":
		return healthStreamPrefix + id, id, "", true
	case "alert":
		return alertStreamPrefix + id, id, "", true
	default:
		return "", "", "", false
	}
}

// buildPayload shapes a raw Redis Stream entry into the documented frame body.
func buildPayload(topic string, v map[string]interface{}) map[string]any {
	out := map[string]any{"timestamp": asInt(v["ts"])}
	if strings.Contains(topic, ":terminal:") {
		out["data"] = asString(v["data"])
		if closed, ok := v["closed"]; ok {
			out["closed"] = closed == "1" || closed == true
		}
		return out
	}
	if strings.HasSuffix(topic, ":console") {
		out["stream"] = asString(v["stream"])
		out["text"] = asString(v["text"])
		return out
	}
	if strings.HasSuffix(topic, ":status") {
		out["status"] = asString(v["status"])
		if strings.HasPrefix(topic, "node:") {
			if n := asInt(v["cpu_cores"]); n > 0 {
				out["cpu_cores"] = n
			}
			if n := asInt(v["ram_mb"]); n > 0 {
				out["ram_mb"] = n
			}
			if n := asInt(v["disk_gb"]); n > 0 {
				out["disk_gb"] = n
			}
		}
		return out
	}
	if strings.HasSuffix(topic, ":health") {
		out["healthy"] = asString(v["healthy"]) == "1" || asString(v["healthy"]) == "true"
		out["status_code"] = asInt(v["status_code"])
		out["latency_ms"] = asInt(v["latency_ms"])
		out["error"] = asString(v["error"])
		return out
	}
	if strings.HasSuffix(topic, ":alert") {
		out["metric"] = asString(v["metric"])
		out["value"] = asFloat(v["value"])
		out["threshold"] = asInt(v["threshold"])
		out["operator"] = asString(v["operator"])
		return out
	}
	// metrics
	out["cpu_usage_percent"] = asFloat(v["cpu"])
	out["memory_bytes_used"] = asInt(v["mem"])
	out["disk_bytes_used"] = asInt(v["disk"])
	return out
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func asInt(v interface{}) int64 {
	if s, ok := v.(string); ok {
		n, _ := strconv.ParseInt(s, 10, 64)
		return n
	}
	return 0
}

func asFloat(v interface{}) float64 {
	if s, ok := v.(string); ok {
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
	return 0
}
