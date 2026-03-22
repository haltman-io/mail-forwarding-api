# Legado auth/

## Objetivo

Este documento descreve como o modulo legado `app/src/routes/auth.js` funcionava, incluindo contratos HTTP, persistencia, cookies, sessao, CSRF, side effects e invariantes que precisam ser preservados se o fluxo antigo tiver de ser reproduzido.

## Escopo

O legado `auth/` atendia usuarios comuns e administradores no mesmo stack.

- A autenticacao usava a tabela `users`.
- O papel administrativo era decidido por `users.is_admin`.
- O login de admin e o login de usuario comum passavam pela mesma rota `POST /auth/sign-in`.
- A sessao usava dois artefatos ao mesmo tempo: access JWT em cookie e refresh token opaco em cookie.

## Arquivos-fonte principais

- `app/src/routes/auth.js`
- `app/src/controllers/auth/auth-controller.js`
- `app/src/controllers/auth/password-reset-controller.js`
- `app/src/repositories/admin-auth-repository.js`
- `app/src/repositories/email-verification-tokens-repository.js`
- `app/src/repositories/password-reset-requests-repository.js`
- `app/src/middlewares/auth.js`
- `app/src/lib/auth-session-context.js`
- `app/src/lib/auth-cookies.js`
- `app/src/lib/access-jwt.js`
- `app/src/lib/csrf.js`
- `app/src/services/email-verification-email-service.js`
- `app/src/services/password-reset-email-service.js`
- `app/src/services/admin-login-email-service.js`

## Matriz de rotas

| Rota | Auth previa | CSRF | Rate limit | Comportamento legado |
| --- | --- | --- | --- | --- |
| `POST /auth/sign-up` | nao | nao | global + por IP + por email | Cadastra usuario comum ou responde genericamente para nao revelar existencia |
| `POST /auth/verify-email` | nao | nao | global + por IP + por token | Consome token de verificacao e marca email como verificado |
| `POST /auth/sign-in` | nao | nao | global + multiplos buckets de brute force | Autentica usuario ou admin, cria familia de sessao e seta cookies |
| `POST /auth/forgot-password` | nao | nao | global + por IP + por email | Gera ou reenvia reset token de forma nao enumeravel |
| `POST /auth/reset-password` | nao | nao | global + por IP + por token | Consome token, troca senha e revoga sessoes |
| `GET /auth/csrf` | sessao valida via access ou refresh | n/a | global | Devolve token CSRF derivado do `session_family_id` |
| `POST /auth/refresh` | refresh valido | sim | global | Rotaciona refresh token e renova access JWT |
| `POST /auth/sign-out` | opcional, mas se houver sessao precisa ser valida | sim quando houver sessao | global | Revoga a familia de sessao atual e limpa cookies |
| `POST /auth/sign-out-all` | opcional, mas se houver sessao precisa ser valida | sim quando houver sessao | global | Revoga todas as familias do usuario e limpa cookies |
| `GET /auth/session` | access valido | nao | global | Devolve usuario autenticado e metadados da sessao |

## Fluxos detalhados

### Sign-up

1. A rota esperava `email`, `username` e `password`.
2. `email` era normalizado por `normalizeEmailStrict`.
3. `username` era normalizado por `normalizeUsername`.
4. `password` precisava obedecer `MIN_PASSWORD_LEN..MAX_PASSWORD_LEN`.
5. Se ja existisse usuario com o mesmo email e ele ainda nao estivesse verificado, o sistema tentava reenviar o email de verificacao.
6. Se ja existisse usuario com o mesmo email, a resposta continuava sendo generica.
7. Se ja existisse usuario com o mesmo username, a resposta tambem era generica.
8. Em cadastro novo, o usuario era criado com `is_active = 1`, `is_admin = 0` e `email_verified_at = null`.
9. O envio do email de verificacao era best effort. Falha no envio nao mudava a resposta.
10. A resposta de sucesso era sempre:

```json
{
  "ok": true,
  "action": "sign_up",
  "accepted": true
}
```

11. O status HTTP de sucesso era `202`.

### Verificacao de email

1. A rota esperava `token`.
2. O token era opaco, normalizado e validado por formato.
3. O banco armazenava apenas o hash SHA-256 do token.
4. A rotina `consumePendingTokenTx` fazia a operacao de forma transacional.
5. O efeito final era validar token pendente e nao expirado, marcar `users.email_verified_at`, marcar o token consumido e invalidar outros tokens pendentes do mesmo usuario.
6. Em caso de token invalido ou expirado, a resposta era `400 { "error": "invalid_or_expired" }`.
7. Em sucesso, a resposta era:

```json
{
  "ok": true,
  "action": "verify_email",
  "verified": true,
  "user": {}
}
```

### Sign-in

1. A rota aceitava `identifier` e `password`.
2. `identifier` podia ser username ou email.
3. O fluxo usava `consumeSlowVerify` com hash dummy para reduzir diferenca temporal em erros de autenticacao.
4. O usuario era buscado por `adminAuthRepository.getActiveUserByIdentifier`.
5. A senha era validada por Argon2id.
6. O login falhava com `401 { "error": "auth_failed" }` para usuario inexistente, usuario inativo, password incorreto ou email ainda nao verificado.
7. Em sucesso, o fluxo gerava refresh token opaco, criava familia em `auth_sessions`, aplicava limite de familias ativas por usuario, emitia access JWT assinado, setava cookies `__Host-access` e `__Host-refresh` e atualizava `users.last_login_at`.
8. Se o usuario autenticado fosse admin e `ADMIN_LOGIN_EMAIL_ENABLED=true`, era enviado email de alerta de login.
9. A resposta era:

```json
{
  "ok": true,
  "action": "sign_in",
  "authenticated": true,
  "user": {},
  "session": {
    "session_family_id": "string",
    "access_expires_at": "ISO-8601",
    "refresh_expires_at": "ISO-8601"
  }
}
```

### Sessao atual

1. `GET /auth/session` exigia access JWT valido.
2. O middleware `requireAuth` resolvia a sessao a partir do cookie de access.
3. O controlador reconsultava o usuario em `users`.
4. Se o usuario estivesse ausente ou inativo, a resposta era `401 { "error": "invalid_or_expired_session" }`.
5. A resposta de sucesso devolvia `user` e `session`.

### CSRF

1. `GET /auth/csrf` aceitava sessao resolvida por access ou refresh.
2. O token era derivado de `session_family_id`.
3. O header esperado em mutacoes era `X-CSRF-Token`.
4. O token nao era persistido em tabela propria. Ele era derivado deterministicamente por HMAC.
5. `POST /auth/refresh`, `POST /auth/sign-out` e `POST /auth/sign-out-all` exigiam CSRF valido quando a sessao existia.

### Refresh

1. O refresh dependia do cookie `__Host-refresh`.
2. O token apresentado era opaco; o banco armazenava somente o hash.
3. O refresh exigia `X-CSRF-Token`.
4. Em sucesso, o refresh token atual era rotacionado, um novo refresh token opaco era emitido, um novo access JWT era emitido e os dois cookies eram reescritos.
5. Em falha de refresh, os cookies eram limpos e a resposta era `401 { "error": "invalid_or_expired_session" }`.
6. A modelagem do banco reconhecia estados de familia e token como `active`, `rotated`, `revoked` e `reuse_detected`.
7. Se um refresh token rotacionado reaparecesse, a familia inteira podia ser revogada.

### Sign-out

1. `POST /auth/sign-out` tentava resolver access ou refresh.
2. Se existisse sessao, o CSRF era obrigatorio.
3. O efeito no banco era revogar a familia corrente.
4. Os cookies eram sempre limpos, mesmo se nao houvesse sessao ativa.
5. A resposta era:

```json
{
  "ok": true,
  "action": "sign_out",
  "signed_out": true
}
```

### Sign-out-all

1. `POST /auth/sign-out-all` tentava resolver access ou refresh.
2. Se existisse sessao, o CSRF era obrigatorio.
3. O efeito no banco era revogar todas as familias de sessao do usuario.
4. Os cookies eram sempre limpos.
5. A resposta incluia a contagem de sessoes revogadas:

```json
{
  "ok": true,
  "action": "sign_out_all",
  "signed_out_all": true,
  "sessions_revoked": 0
}
```

### Forgot password

1. A rota esperava `email`.
2. O email era normalizado por `normalizeEmailStrict`.
3. A resposta era generica mesmo se o usuario nao existisse ou se o envio falhasse.
4. Se existisse usuario ativo com o email informado, o sistema tentava gerar ou reenviar um token de reset.
5. O email de reset recebia o token opaco, nao um JWT.
6. O retorno de sucesso era `200` com:

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

### Reset password

1. A rota esperava `token` e `new_password`.
2. O token precisava estar em formato valido e pendente em `password_reset_tokens`.
3. A transacao `consumePendingAndResetPasswordTx` travava o token e o usuario, atualizava `users.password_hash`, revogava sessoes em `auth_sessions` e marcava o token como usado.
4. Em sucesso, os cookies eram limpos.
5. A resposta era:

```json
{
  "ok": true,
  "action": "reset_password",
  "updated": true,
  "reauth_required": true,
  "sessions_revoked": 0,
  "user": {}
}
```

## Persistencia legada

| Tabela | Papel no fluxo | Regras relevantes |
| --- | --- | --- |
| `users` | Identidade principal | Armazena `username`, `email`, `password_hash`, `is_active`, `is_admin`, `email_verified_at`, `last_login_at` |
| `auth_sessions` | Familias de refresh e metadados de sessao | Guarda hashes de refresh token, status, expiracao, revogacao e dados de uso |
| `email_verification_tokens` | Confirmacao de cadastro | Armazena apenas hash do token, expiracao, `used_at`, `send_count`, `last_sent_at`, IP e user agent |
| `password_reset_tokens` | Recuperacao de senha | Armazena apenas hash do token, expiracao, `used_at`, `send_count`, `last_sent_at`, IP e user agent |

## Modelo de cookies e JWT

- Nome do cookie de access: `__Host-access`
- Nome do cookie de refresh: `__Host-refresh`
- Ambos usavam `httpOnly`
- Ambos usavam `path=/`
- `secure` ficava ativo apenas quando `APP_ENV` ou `ENV_NAME` resolvia para `prod`
- `sameSite` vinha de `AUTH_COOKIE_SAME_SITE`
- O access token era JWT assinado, com `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, `nbf` e `exp`
- O refresh token era opaco e nunca era persistido em claro

## Rate limiting legado

O middleware `app/src/middlewares/rate-limit.js` mantinha armazenamento em Redis quando disponivel, com fallback em memoria.

Buckets relevantes para `auth/`:

- `globalLimiter` em todas as rotas
- `authRegisterByIp` com default `10/hora/IP`
- `authRegisterByEmail` com default `3/hora/email`
- `authRegisterConfirmByIp` com default `30/10min/IP`
- `authRegisterConfirmByToken` com default `10/10min/token`
- `authLoginFailByIp` com default `12/15min/IP`
- `authLoginFailByEmail` com default `6/hora/identifier`
- `authLoginFailHardByEmailIp` com default `3/6h/identifier+IP`
- `authLoginFailFastByEmailIp` com default `2/5min/identifier+IP`
- `authPasswordResetRequestByIp` com default `10/hora/IP`
- `authPasswordResetRequestByEmail` com default `3/hora/email`
- `authPasswordResetConfirmByIp` com default `30/10min/IP`
- `authPasswordResetConfirmByToken` com default `10/10min/token`

Observacao: os nomes dos buckets de login remetem a `admin`, mas eram reutilizados pelo endpoint unico `POST /auth/sign-in`.

## Configuracao e dependencias de ambiente

Variaveis que moldavam o comportamento legado:

- `AUTH_REGISTER_CONFIRM_ENDPOINT`
- `AUTH_VERIFY_EMAIL_ENDPOINT`
- `AUTH_REFRESH_TTL_DAYS`
- `AUTH_MAX_ACTIVE_SESSION_FAMILIES`
- `AUTH_COOKIE_SAME_SITE`
- `AUTH_CSRF_SECRET`
- `JWT_ACCESS_PRIVATE_KEY`
- `JWT_ACCESS_KID`
- `JWT_ACCESS_VERIFY_KEYS`
- `JWT_ACCESS_ISSUER`
- `JWT_ACCESS_AUDIENCE`
- `JWT_ACCESS_TTL_SECONDS`
- `JWT_ACCESS_CLOCK_SKEW_SECONDS`
- `PASSWORD_RESET_TTL_MINUTES`
- `PASSWORD_RESET_RESEND_COOLDOWN_SECONDS`
- `PASSWORD_RESET_MAX_SENDS`
- `PASSWORD_RESET_EMAIL_SUBJECT`
- `ADMIN_AUTH_DUMMY_PASSWORD_HASH`
- `ADMIN_LOGIN_EMAIL_ENABLED`

## Quirks e dividas historicas

- O stack de autenticacao de usuario e admin era compartilhado, o que misturava conceitos de produto e operacao.
- Existiam `AUTH_REGISTER_CONFIRM_ENDPOINT` e `AUTH_VERIFY_EMAIL_ENDPOINT` ao mesmo tempo; o fluxo atual de verificacao de email usava `AUTH_VERIFY_EMAIL_ENDPOINT`.
- O endpoint `POST /auth/sign-in` atendia usuarios finais e administradores, mudando o comportamento apenas pelo campo `is_admin`.
- Emails de verificacao, reset e alerta de login eram best effort. Falha de envio nao implicava rollback do cadastro ou do login.
- O token CSRF era derivado do `session_family_id`, nao persistido.

## Regras que uma reimplementacao precisa preservar

- Nao revelar por resposta se email ou username ja existem no sign-up.
- Nao permitir login antes de `email_verified_at`.
- Persistir somente hash de refresh token, reset token e email verification token.
- Tratar refresh rotation como fluxo atomico, com deteccao de reuse.
- Revogar sessoes ao resetar senha.
- Exigir `X-CSRF-Token` nas mutacoes autenticadas que dependem de cookie.
- Manter `GET /auth/csrf` baseado na sessao corrente, inclusive quando apenas o refresh estiver valido.
- Limpar cookies em falhas de refresh e em fluxos de sign-out.
- Preservar o aviso de login para administradores quando habilitado.
