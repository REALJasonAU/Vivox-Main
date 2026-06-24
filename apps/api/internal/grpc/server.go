package grpc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nexus-control/apps/api/internal/commands"
	"github.com/nexus-control/apps/api/internal/db"
	filestrack "github.com/nexus-control/apps/api/internal/files"
	"github.com/nexus-control/apps/api/internal/notify"
	"github.com/nexus-control/apps/api/internal/realtime"
	"github.com/nexus-control/apps/api/internal/service"
	gen "github.com/nexus-control/packages/proto/gen"
	"github.com/nexus-control/packages/domain"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// MetadataTokenKey is the gRPC metadata key the agent uses to present its
// bearer token (in addition to the mTLS client certificate).
const MetadataTokenKey = "x-agent-token"

// Redis Streams key prefixes for ingested telemetry. The WSHub reads the same
// keys to fan telemetry out to browsers.
const (
	consoleStreamPrefix  = "console:"
	metricsStreamPrefix  = "metrics:"
	healthStreamPrefix   = "health:"
	terminalStreamPrefix = "terminal:"
	// streamMaxLen bounds each per-service stream so Redis memory stays flat;
	// the console is a live tail, not durable storage.
	streamMaxLen = 5000
)

// Server implements gen.AgentControllerServer. It authenticates each agent,
// registers its stream, ingests upstream telemetry into Redis, and pumps
// downstream commands from the Registry onto the stream.
type Server struct {
	gen.UnimplementedAgentControllerServer

	q         *db.Queries
	rdb       *redis.Client
	reg       *Registry
	tracker   *commands.Tracker
	files     *filestrack.Tracker
	outcome   CommandOutcomeHandler
	publisher *realtime.Publisher
	notify    *notify.NotifyService
	log       *slog.Logger
}

// CommandOutcomeHandler applies agent command acknowledgements.
type CommandOutcomeHandler interface {
	HandleCommandOutcome(ctx context.Context, pending commands.Pending, success bool, errMsg string)
}

// NewServer wires the gRPC AgentController implementation.
func NewServer(q *db.Queries, rdb *redis.Client, reg *Registry, tracker *commands.Tracker, files *filestrack.Tracker, outcome CommandOutcomeHandler, publisher *realtime.Publisher, notifySvc *notify.NotifyService, log *slog.Logger) *Server {
	return &Server{q: q, rdb: rdb, reg: reg, tracker: tracker, files: files, outcome: outcome, publisher: publisher, notify: notifySvc, log: log}
}

// ConnectStream is the single bidirectional RPC every agent holds open. Upstream
// frames carry telemetry + heartbeats; downstream frames carry start/stop tasks.
func (s *Server) ConnectStream(stream gen.AgentController_ConnectStreamServer) error {
	ctx := stream.Context()

	node, err := s.authenticate(ctx)
	if err != nil {
		return err
	}
	nodeID := uuidString(node.ID)

	// Peek the first frame for the agent id (carried on every UpstreamEnvelope).
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	agentID := first.GetAgentId()

	conn := s.reg.register(nodeID, agentID)
	defer s.reg.unregister(conn)
	s.markNode(ctx, node.ID, "online")
	s.log.Info("agent connected", "node_id", nodeID, "agent_id", agentID)

	defer func() {
		// Best-effort: mark offline on disconnect using a fresh context so the
		// update still runs after the stream context is cancelled.
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		s.markNode(c, node.ID, "offline")
		s.log.Info("agent disconnected", "node_id", nodeID, "agent_id", agentID)
	}()

	// Downstream pump: deliver Registry commands onto the stream.
	go s.sendLoop(stream, conn)

	// Process the frame we already received, then loop.
	if err := s.handleUpstream(ctx, node.ID, first); err != nil {
		s.log.Warn("upstream handle error", "err", err)
	}
	for {
		env, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := s.handleUpstream(ctx, node.ID, env); err != nil {
			s.log.Warn("upstream handle error", "err", err)
		}
	}
}

// sendLoop drains the agent's downstream queue onto the gRPC stream until the
// connection is replaced or the stream context is cancelled.
func (s *Server) sendLoop(stream gen.AgentController_ConnectStreamServer, conn *agentConn) {
	for {
		select {
		case <-stream.Context().Done():
			return
		case <-conn.done:
			return
		case env := <-conn.sendCh:
			if err := stream.Send(env); err != nil {
				s.log.Warn("downstream send failed", "node_id", conn.nodeID, "err", err)
				return
			}
		}
	}
}

// handleUpstream dispatches a single upstream envelope based on its payload.
func (s *Server) handleUpstream(ctx context.Context, nodeID pgtype.UUID, env *gen.UpstreamEnvelope) error {
	switch {
	case env.GetHeartbeat() != nil:
		return s.handleHeartbeat(ctx, nodeID, env.GetHeartbeat())
	case env.GetLogs() != nil:
		return s.ingestLog(ctx, env.GetLogs())
	case env.GetMetrics() != nil:
		return s.ingestMetric(ctx, env.GetMetrics())
	case env.GetResponse() != nil:
		r := env.GetResponse()
		if s.files != nil && s.files.TryResolveCommand(r.GetCommandId(), r.GetSuccess(), r.GetErrorMessage()) {
			return nil
		}
		if s.tracker != nil && s.outcome != nil {
			if pending, ok := s.tracker.Resolve(r.GetCommandId()); ok {
				s.outcome.HandleCommandOutcome(ctx, pending, r.GetSuccess(), r.GetErrorMessage())
			}
		}
		return nil
	case env.GetFileList() != nil:
		fl := env.GetFileList()
		if s.files != nil {
			s.files.Resolve(fl.GetCommandId(), filestrack.Result{
				Entries: fl.GetEntries(),
				Error:   fl.GetError(),
			})
		}
		return nil
	case env.GetFileRead() != nil:
		fr := env.GetFileRead()
		if s.files != nil {
			s.files.Resolve(fr.GetCommandId(), filestrack.Result{
				Content: fr.GetContent(),
				Error:   fr.GetError(),
			})
		}
		return nil
	case env.GetTerminalOutput() != nil:
		return s.ingestTerminalOutput(ctx, env.GetTerminalOutput())
	case env.GetHealthCheckResult() != nil:
		return s.ingestHealthCheck(ctx, env.GetHealthCheckResult())
	case env.GetBackupResult() != nil:
		return s.ingestBackupResult(ctx, env.GetBackupResult())
	default:
		return nil
	}
}

func (s *Server) handleHeartbeat(ctx context.Context, nodeID pgtype.UUID, hb *gen.Heartbeat) error {
	info := hb.GetSystemInfo()
	if info == nil {
		return nil
	}
	cap := domain.NodeCapacity{
		CPUCores: info.GetCpuCores(),
		RAMMb:    info.GetRamMb(),
		DiskGb:   info.GetDiskGb(),
	}
	if cap.CPUCores == 0 && cap.RAMMb == 0 && cap.DiskGb == 0 {
		return nil
	}
	if _, err := s.q.UpdateNodeCapacity(ctx, db.UpdateNodeCapacityParams{ID: nodeID, Capacity: cap}); err != nil {
		s.log.Warn("update node capacity failed", "node_id", uuidString(nodeID), "err", err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishNodeStatus(ctx, uuidString(nodeID), "online", cap.CPUCores, cap.RAMMb, cap.DiskGb)
	}
	return nil
}

// ingestLog appends a LogChunk to console:{service_id} and persists history.
func (s *Server) ingestLog(ctx context.Context, lc *gen.LogChunk) error {
	serviceID := lc.GetServiceId()
	if serviceID == "" {
		return nil
	}
	ts := float64(time.Now().Unix())
	text := string(lc.GetData())
	streamType := lc.GetStreamType()
	if streamType == "" {
		streamType = "stdout"
	}

	if err := s.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: consoleStreamPrefix + serviceID,
		MaxLen: streamMaxLen,
		Approx: true,
		Values: map[string]interface{}{
			"text":   text,
			"stream": streamType,
			"ts":     int64(ts),
		},
	}).Err(); err != nil {
		return err
	}

	logKey := "logs:hist:" + serviceID
	payload, _ := json.Marshal(map[string]interface{}{
		"t":    ts,
		"s":    streamType,
		"line": text,
	})
	score := float64(time.Now().UnixMilli())
	s.rdb.ZAdd(ctx, logKey, redis.Z{Score: score, Member: string(payload)})

	cutoff := float64(time.Now().Add(-24 * time.Hour).UnixMilli())
	_ = s.rdb.ZRemRangeByScore(ctx, logKey, "-inf", strconv.FormatFloat(cutoff, 'f', 0, 64))
	_ = s.rdb.ZRemRangeByRank(ctx, logKey, 0, -10001)
	_ = s.rdb.Expire(ctx, logKey, 25*time.Hour)
	return nil
}

// ingestMetric appends a MetricSnapshot to metrics:{service_id} and persists history.
func (s *Server) ingestMetric(ctx context.Context, m *gen.MetricSnapshot) error {
	if m.GetServiceId() == "" {
		return nil
	}
	if err := s.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: metricsStreamPrefix + m.GetServiceId(),
		MaxLen: streamMaxLen,
		Approx: true,
		Values: map[string]interface{}{
			"cpu":  m.GetCpuUsagePercent(),
			"mem":  m.GetMemoryBytesUsed(),
			"disk": m.GetDiskBytesUsed(),
			"ts":   time.Now().Unix(),
		},
	}).Err(); err != nil {
		return err
	}

	histKey := "metrics:hist:" + m.GetServiceId()
	score := float64(time.Now().UnixMilli())
	payload, _ := json.Marshal(map[string]interface{}{
		"cpu": m.GetCpuUsagePercent(),
		"mem": m.GetMemoryBytesUsed(),
	})
	if err := s.rdb.ZAdd(ctx, histKey, redis.Z{Score: score, Member: string(payload)}).Err(); err != nil {
		return err
	}
	cutoff := float64(time.Now().Add(-24 * time.Hour).UnixMilli())
	_ = s.rdb.ZRemRangeByScore(ctx, histKey, "-inf", strconv.FormatFloat(cutoff, 'f', 0, 64))
	_ = s.rdb.Expire(ctx, histKey, 25*time.Hour)

	go func() {
		evalCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.evaluateAlerts(evalCtx, m.GetServiceId(), m.GetCpuUsagePercent(), float64(m.GetMemoryBytesUsed()))
	}()
	return nil
}

func (s *Server) evaluateAlerts(ctx context.Context, serviceID string, cpu float64, memBytes float64) {
	svcUUID, err := service.ParseUUID(serviceID)
	if err != nil {
		return
	}

	rules, _ := s.q.ListActiveAlertRulesForMetric(ctx, svcUUID, db.AlertMetricCpu)
	for _, rule := range rules {
		val := cpu
		breached := (rule.Operator == db.AlertOperatorGt && val > float64(rule.Threshold)) ||
			(rule.Operator == db.AlertOperatorLt && val < float64(rule.Threshold))
		if !breached {
			continue
		}
		if rule.NotifiedAt.Valid && time.Since(rule.NotifiedAt.Time) < 5*time.Minute {
			continue
		}
		_ = s.q.TouchAlertNotified(ctx, rule.ID)
		if s.publisher != nil {
			_ = s.publisher.PublishAlert(ctx, serviceID, "cpu", val, int(rule.Threshold), string(rule.Operator))
		}
		s.fireAlertWebhook(ctx, svcUUID, map[string]interface{}{
			"metric": "cpu", "value": val, "threshold": rule.Threshold, "operator": rule.Operator,
		})
	}

	memMB := memBytes / (1024 * 1024)
	memRules, _ := s.q.ListActiveAlertRulesForMetric(ctx, svcUUID, db.AlertMetricMemory)
	for _, rule := range memRules {
		breached := (rule.Operator == db.AlertOperatorGt && memMB > float64(rule.Threshold)) ||
			(rule.Operator == db.AlertOperatorLt && memMB < float64(rule.Threshold))
		if !breached {
			continue
		}
		if rule.NotifiedAt.Valid && time.Since(rule.NotifiedAt.Time) < 5*time.Minute {
			continue
		}
		_ = s.q.TouchAlertNotified(ctx, rule.ID)
		if s.publisher != nil {
			_ = s.publisher.PublishAlert(ctx, serviceID, "memory", memMB, int(rule.Threshold), string(rule.Operator))
		}
		s.fireAlertWebhook(ctx, svcUUID, map[string]interface{}{
			"metric": "memory", "value": memMB, "threshold": rule.Threshold, "operator": rule.Operator,
		})
	}
}

func (s *Server) fireAlertWebhook(ctx context.Context, svcUUID pgtype.UUID, meta map[string]interface{}) {
	if s.notify == nil {
		return
	}
	svc, err := s.q.GetService(ctx, svcUUID)
	if err != nil {
		return
	}
	s.notify.FireStatusEvent(ctx, svc.OwnerID, uuidString(svc.ID), svc.Name, "alert", meta)
}

// ingestHealthCheck stores the latest probe result and fans it out over WS.
func (s *Server) ingestHealthCheck(ctx context.Context, r *gen.HealthCheckResult) error {
	if r == nil || r.GetServiceId() == "" {
		return nil
	}
	ttl := time.Duration(r.GetIntervalSec()+30) * time.Second
	if ttl < 60*time.Second {
		ttl = 90 * time.Second
	}
	val, _ := json.Marshal(map[string]interface{}{
		"healthy":     r.GetHealthy(),
		"status_code": r.GetStatusCode(),
		"latency_ms":  r.GetLatencyMs(),
		"error":       r.GetError(),
		"checked_at":  time.Now().Unix(),
	})
	key := "health:" + r.GetServiceId()
	if err := s.rdb.Set(ctx, key, val, ttl).Err(); err != nil {
		return err
	}
	if s.publisher != nil {
		if err := s.publisher.PublishHealth(ctx, r.GetServiceId(), r.GetHealthy(), int(r.GetStatusCode()), r.GetLatencyMs(), r.GetError()); err != nil {
			return err
		}
	}
	if !r.GetHealthy() && s.notify != nil {
		debounceKey := "webhook:health:" + r.GetServiceId()
		if ok, _ := s.rdb.SetNX(ctx, debounceKey, "1", 5*time.Minute).Result(); ok {
			svcUUID, err := service.ParseUUID(r.GetServiceId())
			if err == nil {
				svc, err := s.q.GetService(ctx, svcUUID)
				if err == nil {
					s.notify.FireStatusEvent(ctx, svc.OwnerID, r.GetServiceId(), svc.Name, "crash", map[string]interface{}{
						"source": "health_check", "status_code": r.GetStatusCode(), "error": r.GetError(),
					})
				}
			}
		}
	}
	return nil
}

func (s *Server) ingestBackupResult(ctx context.Context, r *gen.BackupResult) error {
	if r == nil || r.GetBackupId() == "" {
		return nil
	}
	status := db.BackupStatusSuccess
	if !r.GetSuccess() {
		status = db.BackupStatusFailed
	}
	id, err := service.ParseUUID(r.GetBackupId())
	if err != nil {
		return nil
	}
	_, err = s.q.UpdateBackupResult(ctx, db.UpdateBackupResultParams{
		ID:          id,
		Status:      status,
		SizeBytes:   pgtype.Int8{Int64: r.GetSizeBytes(), Valid: r.GetSuccess()},
		Error:       pgtype.Text{String: r.GetError(), Valid: r.GetError() != ""},
		CompletedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	return err
}

// ingestTerminalOutput appends terminal output to terminal:{service_id}:{session_id}.
func (s *Server) ingestTerminalOutput(ctx context.Context, out *gen.TerminalOutput) error {
	if out.GetServiceId() == "" || out.GetSessionId() == "" {
		return nil
	}
	closed := "0"
	if out.GetClosed() {
		closed = "1"
	}
	return s.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: terminalStreamPrefix + out.GetServiceId() + ":" + out.GetSessionId(),
		MaxLen: streamMaxLen,
		Approx: true,
		Values: map[string]interface{}{
			"data":   base64.StdEncoding.EncodeToString(out.GetData()),
			"closed": closed,
			"ts":     time.Now().Unix(),
		},
	}).Err()
}

// authenticate resolves the node identity from the agent token presented in
// gRPC metadata. mTLS (handled at the transport layer) proves the agent holds a
// trusted client cert; the token binds the stream to a specific node row.
func (s *Server) authenticate(ctx context.Context) (db.Node, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return db.Node{}, status.Error(codes.Unauthenticated, "missing metadata")
	}
	vals := md.Get(MetadataTokenKey)
	if len(vals) == 0 || vals[0] == "" {
		return db.Node{}, status.Error(codes.Unauthenticated, "missing agent token")
	}
	sum := sha256.Sum256([]byte(vals[0]))
	node, err := s.q.GetNodeByTokenHash(ctx, hex.EncodeToString(sum[:]))
	if err != nil {
		return db.Node{}, status.Error(codes.Unauthenticated, "unknown agent token")
	}
	return node, nil
}

// markNode updates the node's coarse online/offline status. Best-effort: a
// failure here must not tear down the agent stream.
func (s *Server) markNode(ctx context.Context, id pgtype.UUID, statusStr string) {
	if _, err := s.q.UpdateNodeStatus(ctx, db.UpdateNodeStatusParams{ID: id, Status: statusStr}); err != nil {
		s.log.Warn("update node status failed", "err", err)
		return
	}
	if s.publisher != nil {
		_ = s.publisher.PublishNodeStatus(ctx, uuidString(id), statusStr, 0, 0, 0)
	}
}

// uuidString renders a pgtype.UUID as its canonical 8-4-4-4-12 hex form.
func uuidString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	const hexd = "0123456789abcdef"
	buf := make([]byte, 36)
	j := 0
	for i := 0; i < 16; i++ {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			buf[j] = '-'
			j++
		}
		buf[j] = hexd[b[i]>>4]
		buf[j+1] = hexd[b[i]&0x0f]
		j += 2
	}
	return string(buf)
}
