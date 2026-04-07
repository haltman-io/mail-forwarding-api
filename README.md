# Mail Forwarding API

REST API for managing email aliases, forwarding rules, and API credentials. Built with NestJS 11, backed by MariaDB, with optional Redis for distributed rate limiting.

## Features

- Email alias creation, forwarding, and deactivation with email confirmation
- API key authentication for programmatic alias management
- Admin panel API with full CRUD for aliases, domains, handles, bans, API tokens, DNS requests, and users
- Admin ban creation can optionally disable matching active aliases for `email`, `domain`, and `name` bans
- JWT-based admin authentication (EdDSA/Ed25519) with session families and refresh token rotation
- CSRF protection on admin mutation endpoints
- Password hashing with Argon2id
- Password reset flow with email confirmation
- Multi-layered rate limiting (per-IP, per-email, per-key) with delay and hard-limit strategies
- IP ban middleware
- DNS verification relay to an external check-dns service
- Configurable CORS with origin validation
- Structured JSON logging with automatic sensitive field redaction
- Multi-tenant origin policy support

## Architecture

The application follows a modular NestJS architecture with clear separation between controllers, services, and repositories. There is no ORM; all database access uses parameterized SQL queries through a thin `DatabaseService` abstraction over the MariaDB connection pool.

```
Request
  -> Express middleware (request context, IP ban, rate limiting)
  -> NestJS guards (API key auth, admin session auth)
  -> NestJS interceptors (audit logging, sensitive header removal)
  -> Controller
  -> Service (business logic, validation, ban checks)
  -> Repository (raw SQL via DatabaseService)
  -> MariaDB
```

Cross-cutting concerns (logging, exception handling, CORS, tenant policy) are provided globally via `InfrastructureModule`. Redis is optional and used only for distributed rate-limit counters; when unavailable, the system falls back to in-memory counters.

## Project Structure

```
app/
├── src/
│   ├── main.ts                             # Bootstrap, global prefix (/api), pipes, filters
│   ├── app.module.ts                       # Root module, middleware registration
│   ├── types/                              # Express augmentation, ambient types
│   ├── modules/
│   │   ├── admin/                          # Admin panel API
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts         # /admin/me, /admin/protected
│   │   │   ├── aliases/                    # CRUD for email aliases
│   │   │   ├── api-tokens/                 # CRUD for API tokens
│   │   │   ├── bans/                       # CRUD for bans (IP, domain, email, name)
│   │   │   ├── dns-requests/               # CRUD for DNS verification requests
│   │   │   ├── domains/                    # CRUD for mail domains
│   │   │   ├── handles/                    # CRUD for reserved handles
│   │   │   ├── users/                      # CRUD for admin users, notifications
│   │   │   ├── session/                    # Admin session resolution
│   │   │   ├── middlewares/                # Admin route auth, CSRF for mutations
│   │   │   ├── pipes/                      # ParseIdPipe (param validation)
│   │   │   ├── dto/                        # Shared admin DTOs
│   │   │   └── utils/                      # Admin helpers, database utils
│   │   ├── api/                            # Public API (key-authenticated)
│   │   │   ├── controllers/                # Alias operations, credential creation
│   │   │   ├── services/                   # Alias logic, credentials, email
│   │   │   ├── repositories/               # Alias, API tokens, logs, activity
│   │   │   ├── guards/                     # API key guard
│   │   │   ├── interceptors/               # API audit log interceptor
│   │   │   ├── dto/                        # Request DTOs
│   │   │   └── templates/                  # HTML confirmation page templates
│   │   ├── auth/                           # Admin authentication
│   │   │   ├── services/                   # Sign-in, session, password, reset email
│   │   │   ├── repositories/               # Users, password reset requests
│   │   │   └── dto/                        # Sign-in, forgot/reset password DTOs
│   │   ├── forwarding/                     # Email forwarding subscription
│   │   │   ├── services/                   # Subscribe/unsubscribe, email confirmation
│   │   │   ├── repositories/               # Confirmation state tracking
│   │   │   └── dto/                        # Confirm body DTO
│   │   ├── domains/                        # Active domain listing (cached)
│   │   ├── bans/                           # Ban policy evaluation
│   │   ├── check-dns/                      # DNS verification relay
│   │   └── stats/                          # Alias metrics
│   └── shared/
│       ├── infrastructure.module.ts        # Global providers
│       ├── config/                         # Typed config factories, env validation
│       ├── database/                       # DatabaseService (MariaDB pool, transactions)
│       ├── redis/                          # RedisService (optional, lazy init)
│       ├── logging/                        # AppLogger, request context middleware
│       ├── errors/                         # HttpExceptionFilter, PublicHttpException
│       ├── http/                           # NoCacheInterceptor, SensitiveHeadersInterceptor, pagination
│       ├── security/                       # CORS factory, IP ban middleware, rate limiting
│       ├── tenancy/                        # Tenant origin policy
│       ├── validation/                     # Mailbox parsing, domain validation, content-type guard
│       └── utils/                          # JWT, cookies, CSRF, crypto, email templates
├── test/                                   # Unit and integration tests (Jest)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── jest.config.ts
├── eslint.config.mjs
├── deploy.sh                               # PM2 deployment script
└── .env.example                            # Environment variable reference
```

## Installation

**Prerequisites:** Node.js >= 20, MariaDB instance, an external check-dns service.

```bash
cd app
npm install
cp .env.example .env
# Edit .env with your database credentials, JWT keys, and other required values
```

### Generate Ed25519 keys for JWT

The auth system uses EdDSA (Ed25519) for access tokens. Generate a key pair:

```bash
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log('Private (PEM):');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log('Public (PEM):');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
"
```

Set `JWT_ACCESS_PRIVATE_KEY` to the private key PEM and `JWT_ACCESS_VERIFY_KEYS` to a JSON object mapping key IDs to public key PEMs.

## Usage

```bash
# Development (hot reload via tsx)
npm run start:dev

# Production build
npm run build
npm start

# Type check
npm run typecheck

# Lint
npm run lint

# Run tests
npm test
```

The server listens on `APP_HOST:APP_PORT` (default `127.0.0.1:8080`). All routes are prefixed with `/api`.

### Deployment

The included `deploy.sh` pulls the latest code and restarts via PM2:

```bash
./deploy.sh
```

## Required Environment Variables

These must be set for the application to start:

| Variable | Description |
|---|---|
| `MARIADB_HOST` | MariaDB server host |
| `MARIADB_USER` | Database user |
| `MARIADB_DATABASE` | Database name |
| `CHECKDNS_BASE_URL` | Base URL of the external DNS check service |
| `CHECKDNS_TOKEN` | Auth token for the DNS check service |
| `AUTH_CSRF_SECRET` | Secret for CSRF token generation (HMAC-SHA256) |
| `JWT_ACCESS_PRIVATE_KEY` | Ed25519 private key (PEM) for signing access tokens |
| `JWT_ACCESS_KID` | Key ID for the active signing key |
| `JWT_ACCESS_VERIFY_KEYS` | JSON object of key IDs to public keys for verification |

See `.env.example` for the full list of optional variables including rate-limit thresholds, SMTP settings, Redis URL, CORS origins, and Argon2 tuning parameters.

## API Overview

### Public Endpoints

| Module | Prefix | Purpose |
|---|---|---|
| Forwarding | `/api/forward` | Subscribe/unsubscribe email aliases with confirmation flow |
| Credentials | `/api/credentials` | Create and confirm API keys via email verification |
| Check DNS | `/api/request`, `/api/checkdns` | Relay DNS verification requests to external service |
| Domains | `/api/domains` | List active mail domains (10s cache) |
| Stats | `/api/stats` | Alias metrics (60s cache) |

### API Key-Authenticated Endpoints

| Prefix | Purpose |
|---|---|
| `/api/alias` | List, create, and deactivate aliases owned by the key holder |
| `/api/activity` | View activity log for the key holder |

Authenticated via `Authorization` header with an API key (64-char hex string, stored as SHA256 hash).

### Admin Endpoints

All under `/api/admin`. Require JWT session authentication. CSRF token required for POST/PATCH/DELETE.

| Resource | Prefix | Operations |
|---|---|---|
| Session | `/api/admin/me` | View current admin session |
| Aliases | `/api/admin/aliases` | Full CRUD |
| API Tokens | `/api/admin/api-tokens` | Full CRUD |
| Bans | `/api/admin/bans` | Full CRUD (IP, domain, email, name); `POST` accepts optional `disable_matching_aliases` to deactivate matching active aliases for `email`, `domain`, and `name` bans |
| DNS Requests | `/api/admin/dns-requests` | Full CRUD |
| Domains | `/api/admin/domains` | Full CRUD |
| Handles | `/api/admin/handles` | Full CRUD |
| Users | `/api/admin/users` | Full CRUD + password change |

When `POST /api/admin/bans` is called with `disable_matching_aliases: true`, the response also includes a `disabled_aliases` count and a summary `message`.

### Auth Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/sign-in` | POST | Authenticate admin user |
| `/api/auth/session` | GET | Get current session info |
| `/api/auth/csrf` | GET | Get CSRF token |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/sign-out` | POST | End current session |
| `/api/auth/sign-out-all` | POST | Revoke all sessions |
| `/api/auth/forgot-password` | POST | Request password reset email |
| `/api/auth/reset-password` | POST | Reset password with token |

## Rate Limiting

Rate limiting is implemented as a NestJS middleware (`RouteRateLimitMiddleware`) that evaluates a set of rules per request based on method and path. Rules fall into two categories:

- **Delay rules** (slow-down): artificially delay the response after a threshold is reached, with incrementally increasing latency.
- **Limit rules** (hard cap): reject the request with `429 Too Many Requests` when the counter exceeds the configured threshold.

Counters are stored in Redis when available, falling back to in-memory storage. Each rule has a unique name that determines the counter key, a time window, and a key function that determines the bucketing dimension (IP, token, email, etc.).

### Cross-endpoint cycle limiting

The forwarding endpoints (`/api/forward/subscribe` and `/api/forward/confirm`) share a single rate-limit counter (`fwd_cycle_ip`) bucketed by IP address. This counter increments on both subscribe and confirm requests, preventing automated loops that create aliases in rapid succession by cycling between the two endpoints with unique parameters on each call.

Each alias creation cycle (one subscribe + one confirm) consumes 2 hits from this shared bucket. The limit is configured via `RL_FORWARDING_CYCLE_PER_HOUR_PER_IP` (default: 10, allowing up to 5 aliases per hour per IP).

### Confirm endpoint delay

The `/api/forward/confirm` endpoint applies progressive delay after a configurable number of requests per IP per minute. This mirrors the delay rules already present on subscribe and unsubscribe endpoints. Configured via `SD_CONFIRM_DELAY_AFTER` (threshold) and `SD_CONFIRM_DELAY_STEP_MS` (delay increment per subsequent request).

### Rate-limit environment variables

All rate-limit thresholds are configurable via environment variables. See `.env.example` for the complete list with descriptions. Key variables for forwarding abuse prevention:

| Variable | Default | Description |
|---|---|---|
| `RL_FORWARDING_CYCLE_PER_HOUR_PER_IP` | `10` | Combined subscribe + confirm hard limit per IP per hour |
| `SD_CONFIRM_DELAY_AFTER` | `3` | Confirm requests per minute before delay kicks in |
| `SD_CONFIRM_DELAY_STEP_MS` | `500` | Delay increment (ms) per confirm request above threshold |
| `RL_SUBSCRIBE_PER_10MIN_PER_IP` | `60` | Subscribe hard limit per IP per 10 minutes |
| `RL_CONFIRM_PER_10MIN_PER_IP` | `120` | Confirm hard limit per IP per 10 minutes |

## Development Notes

- **No ORM.** All SQL is hand-written and parameterized. Row types are defined as TypeScript interfaces in each repository file.
- **ESM-only.** The project uses `"type": "module"` with NodeNext module resolution. All internal imports use `.js` extensions.
- **Redis is optional.** If `REDIS_URL` is not set, rate-limit counters use in-memory storage (not shared across instances).
- **Tests** run with `--experimental-vm-modules` for ESM support in Jest. Use `npm test` (not `npx jest` directly).
- **Strict TypeScript.** The project enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`.
- **Rate limiting** is configurable per-endpoint via environment variables. Each endpoint can have delay rules (slow-down) and hard limits (429 rejection). Forwarding endpoints (subscribe and confirm) share a cross-endpoint cycle counter per IP to prevent automated alias creation loops. See `.env.example` for all threshold variables.
- **Admin mutations** require a CSRF token in the request header, derived from the session via HMAC-SHA256.
- **Password hashing** uses Argon2id with configurable time cost, memory cost, parallelism, hash length, and salt length.
