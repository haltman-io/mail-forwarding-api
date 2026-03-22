# Plano de Migração da API `mail-forwarding-api` para NestJS

## 1. Objetivo

Descontinuar gradualmente a infraestrutura atual em CommonJS + Express, iniciando uma nova infraestrutura moderna em TypeScript com NestJS + Express adapter, sem quebrar o core operacional da plataforma.

Este documento fecha o escopo, a arquitetura alvo, a estratégia de coexistência entre legado e novo runtime, o cenário seguro de CORS para SaaS white-label multi-domínio e o passo a passo de migração com critérios objetivos de aceite.

## 2. Decisões Travadas

### 2.1 Estratégia

- Estratégia de migração: paralela.
- Novo backend: `app-nest/`.
- Backend atual: `app/`.
- Não haverá migração big bang.
- O banco MariaDB atual será preservado na fase 1.
- O acesso a dados continuará em SQL manual na fase 1, encapsulado em adapters TypeScript do NestJS.
- Não introduzir ORM na fase 1.

### 2.2 Escopo da fase 1

Migrar somente as rotas do core público e da API por chave:

- `GET /forward/subscribe`
- `GET /forward/unsubscribe`
- `GET /forward/confirm`
- `POST /api/credentials/create`
- `GET /api/credentials/confirm`
- `GET /api/alias/list`
- `GET /api/alias/stats`
- `GET /api/activity`
- `POST /api/alias/create`
- `POST /api/alias/delete`
- `GET /domains`
- `GET /stats`
- `POST /request/ui`
- `POST /request/email`
- `GET /api/checkdns/:target`

Fora do escopo da fase 1:

- Todas as rotas `/auth/*`
- Todas as rotas `/admin/*`

### 2.3 Compatibilidade

- O contrato HTTP das rotas migradas será preservado no primeiro corte.
- Métodos, status codes, payloads, formatos de erro e headers relevantes devem permanecer compatíveis.
- Os `GET` legados com efeito colateral serão mantidos na fase 1 por compatibilidade. A correção semântica fica para uma fase posterior.

### 2.4 Roteamento em produção

- O tráfego será roteado por caminho.
- As rotas migradas apontarão para `app-nest/`.
- As rotas `/auth/*` e `/admin/*` continuarão apontando para `app/`.
- Não haverá compartilhamento de controllers ou middlewares entre os dois runtimes.

## 3. Diagnóstico da Base Atual

## 3.1 Problemas estruturais

### Controllers gordos e acoplados

Os controllers atuais concentram parsing, validação, regra de negócio, persistência, side effects, cookies, CSRF e serialização HTTP.

Principais evidências:

- `app/src/controllers/auth/auth-controller.js`
- `app/src/controllers/admin/users-controller.js`
- `app/src/controllers/forward/subscribe-controller.js`
- `app/src/controllers/forward/confirm-controller.js`
- `app/src/controllers/api/alias-controller.js`

Impacto:

- baixa testabilidade;
- alto acoplamento ao Express;
- alto risco de regressão ao trocar framework;
- repetição de regras entre endpoints.

### Camada de dados centralizada e pouco modular

O maior ponto de acoplamento é `app/src/repositories/admin-auth-repository.js`, que mistura:

- CRUD de usuários;
- leitura de sessão;
- criação de sessão;
- rotação de refresh token;
- revogação de sessão;
- retry transacional;
- validações auxiliares.

Além disso, `app/src/repositories/db.js` centraliza pool, query, transação e logging de erro em singleton global.

Impacto:

- difícil extração modular;
- difícil injeção de dependência;
- difícil troca de infraestrutura;
- repetição de padrões de retry em múltiplos repositórios.

### Configuração monolítica com side effects

`app/src/config/index.js`:

- carrega `.env`;
- normaliza dezenas de variáveis;
- valida secrets;
- lança erro no import;
- decide comportamento operacional logo no load do módulo.

Impacto:

- boot frágil;
- baixa previsibilidade em testes;
- acoplamento forte entre ambiente e runtime;
- baixa composabilidade.

### Cross-cutting concerns espalhados

Hoje a aplicação depende de middlewares e mutação manual de `req`, como:

- `req.id`
- `req.auth`
- `req.admin_auth`
- `req.api_token`

Isso aparece em:

- `app/src/middlewares/request-logger.js`
- `app/src/middlewares/auth.js`
- `app/src/middlewares/admin-auth.js`
- `app/src/middlewares/api-key.js`
- `app/src/middlewares/api-logs.js`

Impacto:

- forte dependência da ordem dos middlewares;
- sem camada transversal consistente;
- baixa portabilidade para NestJS sem redesenho.

### Validação manual e duplicada

Exemplos:

- `parsePassword` duplicado em múltiplos arquivos;
- `parsePagination` duplicado entre admin e API;
- parsing de boolean, data, email e query manual em controllers;
- aceitação simultânea de `body` e `query` em alguns `POST`.

Impacto:

- inconsistência de contrato;
- aumento de superfície de entrada;
- maior risco de divergência entre endpoints.

## 3.2 Problemas funcionais e operacionais

### Confirmações não atômicas

Há consumo de token antes da conclusão integral da operação:

- `app/src/controllers/forward/confirm-controller.js`
- `app/src/controllers/api/credentials-confirm-controller.js`

Risco:

- token consumido sem criação ou remoção final;
- usuário sem retry seguro;
- comportamento inconsistente sob falha parcial.

### CORS inseguro para cenários com credenciais

O config prepara allowlist, mas o runtime usa:

- `origin: true`
- `credentials: true`

em `app/src/app.js`.

Risco:

- reflexão aberta de origem;
- superfície ampliada em cenários com cookies;
- comportamento inseguro para SaaS multi-domínio.

### Rate limit acoplado ao Express

`app/src/middlewares/rate-limit.js` mistura:

- Redis lazy-init;
- getters dinâmicos;
- `express-rate-limit`;
- `express-slow-down`;
- fallback para memória.

Risco:

- diferença de comportamento entre ambientes;
- imprevisibilidade em múltiplas instâncias;
- migração difícil sem camada de compatibilidade.

### Build e typecheck não são reais

Hoje:

- `app/scripts/typecheck.js` é placeholder;
- `app/scripts/build.js` é placeholder;
- o checkout atual não possui `app/node_modules`;
- `npm test` e `npm run lint` não puderam validar a base.

Risco:

- ausência de gate real de qualidade;
- migração sem baseline executável suficiente.

## 4. Estratégia Segura de CORS para SaaS White-Label Multi-Domínio

O modelo atual de reflexão aberta foi uma solução de velocidade, mas não deve ser carregado para o novo runtime.

## 4.1 Cenário recomendado

O cenário correto e seguro é:

1. Resolver o tenant antes da decisão de CORS.
2. Validar o `Origin` contra uma allowlist explícita por tenant.
3. Refletir apenas a origem validada.
4. Retornar `Vary: Origin`.
5. Permitir credenciais apenas para origens cadastradas.
6. Exigir HTTPS em produção para origens autenticadas.
7. Bloquear `null`, curingas e origens não cadastradas.

## 4.2 Fonte de verdade

Criar uma fonte explícita de origens permitidas por tenant:

- tabela persistida, por exemplo `tenant_allowed_origins`;
- cache em Redis com TTL curto;
- invalidação ao atualizar tenant/domínio.

Campos mínimos por registro:

- `tenant_id`
- `origin`
- `scheme`
- `host`
- `active`
- `created_at`
- `updated_at`

Não usar wildcard por padrão.

## 4.3 Resolução de tenant

Na fase 1, o novo runtime deve resolver tenant por uma destas abordagens, nesta ordem:

1. `Origin`
2. `Host`
3. fallback operacional controlado apenas para rotas públicas específicas

O fallback nunca pode resultar em reflexão aberta.

## 4.4 Regras obrigatórias

### Para rotas públicas sem cookie

- pode haver política menos rígida;
- ainda assim, a origem deve ser validada se houver necessidade de CORS browser-facing;
- não usar `origin: true` globalmente.

### Para qualquer rota com credencial

- exigir origem explicitamente cadastrada;
- exigir HTTPS em produção;
- responder:
  - `Access-Control-Allow-Origin: <origin validada>`
  - `Access-Control-Allow-Credentials: true`
  - `Vary: Origin`

### Bloqueios obrigatórios

- `Access-Control-Allow-Origin: *` com credenciais
- reflexão aberta de origem
- `Origin: null`
- domínios não cadastrados
- tenants inativos

## 4.5 Implementação no NestJS

O NestJS não deve usar um CORS estático simples nesta fase. Deve usar uma factory assíncrona apoiada em provider de tenant e cache Redis:

- `TenantResolverService`
- `TenantOriginPolicyService`
- `CorsPolicyFactory`

Fluxo:

1. Ler `Origin` e `Host`.
2. Resolver tenant.
3. Buscar allowlist efetiva.
4. Validar a origem recebida.
5. Aplicar headers corretos.
6. Negar se inválido.

## 5. Arquitetura Alvo da Fase 1

## 5.1 Diretório novo

Criar um novo backend em:

- `app-nest/`

Estrutura alvo:

```text
app-nest/
  src/
    main.ts
    app.module.ts
    modules/
      forwarding/
      api/
      check-dns/
      domains/
      stats/
      bans/
    shared/
      config/
      logging/
      errors/
      validation/
      security/
      database/
      redis/
      tenancy/
  test/
  package.json
  tsconfig.json
  nest-cli.json
  jest.config.ts
```

## 5.2 Módulos de negócio

### `ForwardingModule`

Responsável por:

- subscribe
- unsubscribe
- confirm

Componentes:

- `ForwardingController`
- `ForwardingService`
- `ForwardingConfirmationService`
- `ForwardingPolicyService`
- adapters de repositório necessários

### `ApiModule`

Responsável por:

- credentials create
- credentials confirm
- alias list
- alias stats
- activity
- alias create
- alias delete

Componentes:

- `ApiCredentialsController`
- `ApiAliasController`
- `ApiActivityController`
- `ApiCredentialsService`
- `ApiAliasService`
- `ApiActivityService`
- `ApiKeyGuard`
- `ApiAuditInterceptor`

### `CheckDnsModule`

Responsável por:

- relay check-dns

Componentes:

- `CheckDnsController`
- `CheckDnsService`
- `CheckDnsClient`

### `DomainsModule`

Responsável por:

- `/domains`

### `StatsModule`

Responsável por:

- `/stats`

### `BanModule`

Responsável por:

- política de bans reutilizável;
- verificação por IP, domínio, email e nome;
- unificação da lógica hoje espalhada entre `ban-policy` e `bans-repository`.

## 5.3 Infraestrutura compartilhada

### `ConfigModule`

Substituir o config monolítico atual por configuração tipada segmentada:

- `app.config.ts`
- `cors.config.ts`
- `db.config.ts`
- `redis.config.ts`
- `mail.config.ts`
- `checkdns.config.ts`
- `rate-limit.config.ts`

Validação:

- schema obrigatório;
- bootstrap falha apenas em módulos que exigem determinada integração;
- evitar side effects no import.

### `DatabaseModule`

Responsabilidades:

- pool singleton injetável;
- helper transacional;
- retry transacional centralizado;
- sem singleton global acessado diretamente por `require`.

### `RedisModule`

Responsabilidades:

- cliente Redis singleton;
- cache de origins por tenant;
- suporte a rate limit;
- sem fallback silencioso para memória em produção.

### `Logging`

Substituir middlewares por:

- interceptor global de request-id e logging;
- serialização segura de contexto;
- manutenção de `x-request-id`.

### `Errors`

Substituir `error-handler` por:

- exception filter global;
- preservação do payload `{ error: ... }` nas rotas migradas.

### `Validation`

Substituir parsing manual por:

- DTOs;
- `ValidationPipe` global;
- validators customizados para:
  - mailbox
  - local part
  - domain
  - token
  - paginação

## 6. Princípios de Migração

1. Não migrar framework, SQL, contrato HTTP e semântica de negócio ao mesmo tempo.
2. Preservar o SQL na fase 1.
3. Extrair casos de uso do controller para service antes de otimizar qualquer desenho.
4. Tornar confirmações atômicas antes do go-live.
5. Formalizar contratos com testes antes do cutover.
6. Não reutilizar o design acoplado de `adminAuthRepository` para o core migrado.

## 7. Sequência de Execução

## 7.1 Etapa 0 - Baseline e inventário

Objetivo:

- congelar o comportamento atual do core.

Ações:

- mapear todas as rotas em escopo;
- mapear status codes e payloads;
- mapear headers relevantes;
- mapear side effects;
- mapear dependências por endpoint;
- registrar cenários de erro.

Entregáveis:

- matriz de rotas migradas;
- matriz de dependências por rota;
- checklist de compatibilidade.

## 7.2 Etapa 1 - Fundar `app-nest/`

Objetivo:

- subir o novo runtime sem regra de negócio.

Ações:

- inicializar NestJS com Express adapter;
- habilitar TypeScript estrito;
- configurar Jest, lint e typecheck reais;
- adicionar `@nestjs/config`, `class-validator`, `class-transformer`, `cookie-parser`, `helmet`, `rxjs`;
- estruturar módulos base.

Critério de aceite:

- aplicação sobe;
- build, lint, test e typecheck executam de verdade.

## 7.3 Etapa 2 - Infra compartilhada

Objetivo:

- remover o acoplamento transversal do Express para as rotas do core migrado.

Ações:

- implementar `ConfigModule`;
- implementar `DatabaseModule`;
- implementar `RedisModule`;
- implementar policy de CORS por tenant;
- implementar logging e request-id;
- implementar exception filter global;
- implementar guards básicos do core.

Critério de aceite:

- infraestrutura disponível por DI;
- nenhuma dependência de singleton global nas rotas migradas.

## 7.4 Etapa 3 - Módulos de baixo risco

Objetivo:

- validar o arcabouço do Nest em endpoints simples.

Ações:

- migrar `/domains`;
- migrar `/stats`;
- migrar `check-dns`.

Critério de aceite:

- paridade de resposta com o Express;
- logs e erro padronizados;
- CORS correto por tenant.

## 7.5 Etapa 4 - `ApiModule`

Objetivo:

- migrar a API key API que compõe o core.

Ações:

- portar guarda de API key;
- portar auditoria de API;
- portar credentials create e confirm;
- portar alias list, stats, activity, create e delete;
- mover regras de negócio dos controllers atuais para services.

Critério de aceite:

- paridade de payload e status;
- auditoria funcional;
- rate limits equivalentes.

## 7.6 Etapa 5 - `ForwardingModule`

Objetivo:

- migrar a lógica central de subscribe/unsubscribe/confirm.

Ações:

- portar subscribe;
- portar unsubscribe;
- unificar ban policy;
- portar confirm com operação atômica;
- isolar geração e consumo de tokens;
- manter compatibilidade do contrato HTTP.

Critério de aceite:

- criação e remoção funcionam como hoje;
- sem consumo de token fora de transação;
- sem regressão de comportamento de bans e validação.

## 7.7 Etapa 6 - Operação paralela

Objetivo:

- colocar Nest em paralelo com Express sem risco de colisão.

Ações:

- configurar gateway, reverse proxy ou balanceador por path;
- enviar apenas rotas migradas para `app-nest/`;
- manter `/auth/*` e `/admin/*` no Express;
- testar coexistência contra mesma base MariaDB e Redis.

Critério de aceite:

- ambas as aplicações coexistem;
- não há colisão de path;
- observabilidade separada por serviço.

## 7.8 Etapa 7 - Cutover controlado

Objetivo:

- concluir a adoção do NestJS para o core.

Ações:

- subir staging;
- rodar smoke tests e e2e;
- comparar respostas entre Express e Nest;
- liberar tráfego gradualmente;
- manter rollback imediato para o Express.

Critério de aceite:

- paridade funcional confirmada;
- sem regressão operacional;
- rollback validado.

## 8. Testes Obrigatórios

## 8.1 Contrato HTTP

Criar testes de contrato para todas as rotas em escopo:

- status codes;
- payloads de sucesso;
- payloads de erro;
- headers relevantes;
- comportamento de rotas legadas `GET`.

## 8.2 E2E real

Cobrir com banco e Redis reais:

- subscribe com sucesso;
- unsubscribe com sucesso;
- confirm válido;
- confirm inválido;
- confirm expirado;
- alias já existente;
- alias reservado;
- bans por IP, domínio, email e nome;
- create credentials;
- confirm credentials;
- API key inválida;
- API key expirada;
- check-dns com 2xx, 4xx, 5xx e timeout;
- domains e stats.

## 8.3 Segurança

Cobrir:

- CORS com origin válida;
- CORS com origin inválida;
- CORS com tenant inativo;
- bloqueio de `null` origin;
- bloqueio de origem não cadastrada;
- preservação de `Vary: Origin`;
- rate limit por IP, token e chave.

## 8.4 Qualidade

O novo backend deve possuir gates reais:

- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run typecheck`

## 9. Critérios de Aceite da Fase 1

A fase 1 só é considerada concluída quando:

- todas as rotas em escopo estiverem no NestJS;
- `/auth/*` e `/admin/*` continuarem operando no Express sem impacto;
- o contrato das rotas migradas for compatível;
- CORS por tenant estiver seguro e sem reflexão aberta;
- confirmações por token forem atômicas;
- build, lint, test e typecheck forem reais;
- o novo runtime estiver livre de CommonJS;
- houver estratégia de rollback documentada e testada.

## 10. Riscos e Mitigações

### Risco: regressão por trocar framework e regra ao mesmo tempo

Mitigação:

- manter SQL atual;
- preservar contratos;
- migrar por módulos;
- usar testes de contrato.

### Risco: CORS inseguro continuar no novo runtime

Mitigação:

- allowlist explícita por tenant;
- Redis cache;
- sem `origin: true`.

### Risco: inconsistência entre Express e Nest

Mitigação:

- roteamento por path;
- staging paralelo;
- comparação de respostas;
- rollback imediato.

### Risco: perda de confirmação por falha parcial

Mitigação:

- transação atômica em fluxos de confirmação;
- retry seguro;
- testes de falha parcial.

## 11. Fase 2 Posterior

Fora do escopo atual, mas prevista:

- migrar `/auth/*`;
- migrar `/admin/*`;
- remover `GET` com mutação de estado;
- revisar semântica HTTP;
- reduzir dívidas preservadas por compatibilidade;
- avaliar introdução de abstrações adicionais na camada de dados, se ainda fizer sentido.

## 12. Conclusão

O caminho seguro não é reescrever toda a API atual de uma vez. O caminho seguro é:

- preservar o legado fora do core imediato;
- fundar um novo backend NestJS isolado;
- migrar somente o core público e a API por chave na fase 1;
- corrigir definitivamente o modelo de CORS para white-label multi-domínio;
- validar paridade por testes e coexistência operacional antes de cortar tráfego.

Esse é o menor caminho com risco controlado para sair de CommonJS + Express e entrar em TypeScript + NestJS sem interromper o negócio.

## 13. Estado Atual da Execução

Status consolidado em 21 de março de 2026.

## 13.1 O que já foi executado

### Fundação do novo runtime

O backend `app-nest/` já foi criado e está funcional como aplicação NestJS isolada.

Componentes já criados:

- `app-nest/package.json`
- `app-nest/tsconfig.json`
- `app-nest/tsconfig.build.json`
- `app-nest/nest-cli.json`
- `app-nest/jest.config.ts`
- `app-nest/eslint.config.mjs`
- `app-nest/src/main.ts`
- `app-nest/src/app.module.ts`

O novo runtime já sobe com:

- NestJS + Express adapter;
- TypeScript ESM;
- `ValidationPipe` global;
- `helmet`;
- `trust proxy`;
- serialização de `bigint` para string no JSON;
- `x-request-id`;
- logging estruturado;
- exception filter global;
- CORS delegado por factory;
- shutdown hooks.

### Infraestrutura compartilhada já implementada

Já existem módulos e serviços compartilhados para a nova base:

- `shared/config`
- `shared/database`
- `shared/redis`
- `shared/logging`
- `shared/errors`
- `shared/security`
- `shared/validation`
- `shared/tenancy`

Itens já implementados:

- `ConfigModule` global com:
  - `app.config.ts`
  - `cors.config.ts`
  - `database.config.ts`
  - `redis.config.ts`
  - `check-dns.config.ts`
  - `smtp.config.ts`
  - `api-credentials.config.ts`
  - `forwarding.config.ts`
  - validação em `env.validation.ts`
- `DatabaseModule` com pool MariaDB injetável e helper transacional;
- `RedisModule` com cliente Redis injetável;
- `AppLogger`;
- `RequestContextMiddleware`;
- `HttpExceptionFilter`;
- `CorsPolicyFactory`;
- `TenantOriginPolicyService`;
- `IpBanMiddleware`;
- validação de target de domínio;
- guard para `application/json`;
- utilitários compartilhados: `sha256Buffer`, `packIp16`, `generateConfirmationCode`, `normalizeConfirmationCode`, `isConfirmationCodeValid`, `buildEmailSubject`, `parseMailbox`, `isValidLocalPart`, `isValidDomain`, `normalizeLowerTrim`, `normalizeDomainTarget`.

### Módulos já migrados

#### Módulos de baixo risco (etapa 3 do plano)

- `DomainsModule`
- `StatsModule`
- `CheckDnsModule`
- `BansModule`

Rotas portadas:

- `GET /domains`
- `GET /stats`
- `POST /request/ui`
- `POST /request/email`
- `GET /api/checkdns/:target`

#### ApiModule (etapa 4 do plano)

Migração completa da API autenticada por chave. Todos os componentes portados fielmente do legado.

Arquivos criados:

- `modules/api/api.module.ts` — módulo NestJS; importa `BansModule` e `DomainsModule`
- `modules/api/api-credentials.controller.ts` — `POST /api/credentials/create`, `GET /api/credentials/confirm`
- `modules/api/api-alias.controller.ts` — `GET /api/alias/list`, `GET /api/alias/stats`, `GET /api/activity`, `POST /api/alias/create`, `POST /api/alias/delete`
- `modules/api/guards/api-key.guard.ts` — `CanActivate` guard; extrai `X-API-Key` do header, valida formato `/^[a-z0-9]{64}$/`, hash SHA-256, busca token ativo na tabela `api_tokens`, anexa `{ id, owner_email }` ao `request.api_token`; fire-and-forget `touchLastUsed`
- `modules/api/interceptors/api-log.interceptor.ts` — `NestInterceptor`; insere log fire-and-forget na tabela `api_logs` com token info, rota, body, IP, user-agent
- `modules/api/services/api-credentials-email.service.ts` — fluxo completo de envio de email para solicitação de API key; cooldown, rate limit por sends, geração de token, persistência via `upsertPendingByEmailTx`, envio SMTP com template HTML+texto
- `modules/api/repositories/api-tokens.repository.ts` — tabela `api_tokens`: `getActiveByTokenHash`, `createToken`, `touchLastUsed`
- `modules/api/repositories/api-token-requests.repository.ts` — tabela `api_token_requests`: `upsertPendingByEmailTx` (com retry transacional para deadlock/lock timeout, cooldown, rate limit por send_count, rotação de token), `getPendingByTokenHash`, `markConfirmedById`
- `modules/api/repositories/alias.repository.ts` — tabela `alias` + `alias_handle`: `listByGoto`, `countByGoto`, `getStatsByGoto`, `getByAddress`, `existsByAddress`, `existsReservedHandle`, `createIfNotExists` (transacional com `FOR UPDATE`), `deleteByAddress`
- `modules/api/repositories/api-logs.repository.ts` — tabela `api_logs`: `insert`
- `modules/api/repositories/activity.repository.ts` — `UNION` entre `api_logs` e `email_confirmations`: `listByOwner`

Rotas portadas:

- `POST /api/credentials/create`
- `GET /api/credentials/confirm`
- `GET /api/alias/list`
- `GET /api/alias/stats`
- `GET /api/activity`
- `POST /api/alias/create`
- `POST /api/alias/delete`

Configuração adicionada:

- `shared/config/smtp.config.ts` — `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_AUTH_ENABLED`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_HELO_NAME`, `SMTP_TLS_REJECT_UNAUTHORIZED`
- `shared/config/api-credentials.config.ts` — `API_CREDENTIALS_CONFIRM_ENDPOINT`, `API_CREDENTIALS_EMAIL_TTL_MINUTES`, `API_CREDENTIALS_EMAIL_RESEND_COOLDOWN_SECONDS`, `API_CREDENTIALS_EMAIL_MAX_SENDS`, `API_CREDENTIALS_EMAIL_SUBJECT`, `DEFAULT_ALIAS_DOMAIN`

Dependências npm adicionadas:

- `nodemailer` (envio de email SMTP)
- `string-format` (interpolação de templates de subject)
- `@types/nodemailer` (devDependency)

Extensão de tipos:

- `types/express.d.ts` — `Request.api_token?: { id: number; owner_email: string }`
- `types/string-format.d.ts` — declaração de módulo para `string-format`

#### ForwardingModule (etapa 5 do plano)

Migração completa dos fluxos de subscribe, unsubscribe e confirm. Todos os componentes portados fielmente do legado, preservando integralmente todas as regras de segurança e validação.

Arquivos criados:

- `modules/forwarding/forwarding.module.ts` — módulo NestJS; importa `BansModule` e `DomainsModule`; declara `AliasRepository` como provider local (mesma classe do `ApiModule`, instância separada; possível porque `AliasRepository` é stateless e depende apenas de `DatabaseService` global)
- `modules/forwarding/forwarding.controller.ts` — controller único com os 3 endpoints (`GET /forward/subscribe`, `GET /forward/unsubscribe`, `GET /forward/confirm`)
- `modules/forwarding/repositories/email-confirmations.repository.ts` — tabela `email_confirmations` (separada da tabela `api_token_requests` usada pelo `ApiModule`)
- `modules/forwarding/services/email-confirmation.service.ts` — fluxo completo de envio de email de confirmação para forwarding

**Detalhamento do `ForwardingController`:**

`GET /forward/subscribe`:
- Aceita parâmetros via query string: `to` (obrigatório), `name`, `domain`, `address`
- Dois modos: por `address` completo (intent `subscribe_address`) ou por `name` + `domain` (intent `subscribe`)
- Se `address` fornecido, `name` e `domain` não podem estar presentes simultaneamente
- Se `name` + `domain`: fallback para `DEFAULT_ALIAS_DOMAIN` se `domain` não informado
- Validação de `to` via `parseMailbox()` (RFC 5322 dot-atom + DNS strict)
- Validação de `name` via `isValidLocalPart()` (dot-atom, max 64)
- Validação de `domain` via `isValidDomain()` (DNS strict, TLD >= 2 letras)
- Ban checks (todos via `BanPolicyService`): nome do alias, domínio do alias, email/domínio de destino
- Verificação de domínio ativo no banco (somente para modo `name` + `domain`, não para `address`)
- Verificação de alias já existente (`existsByAddress`)
- Verificação de handle reservado (`existsReservedHandle` na tabela `alias_handle`)
- Verificação de destino não ser um alias existente (anti-loop)
- Verificação de destino não usar domínio gerenciado (anti-loop via `domainSuffixes`)
- Verificação de destino diferente do alias (auto-referência)
- Envio de email de confirmação via `EmailConfirmationService`
- Resposta: `{ ok, action: "subscribe", alias_candidate, to, confirmation: { sent, ttl_minutes } }`

`GET /forward/unsubscribe`:
- Aceita parâmetro `alias` via query string
- Parsing loose do email (não exige validação estrita do local-part no parsing, mas valida depois separadamente)
- Validação individual de local-part e domínio após split
- Ban check de IP do cliente (via `BanPolicyService.findActiveIpBan`)
- Busca do alias no banco e verificação de existência e estado ativo
- Extração e validação do `goto` email do alias
- Ban check do email goto (email exato + sufixos de domínio via `findActiveEmailOrDomainBan`)
- Formato de resposta de ban diferente do subscribe: `{ error: "banned", type: "ip"|"email"|"domain", value? }` (preservado fielmente do legado)
- Envio de email de confirmação com intent `unsubscribe`
- Resposta: `{ ok, action: "unsubscribe", alias, sent, reason?, ttl_minutes }`

`GET /forward/confirm`:
- Aceita parâmetro `token` via query string (6 dígitos)
- Normalização e validação do código de confirmação
- Hash SHA-256 do token → busca na tabela `email_confirmations`
- Marca confirmação como `confirmed` ANTES da operação final (comportamento legado não-atômico preservado — a correção para transação atômica é um item pendente separado)
- Extrai `email`, `intent`, `alias_name`, `alias_domain` do registro pendente
- Para `intent = "unsubscribe"`: busca alias, verifica que o `goto` não mudou (proteção contra owner change), deleta alias
- Para `intent = "subscribe"` ou `"subscribe_address"`: verifica domínio ativo (somente para `subscribe`, não para `subscribe_address`), ban checks (nome, domínio, destino), verifica alias existente (retorna `created: false` se já existe), verifica handle reservado, cria alias via `createIfNotExists`
- Respostas de sucesso incluem `{ ok: true, confirmed: true, intent, ... }`

**Detalhamento do `EmailConfirmationService`:**

- Normaliza email de destino
- Carrega configuração de forwarding (TTL, cooldown, endpoint, templates de subject)
- Verifica cooldown: busca pending ativo para o email; se `last_sent_at` + cooldown > agora, retorna `{ sent: false, reason: "cooldown" }`
- Gera código de confirmação (6 dígitos via `crypto.randomInt`)
- Se pending existe: rotaciona token (`rotateTokenForPending` — atualiza hash, TTL, incrementa send_count)
- Se não existe: cria novo pending (`createPending` — dentro de transação, expira pendentes antigos antes de inserir)
- Resolve URL base de confirmação: tenta extrair domínio do header `Origin` ou `Referer`; se o domínio pertence a um domínio gerenciado ativo (cache in-memory com TTL de 10s via `listActiveNames`), usa a origem do header; caso contrário, fallback para `APP_PUBLIC_URL`
- Constrói URL de confirmação: `{baseUrl}{endpoint}?token={token}`
- Extrai hostname do tenant para o template de subject e cabeçalho do email
- Seleciona template de subject por intent (subscribe vs unsubscribe, com fallback para template genérico)
- Constrói email em texto puro e HTML (mesmo template visual do legado: dark theme, OTP-friendly, preheader para iOS, code block com ação SQL)
- Envia via nodemailer com transporte SMTP criado sob demanda

**Detalhamento do `EmailConfirmationsRepository`:**

Tabela: `email_confirmations`

Colunas usadas: `id`, `email`, `token_hash` (BINARY(32)), `status` (pending|confirmed|expired), `created_at`, `expires_at`, `confirmed_at`, `request_ip` (VARBINARY(16) via `packIp16`), `user_agent`, `send_count`, `last_sent_at`, `attempts_confirm`, `intent`, `alias_name`, `alias_domain`

Métodos:

- `getActivePendingByEmail(email)` — busca pending não-expirado por email; `ORDER BY id DESC LIMIT 1`
- `createPending(payload)` — transação: expira pendings antigos do email, insere novo, retorna row inserido; valida alias_name (`isValidLocalPart`), alias_domain (`isValidDomain`), intent (max 32 chars), TTL (1..1440 min), tokenHash (Buffer 32 bytes)
- `rotateTokenForPending(payload)` — atualiza token_hash, TTL, IP, user_agent, incrementa send_count; `WHERE email = ? AND status = 'pending' AND expires_at > NOW(6) ORDER BY id DESC LIMIT 1`
- `getPendingByTokenHash(tokenHash32)` — busca por hash do token, status pending, não expirado
- `markConfirmedById(id)` — atualiza status para `confirmed`, seta `confirmed_at`; `WHERE status = 'pending' AND expires_at > NOW(6)`

Configuração adicionada:

- `shared/config/forwarding.config.ts` — `EMAIL_CONFIRM_ENDPOINT` (default `/forward/confirm`), `EMAIL_CONFIRMATION_TTL_MINUTES` (default 10), `EMAIL_CONFIRMATION_RESEND_COOLDOWN_SECONDS` (default 60), `EMAIL_CONFIRMATION_SUBJECT`, `EMAIL_CONFIRMATION_SUBJECT_SUBSCRIBE`, `EMAIL_CONFIRMATION_SUBJECT_UNSUBSCRIBE`

Arquivos modificados durante a migração do ForwardingModule:

- `shared/validation/mailbox.ts` — exportação de `MAX_EMAIL_LENGTH` (era const interna, agora exportada para uso no `parseEmailLoose` do unsubscribe)
- `modules/api/repositories/alias.repository.ts` — adicionado método `existsByAddress(address): Promise<boolean>` (SELECT 1 sem filtro de active, verifica existência independente do status)
- `shared/config/index.ts` — adicionada exportação de `forwardingConfig`
- `app.module.ts` — adicionados `ForwardingModule` aos imports e `forwardingConfig` ao array `load` do `ConfigModule`

Rotas portadas:

- `GET /forward/subscribe`
- `GET /forward/unsubscribe`
- `GET /forward/confirm`

## 13.2 Compatibilidade já preservada

Os seguintes comportamentos do legado já foram reproduzidos no `app-nest/`:

### Módulos de baixo risco

- `GET /domains` continua retornando `string[]`;
- `GET /stats` continua retornando `{ domains, aliases }`;
- `POST /request/ui` e `POST /request/email` continuam exigindo `application/json`;
- `GET /api/checkdns/:target` continua normalizando e validando target de domínio;
- respostas de erro seguem no formato `{ error: ... }`;
- bloqueio de IP banido ocorre antes da execução dos handlers;
- banimento de domínio continua sendo aplicado no relay do check-dns;
- relay do upstream continua preservando `status` e payload do serviço externo;
- timeout do relay continua mapeado para erro de infraestrutura.
- `/domains` e `/stats` continuam com cache local em memória por processo;
- o header `Cache-Control` é aplicado apenas em cache miss, reproduzindo o comportamento legado atual.

### ApiModule

- `POST /api/credentials/create` aceita parâmetros tanto de `body` quanto de `query` (compatibilidade com legado);
- `GET /api/credentials/confirm` valida token de 6 dígitos, hash SHA-256, busca pending, gera API key de 64 chars hex;
- `ApiKeyGuard` valida `X-API-Key` com formato exato `/^[a-z0-9]{64}$/`;
- erros de autenticação preservados: `missing_api_key` (401), `invalid_api_key_format` (401), `invalid_or_expired_api_key` (401);
- auditoria via `ApiLogInterceptor` é fire-and-forget (nunca bloqueia a request);
- `tx_busy` mapeado para 503 `temporarily_unavailable`;
- formato de sucesso `{ ok: true, ... }` e erro `{ error: "code" }` preservados em todos os endpoints;
- retry transacional com backoff aleatório para deadlock/lock timeout (até 2 retries);
- cooldown e rate limit por `send_count` no upsert de token requests.

### ForwardingModule

- `GET /forward/subscribe` preserva os dois modos de operação (por `address` vs `name+domain`) e todos os 12 pontos de validação/rejeição do legado, incluindo anti-loop por domínio gerenciado e por alias existente;
- `GET /forward/unsubscribe` preserva o formato de resposta de ban diferenciado (`{ type: "ip"|"email"|"domain" }`) distinto do formato usado no subscribe (`{ ban: banRow }`);
- `GET /forward/confirm` preserva o fluxo não-atômico do legado (marca `confirmed` antes da operação final) — a correção para transação atômica é item pendente;
- confirmação de unsubscribe verifica que o `goto` não mudou entre solicitação e confirmação (proteção contra owner change);
- resolução de URL de confirmação usa `Origin`/`Referer` quando o domínio é gerenciado, com fallback para `APP_PUBLIC_URL`;
- cache in-memory de domínios ativos com TTL de 10 segundos para resolução de URL;
- template de email HTML preservado identicamente (dark theme, OTP-friendly, preheader para iOS, code block SQL);
- cooldown de reenvio respeitado (default 60 segundos entre reenvios para o mesmo email).

## 13.3 Qualidade já validada

No `app-nest/`, os gates de qualidade deixaram de ser placeholders e já executam de verdade.

Validação já realizada localmente:

- `npm install`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run lint`

Resultado atual:

- todos os comandos acima passaram com sucesso no `app-nest/`.

Testes já existentes:

- `app-nest/test/domain-target.spec.ts`
- `app-nest/test/origin.utils.spec.ts`

Esses testes ainda são de fundação/utilitários, não de contrato HTTP nem e2e real.

## 13.4 O que ainda falta para a fase 1

### Módulos ainda não migrados

Todos os módulos do escopo da fase 1 já foram portados para `app-nest/`. Não há mais módulos, controllers ou endpoints pendentes de migração dentro do escopo desta fase.

### Infraestrutura ainda pendente

Ainda não foi implementado no novo runtime:

- rate limiting compatível com o legado para todas as rotas migradas;
- rate limiting distribuído via Redis no Nest;
- resolução de tenant por fonte persistida;
- allowlist de origins por tenant em banco + cache Redis;
- cache Redis de origins por tenant;
- testes de contrato HTTP para todas as rotas migradas;
- testes e2e reais com MariaDB e Redis;
- comparação automatizada entre Express e Nest para as rotas já migradas;
- roteamento paralelo por path entre `app/` e `app-nest/`;
- staging, smoke tests, cutover gradual e rollback validado.

### Regras críticas ainda pendentes

Ainda faltam as correções mais sensíveis da fase 1:

- tornar atômico o fluxo de `GET /forward/confirm` (hoje marca `confirmed` antes de executar a operação final; se a operação falhar após a confirmação, o token é consumido sem efeito);
- tornar atômico o fluxo de `GET /api/credentials/confirm` (mesma questão).

## 13.5 Observações importantes do estado atual

### Pendências validadas no código

As pendências abaixo não são apenas itens de planejamento; elas já foram confirmadas no código atual do repositório:

- `app-nest/src/modules/forwarding/forwarding.controller.ts` ainda chama `markConfirmedById(...)` antes da operação final de subscribe/unsubscribe em `GET /forward/confirm`;
- `app-nest/src/modules/api/api-credentials.controller.ts` ainda chama `markConfirmedById(...)` antes da criação definitiva da API key em `GET /api/credentials/confirm`;
- `app-nest/src/shared/tenancy/tenant-origin-policy.service.ts` ainda resolve origins permitidas a partir de configuração carregada no boot, sem fonte persistida por tenant;
- não existe, no `app-nest/`, uma camada ativa de rate limiting equivalente à que hoje está concentrada em `app/src/middlewares/rate-limit.js`;
- a suíte atual do `app-nest/test/` ainda contém apenas `domain-target.spec.ts` e `origin.utils.spec.ts`, portanto ainda não cobre contrato HTTP nem e2e real;
- não há evidência, nesta rodada, de configuração operacional versionada para roteamento paralelo por path entre `app/` e `app-nest/`.

### CORS

O novo runtime já não usa reflexão aberta de origem.

Estado atual do CORS no `app-nest/`:

- já existe `CorsPolicyFactory`;
- já existe `TenantOriginPolicyService`;
- já existe normalização de origins;
- o allowlist atual ainda é baseado em configuração (`CORS_ALLOWED_ORIGINS` e `APP_PUBLIC_URL`);
- ainda não existe, nesta rodada, resolução completa por tenant persistido em banco.

Ou seja:

- o estado atual já é mais seguro que o Express legado;
- mas ainda não é a implementação final do modelo white-label por tenant planejado no documento.

### Redis

O módulo Redis já existe, mas ainda não está sendo usado para:

- cache de origins por tenant;
- rate limit distribuído;
- sincronização de cache público.

### Testes

Os testes atuais do `app-nest/` validam fundação e utilitários.

Ainda faltam:

- testes de contrato HTTP;
- testes e2e reais;
- comparação automatizada entre Express e Nest para as rotas já migradas.

### Escopo preservado

Continuam fora do escopo desta fase, sem alterações no legado:

- `/auth/*`
- `/admin/*`

### Decisão de compartilhamento do AliasRepository

O `AliasRepository` (`modules/api/repositories/alias.repository.ts`) é usado tanto pelo `ApiModule` quanto pelo `ForwardingModule`. Em vez de criar um módulo compartilhado ou exportar entre módulos, optou-se por declarar `AliasRepository` como provider local em ambos os módulos. Isso é possível porque:

- `AliasRepository` é stateless (não mantém cache ou estado);
- depende apenas de `DatabaseService`, que é global;
- cada módulo obtém sua própria instância, sem risco de conflito;
- evita acoplamento entre `ApiModule` e `ForwardingModule`.

Se no futuro for necessário compartilhar estado (ex: cache de alias), essa decisão deve ser revisada criando um `AliasModule` dedicado.

## 13.6 Próximo corte recomendado

Todos os módulos de negócio da fase 1 já foram migrados. A próxima etapa é focar em infraestrutura transversal e hardening:

1. Tornar atômicos os fluxos de confirm (`/forward/confirm` e `/api/credentials/confirm`).
2. Implementar rate limiting compatível com o legado (Redis store, fallback para memória).
3. Implementar testes de contrato HTTP para todas as rotas migradas, incluindo comparação automatizada entre Express e Nest.
4. Implementar testes e2e reais com banco e Redis.
5. Configurar roteamento paralelo por path entre `app/` e `app-nest/`.
6. Staging, smoke tests, cutover controlado e validação de rollback.

## 13.7 Estado objetivo da migração

Resumo executivo do que existe hoje:

- fase 1 iniciada: sim;
- `app-nest/` criado: sim;
- runtime Nest funcional: sim;
- módulos da fase 1 concluídos: sim;
- gates reais de qualidade no novo runtime: sim;
- endpoints simples migrados: sim;
- API core por chave migrada: sim;
- forwarding migrado: sim;
- rate limiting migrado: não;
- confirmações atômicas: não;
- CORS por tenant persistido em banco + Redis: não;
- testes de contrato HTTP: não;
- testes e2e reais: não;
- roteamento paralelo configurado: não;
- hardening operacional concluído: não;
- readiness de produção da fase 1: não;
- auth/admin migrados: não (fora do escopo da fase 1);
- fase 1 concluída: não (faltam rate limiting, atomicidade, testes e2e, staging).

## 13.8 Resultado final validado

O estado acima representa um snapshot historico anterior ao fechamento operacional final.

Use `@MIGRATION/RESULTS.md` como fonte de verdade do resultado validado da fase 1.
