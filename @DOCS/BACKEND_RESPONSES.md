# Backend Response Reference

This document maps the current Express.js response behavior from source code under `app/src`.

Scope:
- Route handlers in `app/src/routes/index.js`
- Controllers in `app/src/controllers/**`
- Response-affecting middlewares in `app/src/middlewares/**`
- App-level fallback handlers in `app/src/app.js`

## Global Response Behavior

### Common response headers
- `x-request-id`: always set by `requestLogger` middleware (echoes incoming `x-request-id` or generates one).
- CORS headers: added by `cors()` for all routes.
- For rate-limited routes: `RateLimit` and `RateLimit-Policy` headers are enabled (`standardHeaders: draft-7`).

### Shared response patterns
- Most API endpoints return JSON (`res.json(...)`).
- `GET /api/credentials/confirm` returns JSON (`application/json`), including success payload with generated API key.
- Redirects use Express default redirect status (`302`) when `res.redirect(...)` is used.
- Unhandled errors go through `errorHandler` and return:

```json
{ "error": "internal_error" }
```

### Shared auth errors (`requireApiKey` middleware)
Used by authenticated endpoints (`/api/alias/*`, `/api/activity`):
- `401 { "error": "missing_api_key" }`
- `401 { "error": "invalid_api_key_format" }`
- `401 { "error": "invalid_or_expired_api_key" }`
- `500 { "error": "internal_error" }`

### Shared rate-limit errors
All rate-limited routes can return `429`.

Two formats exist:
- Global limiter (`globalLimiter`) uses express-rate-limit default message (string/plain-text payload).
- Route-specific limiters return JSON:

```json
{ "error": "rate_limited", "where": "<route_scope>", "reason": "<specific_reason>" }
```

## Routes and Responses

## `GET /domains`
Required params: none

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `string[]` | List of active domains. On fresh fetch, includes `Cache-Control: public, max-age=10`. |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure. |

## `GET /`
Required params: none

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 302 | `REDIRECT` | redirect | `Location: https://forward.haltman.io/` |

## Unmatched Routes (`app` fallback)
Path/method: any unmatched request after router

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 302 | `REDIRECT` | redirect | `Location: https://github.com/haltman-io` |

## `GET /forward/subscribe`
Middlewares: global rate limit + subscribe slow-down + subscribe rate limits

Required params:
- `to` (query, required)
- One of:
- `address` (query, full alias email), or
- `name` (query, alias local-part) + optional `domain` (query). If `domain` omitted, backend uses `DEFAULT_ALIAS_DOMAIN`.

Rules:
- `address` cannot be combined with `name` or `domain`.

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "action": "subscribe", "alias_candidate": "string", "to": "string", "confirmation": { "sent": "boolean", "ttl_minutes": "number" } }` | `confirmation.sent=false` can happen on resend cooldown. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "name|domain|address|to", "reason?": "string", "hint?": "string" }` | Includes specific reasons/hints like `address_incompatible_with_name`, `destination_cannot_be_an_existing_alias`, etc. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_domain", "field": "domain", "hint": "..." }` | Alias domain not active in DB. |
| 403 | `FORBIDDEN` | `{ "error": "banned", "ban": { "ban_type": "ip|email|domain|name", "ban_value": "string", "reason": "string|null", "banned_at": "datetime" } }` | Ban object is returned directly from DB. |
| 409 | `CONFLICT` | `{ "ok": false, "error": "alias_taken", "address": "string" }` | Alias already exists. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_to`, `too_many_requests_alias` (`where: subscribe`). |
| 500 | `SERVER_ERROR` | `{ "error": "server_misconfigured", "field": "DEFAULT_ALIAS_DOMAIN" }` | Missing/invalid server default domain when user did not provide `domain`. |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `GET /forward/unsubscribe`
Middlewares: global rate limit + unsubscribe slow-down + unsubscribe rate limits

Required params:
- `alias` (query, required, alias email)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "action": "unsubscribe", "alias": "string", "sent": "boolean", "reason?": "string", "ttl_minutes": "number" }` | `reason` currently used for cooldown behavior (`"cooldown"`). |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "alias|alias_name|alias_domain" }` | Parameter/domain/local validation errors. |
| 400 | `VALIDATION_ERROR` | `{ "error": "alias_inactive", "alias": "string" }` | Alias exists but inactive. |
| 403 | `FORBIDDEN` | `{ "error": "banned", "type": "ip|email|domain", "value?": "string" }` | `value` only present for domain ban checks. |
| 404 | `NOT_FOUND` | `{ "error": "alias_not_found", "alias": "string" }` | Alias does not exist. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_address` (`where: unsubscribe`). |
| 500 | `SERVER_ERROR` | `{ "error": "invalid_goto_on_alias", "alias": "string" }` | Alias target email is corrupted/unparseable. |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `GET /forward/confirm`
Middlewares: global rate limit + confirm rate limits

Required params:
- `token` (query, required, 6-digit code)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "confirmed": true, "intent": "subscribe|subscribe_address|unsubscribe", "created?": "boolean", "removed?": "boolean", "address": "string", "goto?": "string", "reason?": "already_exists" }` | Shape depends on intent branch. |
| 400 | `VALIDATION_ERROR` | `{ "ok": false, "error": "invalid_token" }` | Invalid token format. |
| 400 | `VALIDATION_ERROR` | `{ "ok": false, "error": "invalid_or_expired" }` | Token missing from pending records or no longer valid. |
| 400 | `VALIDATION_ERROR` | `{ "ok": false, "error": "unsupported_intent", "intent": "string" }` | Pending record has unknown intent. |
| 400 | `VALIDATION_ERROR` | `{ "ok": false, "error": "invalid_domain", "domain": "string" }` | Subscribe intent with inactive alias domain. |
| 404 | `NOT_FOUND` | `{ "ok": false, "error": "alias_not_found", "address": "string" }` | Unsubscribe confirm for non-existing alias. |
| 409 | `CONFLICT` | `{ "ok": false, "error": "alias_owner_changed", "address": "string" }` | Alias target changed since request was issued. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_token` (`where: confirm`). |
| 500 | `SERVER_ERROR` | `{ "ok": false, "error": "confirmation_payload_missing" }` | Pending row missing required fields (`email`/`alias_name`/`alias_domain`). |
| 500 | `SERVER_ERROR` | `{ "ok": false, "error": "internal_error" }` | Generic failure path. |

## `POST /request/ui`
Middlewares: global rate limit + request-ui rate limits

Required params:
- Header/content-type: must be `application/json`
- JSON body: `{ "target": "domain" }`

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `{ "error": "unsupported_media_type" }` | Triggered when request is not JSON. |
| 400 | `VALIDATION_ERROR` | `{ "error": "target must be a domain name without scheme" }` | Invalid domain target format. |
| 2xx/4xx/5xx | `UPSTREAM_PASSTHROUGH` | passthrough of upstream body | Backend relays upstream status and payload as-is. JSON/string/buffer/empty body are all possible. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_target` (`where: request_ui`). |
| 502 | `BAD_GATEWAY` | `{ "error": "internal_error" }` | Upstream/network error (non-timeout). |
| 503 | `SERVICE_UNAVAILABLE` | `{ "error": "internal_error" }` | Upstream timeout (`ECONNABORTED`). |

## `POST /request/email`
Middlewares: global rate limit + request-email rate limits

Required params:
- Header/content-type: must be `application/json`
- JSON body: `{ "target": "domain" }`

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `{ "error": "unsupported_media_type" }` | Triggered when request is not JSON. |
| 400 | `VALIDATION_ERROR` | `{ "error": "target must be a domain name without scheme" }` | Invalid domain target format. |
| 2xx/4xx/5xx | `UPSTREAM_PASSTHROUGH` | passthrough of upstream body | Backend relays upstream status and payload as-is. JSON/string/buffer/empty body are all possible. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_target` (`where: request_email`). |
| 502 | `BAD_GATEWAY` | `{ "error": "internal_error" }` | Upstream/network error (non-timeout). |
| 503 | `SERVICE_UNAVAILABLE` | `{ "error": "internal_error" }` | Upstream timeout (`ECONNABORTED`). |

## `GET /api/checkdns/:target`
Middlewares: global rate limit + checkdns target rate limit

Required params:
- Path param: `target` (required, domain format)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `{ "error": "target must be a domain name without scheme" }` | Invalid domain target format. |
| 2xx/4xx/5xx | `UPSTREAM_PASSTHROUGH` | passthrough of upstream body | Backend relays upstream status and payload as-is. JSON/string/buffer/empty body are all possible. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_target` (`where: checkdns`). |
| 502 | `BAD_GATEWAY` | `{ "error": "internal_error" }` | Upstream/network error (non-timeout). |
| 503 | `SERVICE_UNAVAILABLE` | `{ "error": "internal_error" }` | Upstream timeout (`ECONNABORTED`). |

## `POST /api/credentials/create`
Middlewares: global rate limit + credentials-create rate limits

Required params:
- `email` (body or query, required)
- `days` (body or query, required, integer `1..90`)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "action": "api_credentials_create", "email": "string", "days": "number", "confirmation": { "sent": "boolean", "ttl_minutes": "number", "reason?": "cooldown|rate_limited", "status?": "PENDING", "expires_at?": "datetime|null", "last_sent_at?": "datetime|null", "next_allowed_send_at?": "datetime|null", "send_count?": "number", "remaining_attempts?": "number" } }` | `confirmation` carries resend state for notification UX. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "email" }` | Invalid/missing email format. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "days", "hint": "integer 1..90" }` | Invalid/missing days. |
| 403 | `FORBIDDEN` | `{ "error": "banned", "ban": { "ban_type": "ip|email", "ban_value": "string", "reason": "string|null", "banned_at": "datetime" } }` | Ban object from DB. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_email` (`where: credentials_create`). |
| 503 | `SERVICE_UNAVAILABLE` | `{ "error": "temporarily_unavailable" }` | Transaction retry exhausted / lock pressure (`tx_busy`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `GET /api/credentials/confirm`
Middlewares: global rate limit + credentials-confirm rate limits

Required params:
- `token` (query, required, 6-digit code)

Response content type:
- Success: `application/json`
- Errors: `application/json`

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "action": "api_credentials_confirm", "confirmed": true, "email": "string", "token": "64-hex-string", "token_type": "api_key", "expires_in_days": "number" }` | Returns the generated API key once, in JSON. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "token" }` | Missing token parameter. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_token" }` | Invalid token format. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_or_expired" }` | Token missing from pending records or no longer valid (including already-used token). |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reasons: `too_many_requests_ip`, `too_many_requests_token` (`where: credentials_confirm`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `GET /api/alias/list`
Middlewares: global rate limit + `requireApiKey` + alias list rate limit + API log middleware

Required params:
- Header: `X-API-Key` (required, 64 lowercase hex chars)
- Optional query: `limit` (int > 0), `offset` (int >= 0)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "items": [ { "id": "number", "address": "string", "goto": "string", "active": "0|1|boolean", "domain_id": "number|null", "created": "datetime", "modified": "datetime" } ], "pagination": { "total": "number", "limit": "number", "offset": "number" } }` | DB row shape returned directly. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "limit|offset" }` | Pagination validation. |
| 401 | `AUTH_ERROR` | Auth middleware payloads | `missing_api_key`, `invalid_api_key_format`, `invalid_or_expired_api_key`. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_key` (`where: alias_list`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | From auth/controller failures. |

## `GET /api/alias/stats`
Middlewares: global rate limit + `requireApiKey` + alias list rate limit + API log middleware

Required params:
- Header: `X-API-Key` (required)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "totals": "number", "active": "number", "created_last_7d": "number", "modified_last_24h": "number", "by_domain": [ { "domain": "string", "total": "number", "active": "number" } ] }` | Aggregated alias stats for token owner email. |
| 401 | `AUTH_ERROR` | Auth middleware payloads | `missing_api_key`, `invalid_api_key_format`, `invalid_or_expired_api_key`. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_key` (`where: alias_list`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `GET /api/activity`
Middlewares: global rate limit + `requireApiKey` + alias list rate limit + API log middleware

Required params:
- Header: `X-API-Key` (required)
- Optional query: `limit` (int > 0), `offset` (int >= 0)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "items": [ { "type": "alias_create|alias_delete|confirm_<intent>", "occurred_at": "datetime", "route": "string|null", "intent": "string|null", "alias": "string|null" } ], "pagination": { "limit": "number", "offset": "number" } }` | Merges API logs + email confirmation activity. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "limit|offset" }` | Pagination validation. |
| 401 | `AUTH_ERROR` | Auth middleware payloads | `missing_api_key`, `invalid_api_key_format`, `invalid_or_expired_api_key`. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_key` (`where: alias_list`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `POST /api/alias/create`
Middlewares: global rate limit + `requireApiKey` + alias create rate limit + API log middleware

Required params:
- Header: `X-API-Key` (required)
- `alias_handle` (body or query, required)
- `alias_domain` (body or query, required)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "created": true, "address": "string", "goto": "owner_email" }` | `goto` is derived from API key owner. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "alias_handle|alias_domain" }` | Missing/invalid handle/domain format. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_domain", "field": "alias_domain" }` | Domain not active in DB. |
| 401 | `AUTH_ERROR` | Auth middleware payloads | `missing_api_key`, `invalid_api_key_format`, `invalid_or_expired_api_key`. |
| 409 | `CONFLICT` | `{ "ok": false, "error": "alias_taken", "address": "string" }` | Alias already exists. |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_key` (`where: alias_create`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## `POST /api/alias/delete`
Middlewares: global rate limit + `requireApiKey` + alias delete rate limit + API log middleware

Required params:
- Header: `X-API-Key` (required)
- `alias` (body or query, required, full alias email)

### Responses
| Status | Indicator | Response schema | Additional data |
|---|---|---|---|
| 200 | `SUCCESS` | `{ "ok": true, "deleted": true, "alias": "string" }` | Successful delete confirmation. |
| 400 | `VALIDATION_ERROR` | `{ "error": "invalid_params", "field": "alias" }` | Invalid/missing alias format. |
| 401 | `AUTH_ERROR` | Auth middleware payloads | `missing_api_key`, `invalid_api_key_format`, `invalid_or_expired_api_key`. |
| 403 | `FORBIDDEN` | `{ "error": "forbidden" }` | Alias exists but belongs to another owner. |
| 404 | `NOT_FOUND` | `{ "error": "alias_not_found", "alias": "string" }` | Alias not found (before or during delete). |
| 429 | `RATE_LIMITED` | Global: default limiter text OR route limiter JSON | Route limiter reason: `too_many_requests_key` (`where: alias_delete`). |
| 500 | `SERVER_ERROR` | `{ "error": "internal_error" }` | Generic failure path. |

## Notification-Oriented Error Tokens (quick index)
Use these values as frontend notification keys:

- `internal_error`
- `invalid_params`
- `invalid_domain`
- `invalid_token`
- `invalid_or_expired`
- `unsupported_intent`
- `alias_not_found`
- `alias_taken`
- `alias_inactive`
- `alias_owner_changed`
- `forbidden`
- `banned`
- `rate_limited`
- `server_misconfigured`
- `unsupported_media_type`
- `temporarily_unavailable`
- `confirmation_payload_missing`
- `invalid_goto_on_alias`

## Files Reviewed
- `app/src/app.js`
- `app/src/routes/index.js`
- `app/src/controllers/**/*.js`
- `app/src/middlewares/**/*.js`
- `app/src/lib/logger.js`
- `app/src/lib/domain-validation.js`
- `app/src/lib/confirmation-code.js`
- `app/src/lib/mailbox-validation.js`
- `app/src/services/check-dns-client.js`
- `app/src/services/email-confirmation-service.js`
- `app/src/services/api-credentials-email-service.js`
- `app/src/repositories/*.js` (for response field shape verification)
