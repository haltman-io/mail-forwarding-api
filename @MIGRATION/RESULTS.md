# Resultados Da Migracao Fase 1

Data de fechamento: 2026-03-21

## Decisao Final

- Status final: `GO`
- Fechamento recomendado:
  - `GO: o app-nest passou em todos os testes definidos, esta aprovado para cutover e a UI white-label opera em same-origin via proxy reverso, sem dependencia de CORS central em mail.haltman.io.`

## Fonte De Verdade

- Este arquivo passa a ser a fonte de verdade do fechamento operacional da fase 1.
- Os snapshots historicos de pendencias em `@MIGRATION/MIGRATION.md` devem ser lidos como estado anterior a validacao final.
- O runbook usado para a validacao esta em `GUIA_VALIDACAO_FINAL_APP_NEST.md`.

## Escopo Validado

- Rotas migradas para o `app-nest` validadas com sucesso:
  - `GET /domains`
  - `GET /stats`
  - `GET /forward/subscribe`
  - `GET /forward/unsubscribe`
  - `GET /forward/confirm`
  - `POST /request/ui`
  - `POST /request/email`
  - `GET /api/checkdns/:target`
  - `POST /api/credentials/create`
  - `GET /api/credentials/confirm`
  - `GET /api/alias/list`
  - `GET /api/alias/stats`
  - `GET /api/activity`
  - `POST /api/alias/create`
  - `POST /api/alias/delete`
- Continuam fora do escopo desta fase:
  - `/auth/*`
  - `/admin/*`

## Evidencias Consolidadas

- Os gates locais do `app-nest` foram executados com sucesso:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`
  - `npm run lint`
- O `app-nest` respondeu corretamente a todos os testes previstos no runbook final.
- Os fluxos reais com MariaDB, Redis, SMTP, check-dns, gateway e rollback passaram sem regressao identificada.
- O path routing e o rollback operacional foram validados.
- O front-end white-label nao manteve rastros de chamadas absolutas para `https://mail.haltman.io`.
- Os dominios white-label passaram a operar em same-origin via proxy reverso no Caddy, removendo a dependencia operacional de allowlist CORS central para o fluxo normal da UI.

## Conclusao Tecnica

- O `app-nest` esta aprovado para assumir as rotas migradas da fase 1.
- A preocupacao anterior com CORS centralizado deixou de ser bloqueadora para a UI white-label porque os dominios agora chamam a si mesmos e o Caddy faz o proxy interno para o backend.
- Nao restou bloqueador tecnico aberto para o cutover da fase 1 dentro do escopo validado.

## Observacoes

- Este fechamento nao altera o fato de que `/auth/*` e `/admin/*` continuam fora do escopo da fase 1.
- Se no futuro a arquitetura voltar a depender de chamadas cross-origin entre dominios white-label e um host central de API, o modelo de allowlist dinamica por tenant volta a ser relevante.
