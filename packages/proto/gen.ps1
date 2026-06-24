# Generate Go gRPC + protobuf stubs from agent.proto (Windows / PowerShell).
#
# Prerequisites (install once):
#   1. protoc            -> https://github.com/protocolbuffers/protobuf/releases
#   2. protoc-gen-go     -> go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
#   3. protoc-gen-go-grpc-> go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
#   Ensure $(go env GOPATH)\bin is on PATH so protoc can find the plugins.
#
# Run from the packages/proto directory:
#   ./gen.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

protoc `
  --go_out=gen --go_opt=paths=source_relative `
  --go-grpc_out=gen --go-grpc_opt=paths=source_relative `
  agent.proto

Write-Host "Generated stubs into ./gen"
