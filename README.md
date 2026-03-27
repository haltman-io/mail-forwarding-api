# Mail Forwarding API

A Node.js API that manages mail-forwarding aliases for the base-postfix-forwarder stack.
This service **does not receive emails**. It **creates and removes alias rows** in MariaDB
that Postfix later uses to forward mail.

## Features

- Create alias requests (`/api/forward/subscribe`) with strict validation
- Preview confirmation links via `GET /api/forward/confirm` and mutate via `POST`
- Request alias removal (`/api/forward/unsubscribe`) and confirm via token
- API key–authenticated alias management endpoints
- Rate limiting and abuse protections
- Structured logging with request IDs

## Prerequisites

This project depends on the **base-postfix-forwarder** stack and its database schema.
You must deploy the base stack first.

See: `FWD-Basestack.md`

## Quickstart

```bash
git clone https://github.com/haltman-io/mail-forwarding.git
cd mail-forwarding/mail-forwarding-api/app
npm install
cp .env.example .env
npm run start:dev
```

## Configuration

All configuration is via environment variables. Start with `.env.example`.

Key variables:

- `APP_ENV` (`dev`, `hml`, `prod`)
- `APP_HOST` and `APP_PORT`
- `LOG_LEVEL` (`trace`, `debug`, `info`, `warn`, `error`, `fatal`)
- `APP_PUBLIC_URL` (base URL used in confirmation links)
- `SMTP_*` (required to send confirmation emails)
- `MARIADB_*` (required to read/write aliases)
- `DEFAULT_ALIAS_DOMAIN`
- `CHECKDNS_BASE_URL` and `CHECKDNS_TOKEN` (relay to DNS validation service)

See `.env.example` for the full list.

## Scripts

```bash
npm run start       # run production server
npm run start:dev   # run with tsx watch
npm run test        # run tests
npm run lint        # eslint
npm run typecheck   # TypeScript check
```

## Project Structure

```
app/
  src/
    main.ts
    app.module.ts
    modules/
    shared/
    types/
  test/
```

## API Endpoints (core)

### Authentication

- `POST /api/auth/sign-in`
- `GET /api/auth/session`
- `GET /api/auth/csrf`
- `POST /api/auth/refresh`
- `POST /api/auth/sign-out`
- `POST /api/auth/sign-out-all`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### `GET /api/forward/subscribe`
Request alias creation.

Query params:
- `name` (required)
- `to` (required)
- `domain` (optional; defaults to `DEFAULT_ALIAS_DOMAIN`)

### `GET /api/forward/confirm`
Preview a pending alias creation/removal request without consuming the token.

Query params:
- `token` (required)

### `POST /api/forward/confirm`
Apply the pending alias creation/removal request.

JSON body:
- `token` (required)

### `GET /api/forward/unsubscribe`
Request alias removal.

Query params:
- `alias` (required; full alias address)

### General public reads

- `GET /api/domains`
- `GET /api/stats`

### API credentials + alias management

- `POST /api/credentials/create` (body or query: `email`, `days`)
- `GET /api/credentials/confirm?token=...` (preview only)
- `POST /api/credentials/confirm` (JSON body: `token`)
- `GET /api/alias/list` (requires `X-API-Key`)
- `POST /api/alias/create` (requires `X-API-Key`)
- `POST /api/alias/delete` (requires `X-API-Key`)

## DNS validation relay (check-dns)

This API exposes a small relay that forwards DNS validation requests to the
upstream check-dns service while applying local validation and rate limits.

Endpoints:

- `POST /api/request/ui` (JSON body: `{ "target": "example.com" }`)
- `POST /api/request/email` (JSON body: `{ "target": "example.com" }`)
- `GET /api/checkdns/:target`

Config:

- `CHECKDNS_BASE_URL` (required)
- `CHECKDNS_TOKEN` (required; sent as `x-api-key`)
- `CHECKDNS_HTTP_TIMEOUT_MS` (optional; default 8000)

## Reverse Proxy

In production, expose only the API namespace to the NestJS process and let the
static site handle all other paths.

```caddy
handle /api/* {
    reverse_proxy 127.0.0.1:9090
}

handle {
    try_files {path}.html {path}/index.html {path}
    file_server
}
```

## Logging

Logs are JSON-formatted for easy parsing. Each request includes `x-request-id`.
Errors are logged with stack traces and sanitized context.

## License

Unlicense (see `LICENSE`).
