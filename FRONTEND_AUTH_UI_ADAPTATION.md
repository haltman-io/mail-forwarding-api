# Frontend Authentication Integration Guide

## Purpose

This file is the UI implementation guide for the current browser authentication system.

Use it as the auth source of truth for frontend work, UI rewrites, and LLM context switching.

This guide reflects the backend behavior implemented in:

- `app/src/routes/auth.js`
- `app/src/routes/admin.js`
- `app/src/controllers/auth/auth-controller.js`
- `app/src/controllers/auth/password-reset-controller.js`
- `app/src/controllers/admin/login-controller.js`
- `app/src/middlewares/auth.js`
- `app/src/middlewares/admin-auth.js`
- `app/src/middlewares/csrf-protection.js`

If another document disagrees with this guide on auth routes or auth transport, treat this guide and the files above as authoritative. In particular, older auth sections in `@DOCS/BACKEND_RESPONSES.md` may still describe the removed bearer-token flow.

## Scope

This guide covers:

- public sign-up, email verification, sign-in, sign-out, and password recovery
- session bootstrap and silent refresh
- CSRF handling for cookie-authenticated mutations
- admin UI integration on top of the shared auth session
- removed legacy auth behavior that the frontend must stop using

This guide does not define product copy, page layout, or visual design.

## Auth Model Summary

The browser auth model is:

- short-lived access JWT stored in `__Host-access`
- long-lived opaque refresh token stored in `__Host-refresh`
- both cookies are `HttpOnly`
- both cookies are sent automatically by the browser
- frontend JavaScript cannot read either auth cookie
- frontend must never store auth tokens in `localStorage` or `sessionStorage`
- authenticated state is restored by calling backend session endpoints, not by reading client-side token storage

Important transport rule:

- browser auth is cookie-only
- do not send `Authorization`, `X-Auth-Token`, or `X-Admin-Token`
- do not implement any bearer-token fallback in the UI

Important hosting rule:

- auth cookies are host-only `__Host-*` cookies with no `Domain`
- cross-origin browser auth only works for origins explicitly allowed by backend CORS policy
- cross-origin browser auth still requires `credentials: "include"`
- different-site deployments still need to respect the cookie policy (`SameSite=Lax` and host-only cookies)

## Non-Negotiable Frontend Rules

1. Every browser request that participates in auth must use `credentials: "include"`.
2. Never persist access or refresh tokens in frontend storage. The backend owns token storage through cookies.
3. Fetch and cache the CSRF token separately. It is not inside a cookie.
4. Send `X-CSRF-Token` on every authenticated state-changing request.
5. Treat `GET /auth/session` as the primary session bootstrap endpoint.
6. Treat `GET /auth/csrf` plus `POST /auth/refresh` as the silent reauthentication path when access expires.
7. Treat `user.is_admin` as a UI rendering hint only. Real admin authorization remains server-side.

## Cookie Contract

The backend sets these cookies:

- `__Host-access`
- `__Host-refresh`

Shared cookie properties:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- no `Domain`
- `Secure=true` only in production
- `Secure=false` in local development and test

Implications for the UI:

- JavaScript cannot read the cookie values
- the frontend must rely on response bodies such as `/auth/session` and `/admin/me`
- all fetch calls that need auth must opt into cookie transport with `credentials: "include"`

## Current Public Auth Endpoints

### `POST /auth/sign-up`

Request body:

```json
{
  "email": "user@example.com",
  "username": "new_user",
  "password": "StrongPassword123"
}
```

Success response:

```json
{
  "ok": true,
  "action": "sign_up",
  "accepted": true
}
```

Behavior notes:

- returns `202 Accepted`
- does not create a logged-in session
- does not set auth cookies
- always returns the same generic success for:
  - new account
  - existing unverified email
  - existing taken username
  - duplicate email that should not be disclosed
- UI must not interpret success as proof that a new account was created

Validation notes:

- `email` must be a valid mailbox
- `username` is required, lowercased, unique, `3..64` characters, and cannot contain `@`
- valid username pattern is `^(?=.{3,64}$)[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$`
- `password` length is `8..256`

### `POST /auth/verify-email`

Request body:

```json
{
  "token": "opaque-email-verification-token"
}
```

Success response:

```json
{
  "ok": true,
  "action": "verify_email",
  "verified": true,
  "user": {
    "id": 12,
    "username": "new_user",
    "email": "user@example.com"
  }
}
```

Failure responses:

- `400 { "error": "invalid_token" }`
- `400 { "error": "invalid_or_expired" }`
- `503 { "error": "temporarily_unavailable" }`

Behavior notes:

- token is an opaque string, not a JWT and not a numeric code
- UI should treat the token as an arbitrary string copied from email or supplied by a deep link
- successful verification does not log the user in

### `POST /auth/sign-in`

Request body:

```json
{
  "identifier": "user@example.com",
  "password": "StrongPassword123"
}
```

`identifier` may be:

- email, if it contains `@`
- username, otherwise

Success response:

```json
{
  "ok": true,
  "action": "sign_in",
  "authenticated": true,
  "user": {
    "id": 7,
    "username": "admin",
    "email": "admin@example.com",
    "email_verified_at": "2026-03-13T10:00:00.000Z",
    "is_active": 1,
    "is_admin": true,
    "created_at": "2026-03-13T10:00:00.000Z",
    "updated_at": "2026-03-13T10:00:00.000Z",
    "last_login_at": "2026-03-13T11:00:00.000Z"
  },
  "session": {
    "session_family_id": "family-123",
    "access_expires_at": "2026-03-13T11:10:00.000Z",
    "refresh_expires_at": "2026-04-12T11:00:00.000Z"
  }
}
```

Failure responses:

- `400 { "error": "invalid_params", "field": "identifier" }`
- `400 { "error": "invalid_params", "field": "password", "hint": "string 8..256 chars" }`
- `401 { "error": "auth_failed" }`

Behavior notes:

- successful sign-in sets both auth cookies
- UI must not expect any token in JSON
- unverified email returns the same `auth_failed` error as wrong credentials

### `GET /auth/session`

Request requirements:

- valid access cookie
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "authenticated": true,
  "user": {
    "id": 7,
    "username": "admin",
    "email": "admin@example.com",
    "email_verified_at": "2026-03-13T10:00:00.000Z",
    "is_active": 1,
    "is_admin": true,
    "created_at": "2026-03-13T10:00:00.000Z",
    "updated_at": "2026-03-13T10:00:00.000Z",
    "last_login_at": "2026-03-13T11:00:00.000Z"
  },
  "session": {
    "session_family_id": "family-123",
    "access_expires_at": "2026-03-13T11:10:00.000Z",
    "refresh_expires_at": "2026-04-12T11:00:00.000Z"
  }
}
```

Failure response:

- `401 { "error": "invalid_or_expired_session" }`

Use this endpoint to:

- bootstrap authenticated user state on app load
- restore session after reload
- confirm auth after sign-in or refresh

### `GET /auth/csrf`

Request requirements:

- valid access cookie or valid refresh cookie
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "csrf_token": "derived-session-family-token"
}
```

Failure response:

- `401 { "error": "invalid_or_expired_session" }`

Behavior notes:

- this endpoint is the canonical CSRF bootstrap endpoint
- it can succeed even when the access cookie is expired, as long as the refresh session is still valid
- the returned CSRF token is stable for the current session family
- normal refresh rotation does not require a new CSRF fetch unless the UI lost it

### `POST /auth/refresh`

Request requirements:

- valid refresh cookie
- `X-CSRF-Token`
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "action": "refresh",
  "refreshed": true,
  "session": {
    "session_family_id": "family-123",
    "access_expires_at": "2026-03-13T11:20:00.000Z",
    "refresh_expires_at": "2026-04-12T11:00:00.000Z"
  }
}
```

Failure responses:

- `401 { "error": "invalid_or_expired_session" }`
- `403 { "error": "csrf_required" }`
- `403 { "error": "invalid_csrf_token" }`
- `503 { "error": "temporarily_unavailable" }`

Behavior notes:

- backend rotates the refresh token on every successful refresh
- backend preserves the session family id across refresh
- backend clears auth cookies when refresh fails because the session is invalid
- UI should clear local auth state immediately on refresh `401`

### `POST /auth/sign-out`

Request requirements:

- current cookies
- `X-CSRF-Token` when a valid session exists
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "action": "sign_out",
  "signed_out": true
}
```

Behavior notes:

- idempotent
- backend clears cookies even if the session is already invalid
- authenticated UI should still send `X-CSRF-Token`

### `POST /auth/sign-out-all`

Request requirements:

- current cookies
- `X-CSRF-Token` when a valid session exists
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "action": "sign_out_all",
  "signed_out_all": true,
  "sessions_revoked": 3
}
```

Behavior notes:

- revokes every active session family for the current user
- clears current cookies
- frontend should clear all local auth state after success

### `POST /auth/forgot-password`

Request body:

```json
{
  "email": "user@example.com"
}
```

Success response:

```json
{
  "ok": true,
  "action": "forgot_password",
  "accepted": true,
  "recovery": {
    "ttl_minutes": 15
  }
}
```

Behavior notes:

- always returns generic success
- does not disclose whether the account exists
- UI should always show the same confirmation message

### `POST /auth/reset-password`

Request body:

```json
{
  "token": "opaque-reset-token",
  "new_password": "NewStrongPassword123"
}
```

Success response:

```json
{
  "ok": true,
  "action": "reset_password",
  "updated": true,
  "reauth_required": true,
  "sessions_revoked": 3,
  "user": {
    "id": 12,
    "email": "user@example.com"
  }
}
```

Failure responses:

- `400 { "error": "invalid_params", "field": "token" }`
- `400 { "error": "invalid_token" }`
- `400 { "error": "invalid_or_expired" }`
- `400 { "error": "invalid_params", "field": "new_password", "hint": "string 8..256 chars" }`
- `503 { "error": "temporarily_unavailable" }`

Behavior notes:

- token is an opaque string, not a JWT and not a numeric code
- backend revokes all active sessions on success
- backend clears auth cookies on success
- UI must redirect to sign-in after success

## Admin Session Endpoint

### `GET /admin/me`

Request requirements:

- valid access cookie
- authenticated user must still be an admin
- `credentials: "include"`

Success response:

```json
{
  "ok": true,
  "authenticated": true,
  "admin": {
    "id": 7,
    "username": "admin",
    "email": "admin@example.com",
    "email_verified_at": "2026-03-13T10:00:00.000Z",
    "is_active": 1,
    "is_admin": true,
    "created_at": "2026-03-13T10:00:00.000Z",
    "updated_at": "2026-03-13T10:00:00.000Z",
    "last_login_at": "2026-03-13T11:00:00.000Z"
  },
  "session": {
    "session_family_id": "family-123",
    "access_expires_at": "2026-03-13T11:10:00.000Z",
    "refresh_expires_at": "2026-04-12T11:00:00.000Z"
  }
}
```

Failure responses:

- `401 { "error": "invalid_or_expired_session" }`
- `403 { "error": "admin_required" }`

Admin route rules:

- all `/admin/*` routes use the same shared auth cookies
- safe methods (`GET`, `HEAD`, `OPTIONS`) do not need CSRF
- authenticated state-changing admin routes do require `X-CSRF-Token`
- frontend should expect `403 admin_required` when a signed-in non-admin hits admin APIs

## Removed Legacy Contract

The frontend must stop using all of the following:

- `POST /auth/register`
- `GET /auth/register/confirm`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /admin/login`
- `Authorization: Bearer <token>`
- `X-Auth-Token`
- `X-Admin-Token`
- `localStorage` or `sessionStorage` for auth tokens

Removed legacy auth routes now return:

```json
{
  "error": "not_found"
}
```

Mapping old to new:

- `/auth/register` -> `/auth/sign-up`
- `/auth/register/confirm` -> `/auth/verify-email`
- `/auth/login` -> `/auth/sign-in`
- `/auth/me` -> `/auth/session`
- `/auth/password/forgot` -> `/auth/forgot-password`
- `/auth/password/reset` -> `/auth/reset-password`
- `/admin/login` -> no separate replacement; admins also use `/auth/sign-in`

## Recommended Frontend State

Recommended in-memory state shape:

```ts
type AuthUser = {
  id: number;
  username: string;
  email: string;
  email_verified_at: string | null;
  is_active: number;
  is_admin: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
};

type SessionMeta = {
  session_family_id: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
};

type AuthState = {
  status: "anonymous" | "authenticated" | "refreshing";
  user: AuthUser | null;
  session: SessionMeta | null;
  csrfToken: string | null;
};
```

Recommended persistence rules:

- keep `user`, `session`, and `csrfToken` in memory by default
- if the UI persists non-secret metadata, persist only profile/session metadata, never auth tokens
- clear all auth state on sign-out, sign-out-all, refresh `401`, or reset-password success

## Required Fetch Behavior

All auth and admin fetch calls should follow these defaults:

```ts
const defaultFetchInit: RequestInit = {
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
};
```

If the UI is not same-origin with the API, the backend must also allow that frontend origin through its CORS policy, typically using the dynamic tenant-domain registry and optionally `CORS_ALLOWED_ORIGINS` for static overrides.

For authenticated mutations, add:

```ts
headers: {
  "Content-Type": "application/json",
  "X-CSRF-Token": csrfToken,
}
```

Never add:

```ts
Authorization: `Bearer ...`
X-Auth-Token: "..."
X-Admin-Token: "..."
```

## Recommended Session Lifecycle

### Initial app bootstrap

Recommended algorithm:

1. Call `GET /auth/session`.
2. If it returns `200`, store `user` and `session`.
3. Then call `GET /auth/csrf` and cache `csrf_token`.
4. If `GET /auth/session` returns `401`, attempt silent recovery:
   - call `GET /auth/csrf`
   - if that succeeds, call `POST /auth/refresh` with `X-CSRF-Token`
   - if refresh succeeds, call `GET /auth/session` again
   - if any recovery step fails, treat the user as signed out

### After sign-in

Recommended algorithm:

1. Call `POST /auth/sign-in`.
2. Store returned `user` and `session`.
3. Immediately call `GET /auth/csrf`.
4. Cache `csrf_token`.
5. Route by `user.is_admin` if the UI distinguishes admin and non-admin shells.

### Before authenticated mutations

Recommended algorithm:

1. Ensure `csrfToken` exists in memory.
2. If missing, call `GET /auth/csrf`.
3. Send the mutation request with `X-CSRF-Token`.

### On access-expired behavior

Typical signals:

- `GET /auth/session` returns `401`
- an authenticated API request returns `401 invalid_or_expired_session`

Recommended recovery:

1. Call `GET /auth/csrf`.
2. If it returns `200`, call `POST /auth/refresh` with the returned token.
3. If refresh returns `200`, retry the original request.
4. If refresh returns `401`, clear local auth state and redirect to sign-in if needed.

### On sign-out

Recommended algorithm:

1. Ensure the current `csrfToken` is attached.
2. Call `POST /auth/sign-out`.
3. Clear local auth state regardless of whether the backend session was already stale.

### On sign-out-all

Recommended algorithm:

1. Ensure the current `csrfToken` is attached.
2. Call `POST /auth/sign-out-all`.
3. Clear local auth state.
4. Redirect to signed-out state.

## Recommended Client Helpers

### Bootstrap helper

```ts
async function loadSession(): Promise<AuthState> {
  const sessionRes = await fetch("/auth/session", {
    method: "GET",
    credentials: "include",
  });

  if (sessionRes.ok) {
    const sessionData = await sessionRes.json();
    const csrfRes = await fetch("/auth/csrf", {
      method: "GET",
      credentials: "include",
    });

    const csrfData = csrfRes.ok ? await csrfRes.json() : { csrf_token: null };

    return {
      status: "authenticated",
      user: sessionData.user,
      session: sessionData.session,
      csrfToken: csrfData.csrf_token ?? null,
    };
  }

  if (sessionRes.status !== 401) {
    throw await sessionRes.json();
  }

  const csrfRes = await fetch("/auth/csrf", {
    method: "GET",
    credentials: "include",
  });

  if (!csrfRes.ok) {
    return {
      status: "anonymous",
      user: null,
      session: null,
      csrfToken: null,
    };
  }

  const csrfData = await csrfRes.json();

  const refreshRes = await fetch("/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfData.csrf_token,
    },
  });

  if (!refreshRes.ok) {
    return {
      status: "anonymous",
      user: null,
      session: null,
      csrfToken: null,
    };
  }

  const recoveredSessionRes = await fetch("/auth/session", {
    method: "GET",
    credentials: "include",
  });

  if (!recoveredSessionRes.ok) {
    return {
      status: "anonymous",
      user: null,
      session: null,
      csrfToken: null,
    };
  }

  const recoveredSessionData = await recoveredSessionRes.json();

  return {
    status: "authenticated",
    user: recoveredSessionData.user,
    session: recoveredSessionData.session,
    csrfToken: csrfData.csrf_token,
  };
}
```

### Mutation helper

```ts
async function authMutation(
  url: string,
  body: unknown,
  csrfToken: string
) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await res.json();
  }

  return res.json();
}
```

## UI Flow Requirements

### Sign-up screen

The screen should:

- collect `email`, `username`, and `password`
- validate username locally with the current rule set
- validate password length locally
- show generic success after `202`
- route the user to email verification instructions

The screen should not:

- assume the account definitely exists after success
- auto-login the user

### Email verification screen

The screen should:

- accept an opaque token string
- send it as JSON body to `POST /auth/verify-email`
- show success and route the user to sign-in

The screen may:

- prefill the token from a query parameter if the product later adds deep links

### Sign-in screen

The screen should:

- accept `identifier` and `password`
- allow either email or username in the identifier field
- show a generic auth failure on `401 auth_failed`
- not rely on any separate "unverified" error token

### Forgot password screen

The screen should:

- accept `email`
- show the same confirmation UI for any `200` response
- avoid revealing account existence

### Reset password screen

The screen should:

- accept an opaque reset token and a new password
- treat success as a forced reauthentication event
- clear local auth state after success
- route the user to sign-in

## Admin UI Integration

Admins now authenticate through the same public sign-in flow as normal users.

Recommended admin shell behavior:

1. Use `/auth/sign-in` for all users.
2. Read `user.is_admin` from sign-in or `/auth/session`.
3. If the user enters admin pages, optionally confirm with `GET /admin/me`.
4. For all admin mutations, send `X-CSRF-Token`.
5. If an admin request returns `403 admin_required`, remove the admin shell and redirect to a safe non-admin route.

Do not create a separate admin login transport layer.

## Error Tokens The UI Should Understand

These error tokens are relevant to the new auth flow:

- `invalid_params`
- `auth_failed`
- `invalid_token`
- `invalid_or_expired`
- `invalid_or_expired_session`
- `csrf_required`
- `invalid_csrf_token`
- `admin_required`
- `temporarily_unavailable`
- `internal_error`
- `not_found`

Recommended frontend handling:

- `invalid_params`: field-level validation or form error
- `auth_failed`: generic sign-in failure
- `invalid_token`: malformed verification/reset token
- `invalid_or_expired`: token exists no longer or was already consumed
- `invalid_or_expired_session`: session bootstrap or protected request must reauthenticate
- `csrf_required` or `invalid_csrf_token`: fetch a fresh CSRF token and retry once
- `admin_required`: remove admin-only UI
- `temporarily_unavailable`: retry-oriented UX
- `not_found`: stale frontend route mapping or old endpoint usage

## Frontend Migration Checklist

- replace all legacy auth endpoints with the new `/auth/*` routes
- remove all bearer-token storage and header injection
- make auth fetch wrappers use `credentials: "include"`
- add CSRF token bootstrap with `GET /auth/csrf`
- add `X-CSRF-Token` to authenticated mutations
- switch session restore from token storage to `GET /auth/session`
- implement silent refresh through `GET /auth/csrf` + `POST /auth/refresh`
- use `identifier` instead of separate login email-only input assumptions
- add `username` to sign-up
- update verify-email and reset-password UI to submit opaque tokens in JSON request bodies
- route admins and non-admins from the shared sign-in result
- stop using `/admin/login`

## Final Integration Notes

- `GET /auth/session` is the canonical "who am I" endpoint for the shared authenticated app shell.
- `GET /admin/me` is the canonical "am I still an admin" endpoint.
- `GET /auth/csrf` is required infrastructure, not an optional helper.
- A frontend that still assumes JSON bearer tokens or legacy auth routes is incompatible with the current backend.
