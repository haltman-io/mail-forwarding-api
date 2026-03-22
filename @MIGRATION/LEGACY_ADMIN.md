# Legado admin/

## Objetivo

Este documento descreve como o modulo legado `app/src/routes/admin.js` funcionava, incluindo acesso, contratos HTTP, persistencia, side effects, regras de negocio e invariantes que precisam ser preservados se a area administrativa antiga tiver de ser reproduzida.

## Escopo

O legado `admin/` era uma camada CRUD autenticada por cookie, apoiada no mesmo stack de sessao do `auth/`.

- O admin nao tinha mecanismo proprio de login. Ele reutilizava `POST /auth/sign-in`.
- A entrada na area administrativa exigia `users.is_admin = 1`.
- Todas as mutacoes administrativas dependiam de CSRF.
- O roteador fazia CRUD de dominios, aliases, handles, bans, API tokens e usuarios admin.

## Arquivos-fonte principais

- `app/src/routes/admin.js`
- `app/src/controllers/admin/login-controller.js`
- `app/src/controllers/admin/domains-controller.js`
- `app/src/controllers/admin/aliases-controller.js`
- `app/src/controllers/admin/handles-controller.js`
- `app/src/controllers/admin/bans-controller.js`
- `app/src/controllers/admin/api-tokens-controller.js`
- `app/src/controllers/admin/users-controller.js`
- `app/src/controllers/admin/helpers.js`
- `app/src/middlewares/admin-auth.js`
- `app/src/middlewares/csrf-protection.js`
- `app/src/repositories/domain-repository.js`
- `app/src/repositories/alias-repository.js`
- `app/src/repositories/alias-handles-repository.js`
- `app/src/repositories/bans-repository.js`
- `app/src/repositories/api-tokens-repository.js`
- `app/src/repositories/admin-auth-repository.js`

## Contrato de acesso

O roteador `admin/` aplicava este encadeamento global:

- `rateLimit.globalLimiter`
- `requireAdminAuth`
- `requireCsrfForAuthenticatedMutation`

Consequencias praticas:

- Toda rota de `GET /admin/*` exigia access JWT valido em cookie e usuario com `is_admin = 1`.
- Toda rota mutavel de `POST`, `PATCH` e `DELETE` exigia tambem `X-CSRF-Token`.
- Se nao houvesse sessao valida, a resposta padrao era `401 { "error": "invalid_or_expired_session" }`.
- Se houvesse sessao valida, mas o usuario nao fosse admin, a resposta era `403 { "error": "admin_required" }`.

## Matriz de rotas

| Rota | Metodo | Semantica |
| --- | --- | --- |
| `/admin/me` | `GET` | Devolve perfil admin autenticado e metadados da sessao |
| `/admin/domains` | `GET` | Lista dominios com filtros e paginacao |
| `/admin/domains/:id` | `GET` | Busca dominio por id |
| `/admin/domains` | `POST` | Cria dominio |
| `/admin/domains/:id` | `PATCH` | Atualiza dominio |
| `/admin/domains/:id` | `DELETE` | Soft delete do dominio |
| `/admin/aliases` | `GET` | Lista aliases com filtros e paginacao |
| `/admin/aliases/:id` | `GET` | Busca alias por id |
| `/admin/aliases` | `POST` | Cria alias mailbox -> mailbox |
| `/admin/aliases/:id` | `PATCH` | Atualiza alias |
| `/admin/aliases/:id` | `DELETE` | Soft delete do alias |
| `/admin/handles` | `GET` | Lista handles catch-all com filtros e paginacao |
| `/admin/handles/:id` | `GET` | Busca handle por id |
| `/admin/handles` | `POST` | Cria handle local-part -> mailbox |
| `/admin/handles/:id` | `PATCH` | Atualiza handle |
| `/admin/handles/:id` | `DELETE` | Soft delete do handle |
| `/admin/bans` | `GET` | Lista bans com filtros e paginacao |
| `/admin/bans/:id` | `GET` | Busca ban por id |
| `/admin/bans` | `POST` | Cria ban |
| `/admin/bans/:id` | `PATCH` | Atualiza ou revoga ban |
| `/admin/bans/:id` | `DELETE` | Delete semantico: revoke ban |
| `/admin/api-tokens` | `GET` | Lista API tokens com filtros e paginacao |
| `/admin/api-tokens/:id` | `GET` | Busca API token por id |
| `/admin/api-tokens` | `POST` | Cria API token e devolve plaintext uma unica vez |
| `/admin/api-tokens/:id` | `PATCH` | Atualiza API token |
| `/admin/api-tokens/:id` | `DELETE` | Delete semantico: revoke token |
| `/admin/users` | `GET` | Lista usuarios com filtros e paginacao |
| `/admin/users/:id` | `GET` | Busca usuario por id |
| `/admin/users` | `POST` | Cria usuario, normalmente admin |
| `/admin/users/:id` | `PATCH` | Atualiza usuario |
| `/admin/users/:id` | `DELETE` | Soft delete do usuario |
| `/admin/users/me/password` | `PATCH` | Troca a propria senha do admin autenticado |

## Formato de resposta

Padroes recorrentes do legado:

- listas devolviam `items` e `pagination`
- leitura unitaria devolvia `item`
- criacao devolvia `ok`, `created` e `item`
- patch devolvia `ok`, `updated` e `item`
- delete devolvia `ok`, `deleted` e `item` quando aplicavel

`GET /admin/me` era o endpoint especial de introspeccao de sessao:

```json
{
  "ok": true,
  "authenticated": true,
  "admin": {},
  "session": {
    "session_family_id": "string",
    "access_expires_at": "ISO-8601",
    "refresh_expires_at": "ISO-8601"
  }
}
```

## Recurso: domains

Tabela principal: `domain`

Campos relevantes:

- `id`
- `name`
- `active`

Filtros de listagem:

- `active`
- `name`

Regras de negocio:

- `name` precisava ser um dominio valido.
- Criacao e alteracao consultavam bans de dominio ativo.
- Dominio duplicado retornava `409 domain_taken`.
- `DELETE /admin/domains/:id` nao removia linha. Fazia soft delete com `active = 0`.
- Um dominio banido nao podia ser ativado ou renomeado para valor banido.

## Recurso: aliases

Tabela principal: `alias`

Campos relevantes:

- `id`
- `address`
- `goto`
- `active`
- `created`
- `modified`

Filtros de listagem:

- `active`
- `goto`
- `domain`
- `handle`
- `address`

Regras de negocio:

- `address` precisava ser mailbox valida.
- `goto` precisava ser mailbox valida.
- O local-part de `address` era bloqueado se estivesse reservado em `alias_handle`.
- O dominio de `address` precisava existir e estar ativo em `domain`.
- O fluxo consultava bans por nome do alias, por dominio do alias e por email/dominio de destino.
- Alias duplicado retornava `409 alias_taken`.
- `DELETE /admin/aliases/:id` fazia soft delete com `active = 0`.

## Recurso: handles

Tabela principal: `alias_handle`

Campos relevantes:

- `id`
- `handle`
- `address`
- `active`

Filtros de listagem:

- `active`
- `handle`
- `address`

Regras de negocio:

- `handle` precisava ser local-part valido.
- `address` precisava ser mailbox valida.
- O fluxo consultava ban de nome para o handle e ban de email/dominio para o destino.
- Handle duplicado retornava `409 handle_taken`.
- `DELETE /admin/handles/:id` fazia soft delete com `active = 0`.

## Recurso: bans

Tabela principal: `api_bans`

Tipos permitidos:

- `email`
- `domain`
- `ip`
- `name`

Campos relevantes:

- `id`
- `ban_type`
- `ban_value`
- `reason`
- `expires_at`
- `revoked_at`
- `revoked_reason`

Filtros de listagem:

- `ban_type`
- `ban_value`
- `active`

Semantica:

- Um ban era considerado ativo quando `revoked_at IS NULL` e `expires_at` era nulo ou maior que `NOW(6)`.
- `DELETE /admin/bans/:id` nao apagava a linha. Ele apenas revogava o ban.
- `PATCH /admin/bans/:id` podia alterar tipo, valor, razao, expiracao e estado de revogacao.

## Recurso: api-tokens

Tabela principal: `api_tokens`

Campos relevantes:

- `id`
- `owner_email`
- `token_hash`
- `status`
- `created_at`
- `expires_at`
- `revoked_at`
- `revoked_reason`
- `created_ip`
- `user_agent`
- `last_used_at`

Filtros de listagem:

- `active`
- `owner_email`
- `status`

Regras de negocio:

- Criacao exigia `owner_email`.
- `days` default era `30`, maximo `90`.
- O token em claro era gerado como `crypto.randomBytes(32).toString("hex")`.
- Apenas o hash SHA-256 era persistido.
- O plaintext do token era devolvido uma unica vez na resposta de criacao.
- Listagens e leituras administrativas mostravam o registro persistido, nao o plaintext original.
- A resposta de criacao devolvia `token`, `token_type: "api_key"` e `item`.
- `DELETE /admin/api-tokens/:id` fazia revoke sem apagar a linha.
- Token ativo significava `status = 'active'`, `revoked_at IS NULL` e `expires_at > NOW(6)`.
- O consumo operacional do token acontecia fora de `admin/`, por header `X-API-Key`, com normalizacao em lowercase antes do hash e atualizacao de `last_used_at`.

## Recurso: users

Tabela principal: `users`

Campos relevantes expostos pela API:

- `id`
- `username`
- `email`
- `email_verified_at`
- `is_active`
- `is_admin`
- `created_at`
- `updated_at`
- `last_login_at`

Filtros de listagem:

- `active`
- `is_admin`
- `email`

Criacao:

- `POST /admin/users` exigia `username`, `email` e `password`.
- `is_active` default era `1`.
- `is_admin` default era `1`.
- `email_verified_at` era preenchido com `new Date()` no ato da criacao.
- Se o usuario criado resultasse em admin, o sistema tentava enviar welcome email ou notificacao de alteracao.

Atualizacao:

- `PATCH /admin/users/:id` podia alterar `email`, `username`, `is_active`, `is_admin` e `password`.
- O admin autenticado nao podia trocar a propria senha por essa rota. O erro era `invalid_params` com `reason: use_self_password_route`.
- Se `password`, `is_active` ou `is_admin` mudassem, as sessoes do usuario eram revogadas.
- Alteracoes que envolvessem um admin disparavam notificacoes de mudanca quando `ADMIN_USER_CHANGE_EMAIL_ENABLED=true`.

Delete:

- `DELETE /admin/users/:id` fazia soft delete com `is_active = 0`.
- O delete tambem revogava todas as sessoes do usuario.

Troca da propria senha:

- `PATCH /admin/users/me/password` exigia `current_password` e `new_password`.
- `new_password` nao podia ser igual a `current_password`.
- A senha atual era verificada com Argon2id.
- Em sucesso, as sessoes eram revogadas e a resposta devolvia `reauth_required: true`.

## Invariantes criticas de usuarios admin

- O ultimo admin ativo nao podia ser desativado.
- O ultimo admin ativo nao podia ser despromovido para `is_admin = 0`.
- O ultimo admin ativo nao podia ser deletado.
- Duplicidade por email ou username retornava `409 admin_user_taken`.
- A rota de troca da propria senha era separada da rota de edicao geral.

## Side effects e notificacoes

- `GET /admin/me` devolvia `Cache-Control: no-store`.
- O login de admin gerava email de alerta via fluxo de `auth/`, nao via `admin/`.
- Criacao de admin podia gerar welcome email.
- Update, delete e troca de senha de admin podiam gerar email de notificacao.
- Falhas nessas notificacoes eram logadas, mas nao revertiam a alteracao principal.

## Persistencia legada

| Tabela | Papel no admin/ | Observacao |
| --- | --- | --- |
| `domain` | Cadastro de dominios | Soft delete por `active = 0` |
| `alias` | Mapeamento `address -> goto` | Soft delete por `active = 0` |
| `alias_handle` | Regra catch-all `handle@* -> address` | Soft delete por `active = 0` |
| `api_bans` | Politica de bloqueio | Delete semantico por `revoked_at` |
| `api_tokens` | Chaves de API operacionais | Plaintext so existe na criacao |
| `users` | Base de identidade admin e nao admin | Mesmo repositorio do auth |
| `auth_sessions` | Sessao de admins | Revogada em mudancas sensiveis |

## Regras que uma reimplementacao precisa preservar

- Exigir sessao admin valida para todo `GET /admin/*`.
- Exigir `X-CSRF-Token` para todo `POST`, `PATCH` e `DELETE` administrativo.
- Manter soft delete em `domain`, `alias`, `alias_handle` e `users`.
- Manter delete semantico em `api_bans` e `api_tokens`.
- Nao permitir colisao entre aliases e handles reservados.
- Validar bans antes de criar ou ativar dominios, aliases e handles.
- Nao enviar API token em claro fora da resposta de criacao.
- Revogar sessoes quando senha, `is_active` ou `is_admin` forem alterados.
- Proteger o ultimo admin ativo contra desativacao, despromocao e delete.
- Manter a rota separada de troca da propria senha com `reauth_required: true`.
