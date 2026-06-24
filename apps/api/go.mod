module github.com/nexus-control/apps/api

go 1.25.0

require (
	github.com/gofiber/contrib/websocket v1.3.4
	github.com/gofiber/fiber/v2 v2.52.13
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/hibiken/asynq v0.26.0
	github.com/jackc/pgx/v5 v5.10.0
	github.com/nexus-control/packages/domain v0.0.0
	github.com/nexus-control/packages/proto v0.0.0
	github.com/redis/go-redis/v9 v9.21.0
	google.golang.org/grpc v1.81.1
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/andybalholm/brotli v1.1.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/fasthttp/websocket v1.5.8 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.17.9 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-runewidth v0.0.16 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/rivo/uniseg v0.2.0 // indirect
	github.com/robfig/cron/v3 v3.0.1 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/savsgio/gotils v0.0.0-20240303185622-093b76447511 // indirect
	github.com/spf13/cast v1.10.0 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasthttp v1.52.0 // indirect
	github.com/valyala/tcplisten v1.0.0 // indirect
	go.opentelemetry.io/otel/metric v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk v1.44.0 // indirect
	go.opentelemetry.io/otel/trace v1.44.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.45.0 // indirect
	golang.org/x/text v0.37.0 // indirect
	golang.org/x/time v0.15.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

// The proto + domain packages are local-only modules in this monorepo. The
// repo-root go.work overrides these for workspace builds; the replace
// directives let `go mod tidy` / standalone builds resolve them by path
// (they are never published to a VCS host).
replace (
	github.com/nexus-control/packages/domain => ../../packages/domain
	github.com/nexus-control/packages/proto => ../../packages/proto
)
