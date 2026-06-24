FROM golang:1.25-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.work ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/agent/ ./apps/agent/
WORKDIR /src/apps/api
RUN go mod download
RUN CGO_ENABLED=0 go build -o /api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates docker-cli
WORKDIR /app
COPY --from=builder /api /app/api
COPY infra/migrations /app/infra/migrations
COPY templates /app/templates
ENV HTTP_ADDR=:8080
ENV GRPC_ADDR=:9090
ENV MIGRATIONS_DIR=/app/infra/migrations
ENV TEMPLATES_DIR=/app/templates
EXPOSE 8080 9090
CMD ["/app/api"]
