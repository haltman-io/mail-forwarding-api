# Guia de Validacao Final da Migracao `app` -> `app-nest`

## 1. Objetivo

- Este guia existe para validar, com evidencias objetivas, se as rotas migradas para `app-nest/` estao prontas para conviver com o legado `app/`, receber trafego por path routing e suportar rollback imediato.
- Este guia nao depende de acesso meu a infraestrutura. Ele foi escrito para ser executado por quem possui acesso ao ambiente real, ao banco, ao Redis, ao SMTP e ao gateway.
- A conclusao correta no fim deste guia e sempre uma destas tres:
  - `GO`: tudo que e obrigatorio passou.
  - `GO COM RESSALVA EXPLICITA`: tudo passou, exceto um gap conhecido que foi conscientemente aceito.
  - `NO-GO`: houve falha tecnica, divergencia funcional, falha operacional ou ausencia de evidencia.

## 2. Escopo que deve ir para o `app-nest`

- Considere como migrado para o Nest:
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
- Considere fora do escopo desta migracao e ainda no legado:
  - `/auth/*`
  - `/admin/*`

## 3. Pontos que nao podem passar batido

- O Nest ja tem testes automatizados para atomicidade e rate limit, mas isso nao substitui validacao com MariaDB, Redis, SMTP, check-dns e gateway reais.
- O token de confirmacao de e-mail e armazenado apenas como hash no banco. Sem capturar o e-mail real, nao existe como reconstruir o token depois.
- A API key gerada em `GET /api/credentials/confirm` aparece em texto puro apenas na resposta HTTP da confirmacao. Depois disso, o banco guarda apenas `token_hash`.
- O CORS atual no Nest ainda e baseado em configuracao, nao em fonte persistida por tenant. Se o criterio de aceite exigir `origins por tenant em banco + cache Redis`, o resultado final continua `NO-GO` ate essa diferenca ser aceita formalmente.
- Existe divergencia de nome de variavel de ambiente para o link de confirmacao de forwarding:
  - legado `app/`: `EMAIL_CONFIRM_CONFIRM_ENDPOINT`
  - Nest `app-nest/`: `EMAIL_CONFIRM_ENDPOINT`
- Se essas duas variaveis nao forem alinhadas para o mesmo path publico, o e-mail pode sair com link apontando para rota errada.
- Nao existe configuracao de proxy/gateway versionada neste repositorio. A validacao de path routing e rollback depende da configuracao real do ambiente.

## 4. Pre-requisitos obrigatorios

- Tenha acesso a:
  - MariaDB com o schema usado pelo `base-postfix-forwarder`
  - Redis
  - SMTP real ou Mailpit/Mailhog/Maildev
  - servico `check-dns`
  - gateway ou reverse proxy que fara o roteamento por path
  - logs do gateway e logs das apps
- Tenha um dominio ativo no banco que possa ser usado para criar aliases de teste.
- Tenha pelo menos dois enderecos de e-mail de teste:
  - um destinatario para forwarding, por exemplo `qa-forward@example.com`
  - um dono de API key, por exemplo `qa-api@example.com`
- Tenha um cliente SQL e um cliente Redis.
- Tenha Node.js 20+ instalado.

## 5. Preparacao do ambiente

- Prepare dois ambientes lado a lado:
  - `app/` em uma porta
  - `app-nest/` em outra porta
- Use portas diferentes para evitar colisao. Exemplo:
  - `app/` em `127.0.0.1:8080`
  - `app-nest/` em `127.0.0.1:8081`
- Garanta que as duas apps apontem para o mesmo MariaDB, o mesmo Redis, o mesmo SMTP e o mesmo check-dns quando a comparacao exigir paridade real.
- Garanta que `APP_PUBLIC_URL` aponte para a URL publica correta do ambiente que esta sendo validado:
  - teste direto: pode apontar para a URL direta da instancia
  - teste via gateway: deve apontar para a URL publica do gateway
- Ajuste `TRUST_PROXY` conforme o numero real de hops entre cliente e Node.
- Alinhe os links de confirmacao:
  - em `app/`, configure `EMAIL_CONFIRM_CONFIRM_ENDPOINT=/forward/confirm`
  - em `app-nest/`, configure `EMAIL_CONFIRM_ENDPOINT=/forward/confirm`
  - configure `API_CREDENTIALS_CONFIRM_ENDPOINT=/api/credentials/confirm`
- Se quiser acelerar teste de rate limit em homologacao, reduza temporariamente os limites e restaure ao final. Se fizer isso, registre no relatorio exatamente quais valores foram usados.

## 6. Variaveis minimas que devem estar corretas

- Em ambos os runtimes, valide pelo menos:
  - `APP_HOST`
  - `APP_PORT`
  - `APP_PUBLIC_URL`
  - `TRUST_PROXY`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_FROM`
  - `MARIADB_HOST`
  - `MARIADB_PORT`
  - `MARIADB_USER`
  - `MARIADB_PASSWORD`
  - `MARIADB_DATABASE`
  - `REDIS_URL`
  - `CHECKDNS_BASE_URL`
  - `CHECKDNS_TOKEN`
- No Nest, sem estes valores, a aplicacao nem deve ser considerada pronta para subir de forma valida.
- Se a intencao for reproduzir comportamento distribuido de rate limit, `REDIS_URL` nao pode ficar vazio.

## 7. Comandos de qualidade locais

- Rode primeiro os gates do legado:

```powershell
cd app
npm ci
npm run typecheck
npm run build
npm run test
npm run lint
```

- Rode depois os gates do Nest:

```powershell
cd app-nest
npm ci
npm run typecheck
npm run build
npm run test
npm run lint
```

- O resultado esperado e:
  - exit code `0` em todos os comandos
  - nenhum erro de TypeScript
  - nenhum teste falhando
  - nenhum warning tratado como erro no lint
- Conclusao desta etapa:
  - `PASSA` se todos os comandos terminarem com sucesso
  - `NO-GO` se qualquer comando falhar

## 8. O que os testes automatizados do Nest ja cobrem

- O suite do `app-nest/test/` ja cobre:
  - confirmacao atomica de `GET /api/credentials/confirm`
  - rollback sem consumir token quando a criacao da API key falha
  - confirmacao atomica de `GET /forward/confirm`
  - nao consumo do token quando validacoes de unsubscribe falham
  - rate limiting por token e por API key
- Estes testes ainda nao provam:
  - SMTP real
  - MariaDB real com schema real
  - Redis real em multi-instancia
  - path routing real
  - rollback operacional real

## 9. Subida das duas aplicacoes lado a lado

- Em um terminal, suba o legado:

```powershell
cd app
npm run dev
```

- Em outro terminal, suba o Nest:

```powershell
cd app-nest
npm run start:dev
```

- Verifique no startup:
  - nenhuma app termina com erro
  - nenhuma app acusa falha de conexao com MariaDB
  - nenhuma app acusa falha fatal de configuracao
  - no Nest, o processo deve logar `server.listening`
- Conclusao desta etapa:
  - `PASSA` se ambas sobem limpas e aceitam conexoes
  - `NO-GO` se qualquer uma cair no startup

## 10. Smoke basico direto no Nest

- Teste `GET /domains`:

```powershell
curl.exe -i http://127.0.0.1:8081/domains
```

- Verifique:
  - status `200`
  - body JSON valido
  - header `Cache-Control: public, max-age=10` quando a resposta nao vier de cache interno

- Teste `GET /stats`:

```powershell
curl.exe -i http://127.0.0.1:8081/stats
```

- Verifique:
  - status `200`
  - body JSON com contadores
  - header `Cache-Control: public, max-age=60` quando a resposta nao vier de cache interno

- Teste `POST /request/ui` com content-type correto:

```powershell
curl.exe -i ^
  -H "content-type: application/json" ^
  -d "{\"target\":\"example.com\"}" ^
  http://127.0.0.1:8081/request/ui
```

- Teste `POST /request/email` com content-type correto:

```powershell
curl.exe -i ^
  -H "content-type: application/json" ^
  -d "{\"target\":\"example.com\"}" ^
  http://127.0.0.1:8081/request/email
```

- Teste `GET /api/checkdns/:target`:

```powershell
curl.exe -i http://127.0.0.1:8081/api/checkdns/example.com
```

- Verifique em todos os tres endpoints de check-dns:
  - nenhuma resposta `5xx`
  - `415` quando `content-type` estiver errado nos POSTs
  - `400` quando o `target` for invalido
  - status e payload coerentes com o upstream quando o target for valido
- Conclusao desta etapa:
  - `PASSA` se o Nest responder corretamente e sem `5xx`
  - `NO-GO` se o Nest cair, travar ou divergir claramente do contrato esperado

## 11. Comparacao direta legado vs Nest

- Execute os mesmos casos contra as duas bases:
  - `http://127.0.0.1:8080` para o legado
  - `http://127.0.0.1:8081` para o Nest
- Registre para cada caso:
  - status HTTP
  - body
  - headers relevantes
  - efeito no banco
- Compare pelo menos estes casos:
  - `GET /domains`
  - `GET /stats`
  - `GET /forward/subscribe` com payload valido
  - `GET /forward/subscribe` com `to` invalido
  - `GET /forward/subscribe` com alias ja existente
  - `GET /forward/unsubscribe` com alias valido
  - `GET /forward/unsubscribe` com alias inexistente
  - `GET /forward/confirm?token=INVALIDO`
  - `POST /request/ui` com `target` valido
  - `POST /request/ui` com `target` invalido
  - `POST /request/email` com `target` valido
  - `GET /api/checkdns/:target` com dominio valido
  - `POST /api/credentials/create` com email valido
  - `GET /api/credentials/confirm?token=INVALIDO`
- A comparacao correta e:
  - status igual ou justificadamente equivalente
  - shape do JSON igual ou funcionalmente equivalente
  - side-effect igual no banco
  - nenhuma regressao visivel
- Conclusao desta etapa:
  - `PASSA` se nao houver divergencia nao explicada
  - `NO-GO` se houver diferenca funcional sem aceitacao explicita

## 12. Dados de teste recomendados

- Use valores unicos por rodada para evitar falso positivo por cache, cooldown ou colisao:

```text
email forwarding: qa-forward+20260321@example.com
email api key: qa-api+20260321@example.com
alias handle: qa-mig-20260321
alias domain: <um dominio ativo do seu banco>
address final: qa-mig-20260321@<dominio>
```

- Antes de cada rodada, valide que o alias ainda nao existe:

```sql
SELECT id, address, goto, active, created, modified
FROM alias
WHERE address = 'qa-mig-20260321@SEU_DOMINIO';
```

- Antes de cada rodada, limpe ou expire conscientemente o que for lixo de teste antigo. Nao apague registros de producao.

## 13. Fluxo real de `GET /forward/subscribe`

- Dispare a requisicao:

```powershell
curl.exe -i ^
  "http://127.0.0.1:8081/forward/subscribe?name=qa-mig-20260321&domain=SEU_DOMINIO&to=qa-forward+20260321@example.com"
```

- O resultado esperado no HTTP e:
  - status `200`
  - body com:
    - `ok: true`
    - `action: "subscribe"`
    - `alias_candidate`
    - `to`
    - `confirmation.sent`
    - `confirmation.ttl_minutes`

- Verifique no banco:

```sql
SELECT id, email, status, created_at, expires_at, send_count, last_sent_at,
       attempts_confirm, intent, alias_name, alias_domain, confirmed_at
FROM email_confirmations
WHERE email = 'qa-forward+20260321@example.com'
ORDER BY id DESC
LIMIT 3;
```

- O resultado esperado no banco e:
  - um registro `pending`
  - `intent` igual a `subscribe` ou `subscribe_address`, conforme o caso
  - `alias_name` e `alias_domain` corretos
  - `send_count = 1`
  - `attempts_confirm = 0`
  - `confirmed_at IS NULL`

- Verifique no SMTP ou mail catcher:
  - o e-mail chegou
  - o link usa o host esperado
  - o path do link e `/forward/confirm`
  - o token esta presente e parece valido

- Conclusao desta etapa:
  - `PASSA` se o HTTP, o banco e o e-mail refletirem o mesmo pedido
  - `NO-GO` se o e-mail nao chegar, o link apontar para host errado ou o banco nao refletir o pedido

## 14. Fluxo real de `GET /forward/confirm` para subscribe

- Capture o token do e-mail recebido.
- Dispare a confirmacao:

```powershell
curl.exe -i "http://127.0.0.1:8081/forward/confirm?token=TOKEN_DO_EMAIL"
```

- O resultado esperado no HTTP e um destes:
  - `200` com `ok: true`, `confirmed: true`, `created: true`, `address`, `goto`
  - `200` com `ok: true`, `confirmed: true`, `created: false`, `reason: "already_exists"` quando houver corrida controlada

- Verifique o banco:

```sql
SELECT id, email, status, intent, alias_name, alias_domain, confirmed_at
FROM email_confirmations
WHERE email = 'qa-forward+20260321@example.com'
ORDER BY id DESC
LIMIT 3;
```

```sql
SELECT id, address, goto, active, created, modified
FROM alias
WHERE address = 'qa-mig-20260321@SEU_DOMINIO';
```

- O resultado esperado e:
  - o registro em `email_confirmations` foi para `status = 'confirmed'`
  - `confirmed_at` foi preenchido
  - o alias existe na tabela `alias`
  - `goto` aponta para `qa-forward+20260321@example.com`

- Teste replay do mesmo token:

```powershell
curl.exe -i "http://127.0.0.1:8081/forward/confirm?token=TOKEN_DO_EMAIL"
```

- O replay deve falhar com:
  - `400`
  - erro `invalid_or_expired`

- Conclusao desta etapa:
  - `PASSA` se o alias existir exatamente como esperado e o token nao puder ser reutilizado
  - `NO-GO` se o token for consumido sem efeito ou se puder ser reutilizado

## 15. Fluxo real de `GET /forward/unsubscribe`

- Dispare a requisicao para o alias criado:

```powershell
curl.exe -i ^
  "http://127.0.0.1:8081/forward/unsubscribe?alias=qa-mig-20260321@SEU_DOMINIO"
```

- O resultado esperado no HTTP e:
  - status `200`
  - body com:
    - `ok: true`
    - `action: "unsubscribe"`
    - `alias`
    - `sent`
    - `ttl_minutes`

- Verifique no banco:

```sql
SELECT id, email, status, created_at, expires_at, send_count, last_sent_at,
       attempts_confirm, intent, alias_name, alias_domain, confirmed_at
FROM email_confirmations
WHERE email = 'qa-forward+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

- O resultado esperado no banco e:
  - novo registro `pending`
  - `intent = 'unsubscribe'`
  - alias e dominio corretos
  - `confirmed_at IS NULL`

- Verifique no SMTP ou mail catcher:
  - o e-mail chegou
  - o link aponta para `/forward/confirm`

- Conclusao desta etapa:
  - `PASSA` se o pedido de unsubscribe for refletido em HTTP, banco e e-mail
  - `NO-GO` se qualquer uma dessas tres evidencias estiver inconsistente

## 16. Fluxo real de `GET /forward/confirm` para unsubscribe

- Capture o token do e-mail de unsubscribe.
- Dispare a confirmacao:

```powershell
curl.exe -i "http://127.0.0.1:8081/forward/confirm?token=TOKEN_DO_EMAIL"
```

- O resultado esperado no HTTP e:
  - `200`
  - body com `ok: true`, `confirmed: true`, `intent: "unsubscribe"`, `removed: true`, `address`

- Verifique o banco:

```sql
SELECT id, email, status, intent, confirmed_at
FROM email_confirmations
WHERE email = 'qa-forward+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

```sql
SELECT id, address, goto, active
FROM alias
WHERE address = 'qa-mig-20260321@SEU_DOMINIO';
```

- O resultado esperado e:
  - o registro de confirmacao virou `confirmed`
  - o alias nao existe mais na tabela `alias`

- Teste replay do mesmo token:

```powershell
curl.exe -i "http://127.0.0.1:8081/forward/confirm?token=TOKEN_DO_EMAIL"
```

- O replay deve falhar com `400 invalid_or_expired`.

- Conclusao desta etapa:
  - `PASSA` se a linha `alias` sumir e o token ficar inutilizavel
  - `NO-GO` se o token for consumido e o alias permanecer

## 17. Fluxo real de `POST /api/credentials/create`

- Dispare a requisicao:

```powershell
curl.exe -i ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"qa-api+20260321@example.com\",\"days\":30}" ^
  http://127.0.0.1:8081/api/credentials/create
```

- O resultado esperado no HTTP e:
  - `200`
  - body com:
    - `ok: true`
    - `action: "api_credentials_create"`
    - `email`
    - `days`
    - `confirmation`
  - o bloco `confirmation` deve refletir:
    - `sent`
    - `ttl_minutes`
    - `send_count`
    - `remaining_attempts`
    - possivelmente `last_sent_at` e `next_allowed_send_at`

- Verifique o banco:

```sql
SELECT id, email, status, days, created_at, expires_at, confirmed_at,
       send_count, last_sent_at, attempts_confirm
FROM api_token_requests
WHERE email = 'qa-api+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

- O resultado esperado no banco e:
  - um registro `pending`
  - `days = 30`
  - `send_count = 1`
  - `confirmed_at IS NULL`

- Verifique no SMTP ou mail catcher:
  - o e-mail chegou
  - o link aponta para `/api/credentials/confirm`
  - o token esta presente

- Conclusao desta etapa:
  - `PASSA` se o HTTP, o banco e o e-mail estiverem alinhados
  - `NO-GO` se faltar qualquer uma dessas evidencias

## 18. Fluxo real de `GET /api/credentials/confirm`

- Capture o token do e-mail e confirme:

```powershell
curl.exe -i "http://127.0.0.1:8081/api/credentials/confirm?token=TOKEN_DO_EMAIL"
```

- O resultado esperado no HTTP e:
  - `200`
  - body com:
    - `ok: true`
    - `action: "api_credentials_confirm"`
    - `confirmed: true`
    - `email`
    - `token`
    - `token_type: "api_key"`
    - `expires_in_days`

- Copie o valor de `token` imediatamente. Ele nao pode ser recuperado depois.

- Verifique o banco:

```sql
SELECT id, email, status, days, created_at, expires_at, confirmed_at,
       send_count, last_sent_at, attempts_confirm
FROM api_token_requests
WHERE email = 'qa-api+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

```sql
SELECT id, owner_email, status, created_at, expires_at, revoked_at, last_used_at
FROM api_tokens
WHERE owner_email = 'qa-api+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

- O resultado esperado e:
  - o `api_token_requests` usado ficou `confirmed`
  - existe uma linha `active` em `api_tokens`
  - `revoked_at IS NULL`

- Teste replay do token de confirmacao:

```powershell
curl.exe -i "http://127.0.0.1:8081/api/credentials/confirm?token=TOKEN_DO_EMAIL"
```

- O replay deve falhar com `400 invalid_or_expired`.

- Conclusao desta etapa:
  - `PASSA` se a confirmacao gerar uma API key ativa e o token nao puder ser reutilizado
  - `NO-GO` se o request ficar `confirmed` sem linha correspondente em `api_tokens`

## 19. Smoke autenticado da API de aliases

- Com a API key gerada, teste `GET /api/alias/list`:

```powershell
curl.exe -i ^
  -H "X-API-Key: API_KEY_GERADA" ^
  "http://127.0.0.1:8081/api/alias/list?limit=20&offset=0"
```

- O resultado esperado e:
  - `200`
  - body com `items` e `pagination`

- Teste `GET /api/alias/stats`:

```powershell
curl.exe -i ^
  -H "X-API-Key: API_KEY_GERADA" ^
  "http://127.0.0.1:8081/api/alias/stats"
```

- O resultado esperado e:
  - `200`
  - body com contadores por owner

- Teste `POST /api/alias/create`:

```powershell
curl.exe -i ^
  -H "X-API-Key: API_KEY_GERADA" ^
  -H "content-type: application/json" ^
  -d "{\"alias_handle\":\"qa-api-20260321\",\"alias_domain\":\"SEU_DOMINIO\"}" ^
  http://127.0.0.1:8081/api/alias/create
```

- O resultado esperado e:
  - `200`
  - `ok: true`
  - `created: true`
  - `address`
  - `goto` igual ao owner da API key

- Verifique o banco:

```sql
SELECT id, address, goto, active, created, modified
FROM alias
WHERE address = 'qa-api-20260321@SEU_DOMINIO';
```

- Teste `GET /api/activity`:

```powershell
curl.exe -i ^
  -H "X-API-Key: API_KEY_GERADA" ^
  "http://127.0.0.1:8081/api/activity?limit=20&offset=0"
```

- O resultado esperado e:
  - `200`
  - body com `items`
  - ao menos um item coerente com `alias_create` ou `confirm_*`

- Verifique sinais de uso da API key:

```sql
SELECT id, owner_email, status, created_at, expires_at, revoked_at, last_used_at
FROM api_tokens
WHERE owner_email = 'qa-api+20260321@example.com'
ORDER BY id DESC
LIMIT 5;
```

```sql
SELECT id, api_token_id, api_token_owner_email, created_at, route
FROM api_logs
WHERE api_token_owner_email = 'qa-api+20260321@example.com'
ORDER BY id DESC
LIMIT 10;
```

- O resultado esperado e:
  - `last_used_at` atualizado
  - entradas em `api_logs` para as rotas chamadas

- Teste `POST /api/alias/delete`:

```powershell
curl.exe -i ^
  -H "X-API-Key: API_KEY_GERADA" ^
  -H "content-type: application/json" ^
  -d "{\"alias\":\"qa-api-20260321@SEU_DOMINIO\"}" ^
  http://127.0.0.1:8081/api/alias/delete
```

- O resultado esperado e:
  - `200`
  - `ok: true`
  - `deleted: true`

- Conclusao desta etapa:
  - `PASSA` se create, list, stats, activity e delete forem coerentes e gravarem sinais no banco
  - `NO-GO` se a API key autenticar mas os side-effects nao aparecerem

## 20. Teste de concorrencia para `POST /api/credentials/create`

- O repositorio ja tem um smoke script para concorrencia:

```powershell
cd app
$env:API_BASE_URL = "http://127.0.0.1:8081"
$env:TEST_EMAIL = "qa-api-concurrency+20260321@example.com"
$env:TEST_DAYS = "30"
$env:CONCURRENCY = "10"
node .\scripts\api-credentials-concurrency.js
```

- O resultado esperado e:
  - nenhuma resposta `5xx`
  - exatamente um registro `pending` na tabela `api_token_requests` para o e-mail testado
  - `send_count` nao ultrapassa o maximo configurado

- Conclusao desta etapa:
  - `PASSA` se o script sair com `0`
  - `NO-GO` se aparecerem `5xx`, duplicidade indevida ou `send_count` acima do limite

## 21. Rate limit real no Nest

- Valide pelo menos:
  - `GET /forward/confirm`
  - `POST /api/credentials/create`
  - `GET /api/credentials/confirm`
  - `GET /api/alias/list`
  - `POST /api/alias/create`
  - `POST /api/alias/delete`
- O comportamento esperado quando estourar o limite e:
  - status `429`
  - header `Retry-After`
  - body com `error: "rate_limited"` e `where` coerente

- Exemplo para estourar o limite de confirmacao por token:

```powershell
1..10 | ForEach-Object {
  curl.exe -sS -o NUL -D - "http://127.0.0.1:8081/api/credentials/confirm?token=TOKEN_INVALIDO_FIXO"
}
```

- Verifique:
  - alguma chamada passa a responder `429`
  - o body acusa `where: "credentials_confirm"` e `reason: "too_many_requests_token"` ou `too_many_requests_ip`, conforme o caso
  - o header `Retry-After` aparece

- Exemplo para estourar limite por API key:

```powershell
1..200 | ForEach-Object {
  curl.exe -sS -o NUL -D - -H "X-API-Key: API_KEY_GERADA" "http://127.0.0.1:8081/api/alias/list"
}
```

- Verifique:
  - alguma chamada passa a responder `429`
  - o body acusa `where: "alias_list"` e `reason: "too_many_requests_key"`

- Conclusao desta etapa:
  - `PASSA` se os limites dispararem, retornarem `429` com `Retry-After` e sem `5xx`
  - `NO-GO` se o sistema ignorar limite ou quebrar com erro interno

## 22. Validacao do Redis como store distribuido

- Se a validacao for apenas de conectividade, uma instancia do Nest basta.
- Se a validacao for de comportamento distribuido real, suba pelo menos duas instancias do Nest atras do mesmo Redis.
- Gere trafego que passe alternando entre as instancias e observe se o limite soma globalmente.
- Verifique no Redis:

```bash
redis-cli --scan --pattern 'rl:*'
```

- As chaves esperadas seguem o padrao:
  - `rl:<rule_name>:<key>`
  - exemplos de `rule_name`: `global`, `sub_ip`, `confirm_token`, `cred_create_email`, `alias_list_key`

- Verifique TTL de uma chave gerada:

```bash
redis-cli PTTL "rl:confirm_token:confirm:TOKEN_NORMALIZADO"
```

- O resultado esperado e:
  - as chaves existem durante a janela
  - o `PTTL` e positivo
  - duas instancias diferentes respeitam o mesmo contador

- Sinais de problema:
  - nenhum key aparece no Redis mesmo com `REDIS_URL` configurado
  - cada instancia conta isoladamente
  - logs com `ratelimit.redis.unavailable`

- Conclusao desta etapa:
  - `PASSA` se o limite for realmente compartilhado entre instancias
  - `NO-GO` se Redis estiver configurado mas o comportamento efetivo continuar local por instancia

## 23. Validacao de fallback de rate limit sem Redis

- Esta etapa e opcional, mas util para entender o comportamento degradado.
- Pare o Redis ou remova `REDIS_URL` apenas em homologacao controlada.
- Repita um teste de rate limit.
- O resultado esperado e:
  - o rate limit continua funcionando
  - o comportamento vira local por instancia
  - o log registra indisponibilidade do Redis e fallback para memoria

- Conclusao desta etapa:
  - `PASSA` se a degradacao for controlada e sem `5xx`
  - `NO-GO` se a indisponibilidade do Redis derrubar a app

## 24. Validacao de CORS

- O Nest atual monta o allowlist a partir de:
  - `CORS_ALLOWED_ORIGINS`
  - `APP_PUBLIC_URL`
- Teste com um origin permitido:

```powershell
curl.exe -i ^
  -H "Origin: https://ORIGIN_PERMITIDA" ^
  http://127.0.0.1:8081/domains
```

- Teste com um origin nao permitido:

```powershell
curl.exe -i ^
  -H "Origin: https://origin-nao-permitida.example" ^
  http://127.0.0.1:8081/domains
```

- Verifique:
  - origin permitida recebe `Access-Control-Allow-Origin` coerente
  - origin nao permitida nao recebe autorizacao indevida
  - se `CORS_ALLOW_CREDENTIALS=true`, o comportamento de credentials so aparece para origin permitida

- Conclusao desta etapa:
  - `PASSA` se o CORS refletir exatamente a configuracao
  - `GO COM RESSALVA EXPLICITA` apenas se o produto aceitar formalmente que o allowlist ainda nao e persistido por tenant
  - `NO-GO` se o requisito formal exigir persistencia por tenant em banco + cache Redis

## 25. Validacao de `TRUST_PROXY`

- Suba o ambiente atras do gateway real.
- Force trafego de pelo menos dois IPs clientes distintos.
- Estoure um rate limit com o cliente A.
- Repita o mesmo endpoint com o cliente B.
- O resultado esperado e:
  - o cliente A fica limitado
  - o cliente B continua independente

- Sinais de problema:
  - todos os clientes parecem vir do mesmo IP
  - um rate limit aplicado a um cliente afeta todos os outros
- Conclusao desta etapa:
  - `PASSA` se os limites respeitarem IP real do cliente
  - `NO-GO` se o proxy estiver mascarando o IP e contaminando os limites

## 26. Planejamento do path routing em staging

- No gateway, roteie para o Nest apenas as rotas migradas:
  - `/domains`
  - `/stats`
  - `/forward/*`
  - `/request/ui`
  - `/request/email`
  - `/api/checkdns/*`
  - `/api/credentials/*`
  - `/api/alias/*`
  - `/api/activity`
- Mantenha no legado:
  - `/auth/*`
  - `/admin/*`
  - qualquer rota fora da lista migrada
- Se possivel, adicione um header temporario de observabilidade em staging:
  - `X-Upstream-App: legacy`
  - `X-Upstream-App: nest`
- Esse header reduz drasticamente duvida durante smoke e rollback.

## 27. Smoke via gateway com path routing ativo

- Com o gateway configurado, repita via URL publica pelo menos:
  - `GET /domains`
  - `GET /stats`
  - `GET /forward/subscribe`
  - `GET /forward/unsubscribe`
  - `GET /forward/confirm`
  - `POST /api/credentials/create`
  - `GET /api/credentials/confirm`
  - `GET /api/alias/list`
  - `POST /api/alias/create`
  - `POST /api/alias/delete`
  - `POST /request/ui`
  - `POST /request/email`
  - `GET /api/checkdns/:target`
  - uma rota que deve continuar no legado, por exemplo `/auth/...` ou `/admin/...`
- Verifique:
  - rotas migradas chegam no Nest
  - rotas fora do escopo continuam no legado
  - o host publico usado nos e-mails e o mesmo do gateway
  - nao existe path apontando para backend errado

- Conclusao desta etapa:
  - `PASSA` se o roteamento por path estiver consistente ponta a ponta
  - `NO-GO` se qualquer rota cair no backend errado

## 28. Drill de rollback

- Com o staging roteando para o Nest, execute um rollback controlado no gateway, devolvendo as rotas migradas para o legado.
- Repita imediatamente um subconjunto de smoke:
  - `GET /domains`
  - `GET /stats`
  - `GET /forward/subscribe`
  - `POST /api/credentials/create`
- Verifique:
  - o gateway troca o upstream sem downtime perceptivel
  - as respostas passam a vir do legado
  - nao sobra cache ou regra parcial mandando trafego para o Nest

- Conclusao desta etapa:
  - `PASSA` se o rollback for rapido, claro e verificavel
  - `NO-GO` se o rollback nao puder ser executado sob controle

## 29. Registro minimo de evidencias

- Para cada etapa, arquive:
  - comando executado
  - timestamp
  - ambiente
  - status HTTP
  - body da resposta
  - consulta SQL usada
  - resultado SQL
  - logs relevantes
  - conclusao `PASSA` ou `FALHA`
- Sem evidencia registrada, trate a etapa como nao validada.

## 30. Condicoes objetivas de `GO`

- Declare `GO` apenas se todos os itens abaixo forem verdadeiros:
  - todos os gates locais passam
  - o Nest sobe limpo
  - `domains`, `stats` e `check-dns` passam em smoke
  - subscribe e unsubscribe funcionam com e-mail real e banco real
  - confirmacao de subscribe e unsubscribe produz o side-effect correto no banco
  - criacao e confirmacao de API credentials funcionam com side-effect correto
  - a API key gerada autentica, registra uso e permite CRUD esperado
  - o teste de concorrencia nao gera `5xx` nem pendencias duplicadas
  - os rate limits retornam `429` correto com `Retry-After`
  - o Redis funciona como store distribuido, se essa for a topologia esperada
  - o CORS esta correto para a politica aceita pela release
  - o gateway roteia as rotas certas para o backend certo
  - o rollback foi ensaiado com sucesso

## 31. Condicoes objetivas de `GO COM RESSALVA EXPLICITA`

- Use `GO COM RESSALVA EXPLICITA` apenas se:
  - todos os pontos obrigatorios acima passaram
  - e o unico gap remanescente for conscientemente aceito por negocio/arquitetura
  - e esse gap estiver documentado com dono, prazo e risco
- Exemplo plausivel nesta base:
  - CORS ainda configurado por variavel e nao por tenant persistido, desde que isso tenha sido aceito formalmente para esta fase

## 32. Condicoes objetivas de `NO-GO`

- Declare `NO-GO` imediatamente se ocorrer qualquer um dos itens abaixo:
  - qualquer teste automatizado falhar
  - qualquer endpoint migrado retornar `5xx` em caminho nominal
  - e-mail nao chegar ou sair com link para host/path errado
  - `email_confirmations.status = 'confirmed'` sem o efeito esperado na tabela `alias`
  - `api_token_requests.status = 'confirmed'` sem linha `active` correspondente em `api_tokens`
  - a API key gerada nao autenticar ou nao registrar uso
  - rate limit nao disparar quando deveria
  - rate limit disparar globalmente por erro de `TRUST_PROXY`
  - Redis estar configurado mas o comportamento real continuar local por instancia
  - rotas cairem no backend errado no gateway
  - rollback nao puder ser executado de forma imediata e verificavel
  - o requisito formal continuar exigindo `tenant origins em banco + Redis` e isso ainda nao existir

## 33. Resultado final que deve ser escrito no relatorio

- Feche a validacao com uma frase unica e objetiva:
  - `GO: todas as validacoes obrigatorias passaram em codigo, banco, Redis, SMTP, gateway e rollback.`
  - `GO COM RESSALVA EXPLICITA: todas as validacoes obrigatorias passaram, exceto [descrever o gap aceito].`
  - `NO-GO: falhou em [descrever exatamente a etapa], com evidencia em [log, resposta HTTP ou consulta SQL].`
