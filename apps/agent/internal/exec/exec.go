// Package exec attaches to a container's stdout/stderr log stream and pipes the
// bytes up the agent's gRPC stream as LogChunk frames. It is deliberately
// decoupled from the Docker SDK: the docker package opens the log reader and
// hands it here, so exec only depends on io + the upstream log sink.
package exec

import (
	"context"
	"io"

	"github.com/docker/docker/pkg/stdcopy"
)

// LogSink receives demultiplexed log bytes. *client.Sender satisfies it.
// streamType is "stdout" or "stderr".
type LogSink interface {
	SendLog(serviceID string, data []byte, streamType string) error
}

// Stream pumps a container log reader into LogChunk frames until the reader is
// exhausted (container exit) or ctx is cancelled.
//
// When a container has no TTY, the Docker daemon multiplexes stdout and stderr
// into a single stream framed with an 8-byte header per chunk. stdcopy.StdCopy
// demultiplexes that back into two logical streams, which we tag accordingly.
func Stream(ctx context.Context, logs io.ReadCloser, serviceID string, sink LogSink) error {
	defer logs.Close()

	// Closing the reader when ctx is cancelled unblocks the StdCopy read below.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = logs.Close()
		case <-done:
		}
	}()

	stdout := &chunkWriter{sink: sink, serviceID: serviceID, streamType: "stdout"}
	stderr := &chunkWriter{sink: sink, serviceID: serviceID, streamType: "stderr"}

	_, err := stdcopy.StdCopy(stdout, stderr, logs)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

// chunkWriter forwards each Write as a LogChunk. stdcopy reuses its internal
// buffer between writes, so the slice is copied before being handed off.
type chunkWriter struct {
	sink       LogSink
	serviceID  string
	streamType string
}

func (w *chunkWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	buf := make([]byte, len(p))
	copy(buf, p)
	// A dropped frame (stream mid-reconnect) must not abort log demuxing; the
	// control plane reconciles on reconnect. Swallow send errors here.
	_ = w.sink.SendLog(w.serviceID, buf, w.streamType)
	return len(p), nil
}
