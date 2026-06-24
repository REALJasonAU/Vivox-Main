# packages/proto

The single source of truth for the agent <-> control-plane wire contract.

`agent.proto` defines `AgentController.ConnectStream`, a **bidirectional
streaming** RPC: the agent sends a stream of `UpstreamEnvelope`s (heartbeat,
logs, metrics, command responses) and receives a stream of
`DownstreamEnvelope`s (start/stop/update tasks). One long-lived stream per
agent, carried over mTLS gRPC. See section 2 & 6 of the project plan.

## Module

`github.com/nexus-control/packages/proto`

Generated Go code is emitted into `./gen` (package `gen`), per the
`go_package` option:

```proto
option go_package = "github.com/nexus-control/packages/proto/gen;gen";
```

Both `apps/api` and `apps/agent` import the generated `gen` package.

## Generating the Go stubs

Generated stubs are **not** hand-written. Use one of the following once the
toolchain is installed.

### Option A — protoc (scripts provided)

Install:

- `protoc` — https://github.com/protocolbuffers/protobuf/releases
- `protoc-gen-go` — `go install google.golang.org/protobuf/cmd/protoc-gen-go@latest`
- `protoc-gen-go-grpc` — `go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest`

Make sure `$(go env GOPATH)/bin` is on `PATH`, then from this directory:

```bash
# Linux / macOS
./gen.sh
```

```powershell
# Windows
./gen.ps1
```

Both run the same command:

```bash
protoc \
  --go_out=gen --go_opt=paths=source_relative \
  --go-grpc_out=gen --go-grpc_opt=paths=source_relative \
  agent.proto
```

### Option B — buf

With [`buf`](https://buf.build) installed:

```bash
buf generate
```

(configured by `buf.gen.yaml`).

## After generating

Uncomment the `require` block in `go.mod` and run `go mod tidy` so the
`google.golang.org/grpc` and `google.golang.org/protobuf` dependencies are
resolved.

> **Status:** As of the foundation scaffold, `protoc`/`buf` were **not**
> available on the build machine, so `gen/` contains only a `.gitkeep`.
> Run one of the commands above to populate it.
