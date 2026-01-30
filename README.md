# Mail Forwarding API

A Node.js API that manages mail-forwarding aliases for the base-postfix-forwarder stack.
This service **does not receive emails**. It **creates and removes alias rows** in MariaDB
that Postfix later uses to forward mail.

## Features

- Create alias requests (`/forward/subscribe`) with strict validation
- Confirm alias creation via email tokens (`/forward/confirm`)
- Request alias removal (`/forward/unsubscribe`) and confirm via token
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
npm run dev
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
npm run dev         # run with node --watch
npm run test        # run tests
npm run test:watch  # jest watch mode
npm run lint        # eslint
npm run lint:fix    # eslint --fix
npm run format      # prettier check
npm run format:fix  # prettier write
```

## Project Structure

```
app/
  src/
    app.js
    server.js
    config/
    lib/
    middlewares/
    controllers/
    routes/
    services/
    repositories/
    types/
  tests/
    unit/
    integration/
  scripts/
```

## API Endpoints (core)

### `GET /forward/subscribe`
Request alias creation.

Query params:
- `name` (required)
- `to` (required)
- `domain` (optional; defaults to `DEFAULT_ALIAS_DOMAIN`)

### `GET /forward/confirm`
Confirm alias creation/removal with a token.

Query params:
- `token` (required)

### `GET /forward/unsubscribe`
Request alias removal.

Query params:
- `alias` (required; full alias address)

### API credentials + alias management

- `POST /api/credentials/create` (body or query: `email`, `days`)
- `GET /api/credentials/confirm?token=...`
- `GET /api/alias/list` (requires `X-API-Key`)
- `POST /api/alias/create` (requires `X-API-Key`)
- `POST /api/alias/delete` (requires `X-API-Key`)

## DNS validation relay (check-dns)

This API exposes a small relay that forwards DNS validation requests to the
upstream check-dns service while applying local validation and rate limits.

Endpoints:

- `POST /request/ui` (JSON body: `{ "target": "example.com" }`)
- `POST /request/email` (JSON body: `{ "target": "example.com" }`)
- `GET /api/checkdns/:target`

Config:

- `CHECKDNS_BASE_URL` (required)
- `CHECKDNS_TOKEN` (required; sent as `x-api-key`)
- `CHECKDNS_HTTP_TIMEOUT_MS` (optional; default 8000)

## Logging

Logs are JSON-formatted for easy parsing. Each request includes `x-request-id`.
Errors are logged with stack traces and sanitized context.

## License

Unlicense (see `LICENSE`).
