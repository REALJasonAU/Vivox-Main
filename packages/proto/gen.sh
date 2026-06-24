#!/usr/bin/env bash
# Generate Go gRPC + protobuf stubs from agent.proto (Linux / macOS).
#
# Prerequisites (install once):
#   1. protoc             -> https://github.com/protocolbuffers/protobuf/releases (or `brew install protobuf`)
#   2. protoc-gen-go      -> go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
#   3. protoc-gen-go-grpc -> go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
#   Ensure "$(go env GOPATH)/bin" is on PATH so protoc can find the plugins.
#
# Run from the packages/proto directory:
#   ./gen.sh
set -euo pipefail
cd "$(dirname "$0")"

protoc \
  --go_out=gen --go_opt=paths=source_relative \
  --go-grpc_out=gen --go-grpc_opt=paths=source_relative \
  agent.proto

echo "Generated stubs into ./gen"
