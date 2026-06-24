// Package auth verifies Better Auth sessions for the Go control plane and
// exposes Fiber middleware that extracts the caller's owner_id + role.
//
// Better Auth (in apps/web) uses the JWT plugin with EdDSA keys stored in the
// jwks table and exposed at GET /api/auth/jwks. The Go API verifies Bearer
// tokens against that JWKS endpoint — it never mints sessions.
//
// Phase 1 roles: "admin" (nodes + all services) and "user" (own services).
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"

	"github.com/nexus-control/apps/api/internal/db"
)

// Locals keys used to carry the verified identity through the request lifecycle.
const (
	localOwnerID = "owner_id"
	localRole    = "role"
)

// Roles.
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// DefaultJWKSURL is the Docker-internal Better Auth JWKS endpoint (web service).
const DefaultJWKSURL = "http://web:3000/api/auth/jwks"

// Config controls how sessions are verified.
type Config struct {
	// JWKSURL is the Better Auth JWKS endpoint (e.g. http://web:3000/api/auth/jwks).
	JWKSURL string
	// DevMode allows the X-Dev-User / X-Dev-Role headers to authenticate a
	// request without a real JWT. For local development only.
	DevMode bool
	// ApiKeys enables Authorization: ApiKey vvx_... authentication.
	ApiKeys *db.Queries
}

type verifier struct {
	cache   *jwk.Cache
	jwksURL string
	devMode bool
	apiKeys *db.Queries
}

// New builds the authentication middleware. It rejects unauthenticated requests
// with 401 and otherwise pins owner_id + role onto Locals.
func New(cfg Config) fiber.Handler {
	jwksURL := cfg.JWKSURL
	if jwksURL == "" {
		jwksURL = DefaultJWKSURL
	}

	ctx := context.Background()
	cache := jwk.NewCache(ctx)
	if err := cache.Register(jwksURL, jwk.WithMinRefreshInterval(5*time.Minute)); err != nil {
		panic(fmt.Sprintf("auth: register JWKS cache for %s: %v", jwksURL, err))
	}

	v := &verifier{
		cache:   cache,
		jwksURL: jwksURL,
		devMode: cfg.DevMode,
		apiKeys: cfg.ApiKeys,
	}
	return v.middleware
}

func (v *verifier) middleware(c *fiber.Ctx) error {
	if v.devMode {
		if u := c.Get("X-Dev-User"); u != "" {
			role := c.Get("X-Dev-Role")
			if role == "" {
				role = RoleUser
			}
			c.Locals(localOwnerID, u)
			c.Locals(localRole, role)
			return c.Next()
		}
	}

	if h := c.Get(fiber.HeaderAuthorization); strings.HasPrefix(h, "ApiKey ") {
		if v.apiKeys != nil {
			rawKey := strings.TrimPrefix(h, "ApiKey ")
			hash := sha256Hex(rawKey)
			key, err := v.apiKeys.GetApiKeyByHash(c.UserContext(), hash)
			if err == nil {
				go func(id pgtype.UUID) {
					_ = v.apiKeys.TouchApiKey(context.Background(), id)
				}(key.ID)
				c.Locals(localOwnerID, key.UserID)
				c.Locals(localRole, RoleUser)
				return c.Next()
			}
		}
	}

	raw := bearerToken(c)
	if raw == "" {
		raw = c.Query("token")
	}
	if raw == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "missing session token")
	}

	sub, role, err := v.verifyBearer(c.UserContext(), raw)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "invalid session token")
	}
	if sub == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "token missing subject")
	}
	if role == "" {
		role = RoleUser
	}

	c.Locals(localOwnerID, sub)
	c.Locals(localRole, role)
	return c.Next()
}

func (v *verifier) verifyBearer(ctx context.Context, raw string) (sub, role string, err error) {
	tok, err := v.parseJWT(ctx, raw, false)
	if err != nil {
		tok, err = v.parseJWT(ctx, raw, true)
		if err != nil {
			return "", "", err
		}
	}

	sub = tok.Subject()
	if sub == "" {
		if s, ok := tok.Get("sub"); ok {
			sub, _ = s.(string)
		}
	}
	if r, ok := tok.Get("role"); ok {
		role, _ = r.(string)
	}
	return sub, role, nil
}

func (v *verifier) parseJWT(ctx context.Context, raw string, forceRefresh bool) (jwt.Token, error) {
	if forceRefresh {
		if _, err := v.cache.Refresh(ctx, v.jwksURL); err != nil {
			return nil, err
		}
	}

	keySet, err := v.cache.Get(ctx, v.jwksURL)
	if err != nil {
		return nil, err
	}

	return jwt.Parse(
		[]byte(raw),
		jwt.WithKeySet(keySet),
		jwt.WithValidate(true),
	)
}

// RequireRole guards a route so only callers with the given role may proceed.
// It must run after New().
func RequireRole(role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if Role(c) != role {
			return fiber.NewError(fiber.StatusForbidden, "insufficient role")
		}
		return c.Next()
	}
}

// OwnerID returns the verified Better Auth user id for the request.
func OwnerID(c *fiber.Ctx) string {
	if v, ok := c.Locals(localOwnerID).(string); ok {
		return v
	}
	return ""
}

// Role returns the verified role for the request ("admin" or "user").
func Role(c *fiber.Ctx) string {
	if v, ok := c.Locals(localRole).(string); ok {
		return v
	}
	return ""
}

// IsAdmin reports whether the caller holds the admin role.
func IsAdmin(c *fiber.Ctx) bool { return Role(c) == RoleAdmin }

// bearerToken extracts the JWT from the Authorization Bearer header.
func bearerToken(c *fiber.Ctx) string {
	if h := c.Get(fiber.HeaderAuthorization); h != "" {
		if strings.HasPrefix(strings.ToLower(h), "bearer ") {
			return strings.TrimSpace(h[len("bearer "):])
		}
	}
	return ""
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
