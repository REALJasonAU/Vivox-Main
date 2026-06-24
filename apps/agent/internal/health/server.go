package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Server exposes lightweight HTTP health endpoints.
type Server struct {
	addr   string
	status func() string
}

// NewServer creates a health HTTP server.
func NewServer(addr string, status func() string) *Server {
	return &Server{addr: addr, status: status}
}

// Start serves /health and /ready until ctx is cancelled.
func (s *Server) Start(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"status": s.status()})
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, _ *http.Request) {
		if s.status() == "connected" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	srv := &http.Server{Addr: s.addr, Handler: mux}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	_ = srv.ListenAndServe()
}
