// Package auth verifies Better Auth sessions for the Go control plane and
// exposes Fiber middleware that extracts the caller's owner_id + role.
//
// Better Auth (in apps/web) is configured with its JWT plugin, issuing HS256
// tokens signed with BETTER_AUTH_SECRET. The Go API is a pure verifier: it
// never mints sessions, it only checks the signature + claims and pins the
// resulting identity onto the request via Fiber Locals.
//
// Phase 1 roles: "admin" (nodes + all services) and "user" (own services).
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgtype"

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

// Config controls how sessions are verified.
type Config struct {
	// Secret is the shared HMAC secret (BETTER_AUTH_SECRET).
	Secret []byte
	// DevMode allows the X-Dev-User / X-Dev-Role headers to authenticate a
	// request without a real JWT. For local development only.
	DevMode bool
	// ApiKeys enables Authorization: ApiKey vvx_... authentication.
	ApiKeys *db.Queries
}

// Claims is the subset of Better Auth JWT claims the control plane cares about.
type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// New builds the authentication middleware. It rejects unauthenticated requests
// with 401 and otherwise pins owner_id + role onto Locals.
func New(cfg Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Dev shortcut: trust headers when explicitly enabled.
		if cfg.DevMode {
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
			if cfg.ApiKeys != nil {
				rawKey := strings.TrimPrefix(h, "ApiKey ")
				hash := sha256Hex(rawKey)
				key, err := cfg.ApiKeys.GetApiKeyByHash(c.UserContext(), hash)
				if err == nil {
					go func(id pgtype.UUID) {
						_ = cfg.ApiKeys.TouchApiKey(context.Background(), id)
					}(key.ID)
					c.Locals(localOwnerID, key.UserID)
					c.Locals(localRole, RoleUser)
					return c.Next()
				}
			}
		}

		raw := bearerToken(c)
		if raw == "" {
			// WebSocket clients cannot set Authorization; accept ?token= query param.
			raw = c.Query("token")
		}
		if raw == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "missing session token")
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrTokenSignatureInvalid
			}
			return cfg.Secret, nil
		})
		if err != nil || !token.Valid {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid session token")
		}
		if claims.Subject == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "token missing subject")
		}

		role := claims.Role
		if role == "" {
			role = RoleUser
		}
		c.Locals(localOwnerID, claims.Subject)
		c.Locals(localRole, role)
		return c.Next()
	}
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

// bearerToken extracts the JWT from the Authorization header or, failing that,
// the Better Auth session cookie.
func bearerToken(c *fiber.Ctx) string {
	if h := c.Get(fiber.HeaderAuthorization); h != "" {
		if strings.HasPrefix(strings.ToLower(h), "bearer ") {
			return strings.TrimSpace(h[len("bearer "):])
		}
	}
	// Better Auth's JWT plugin may also surface the token as a cookie.
	if ck := c.Cookies("better-auth.session_token"); ck != "" {
		return ck
	}
	return c.Cookies("nexus_token")
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
