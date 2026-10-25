# whatsapp-dispatch-service

Microsserviço de envio de WhatsApp para leads do CRM imoveis-mvp. Projeto **separado** do CRM (Next.js/Vercel) e do
`whatsapp-individual-service` (Railway). **Não está ligado ao CRM**: nenhuma rota do CRM chama este serviço; a ligação
depende de decisão do dono (ver "Ponto de integração com o CRM").

- Node.js 22 (ES Modules), Express, Redis + BullMQ, PostgreSQL (schema próprio `wa_dispatch`), Zod, pino.
- Porta da API: **3031**.
- Provedores: **WhatsApp Cloud API oficial da Meta** (adaptador real, só operações documentadas) e, opcional,
  **`crm_individual`** (o `whatsapp-individual-service` existente, pelas rotas HTTP que ele já tem).
- Nenhuma mensagem real foi enviada no desenvolvimento: sem credencial a instância fica `not_configured` e nada sai;
  os testes usam MOCKs nomeados (`tests/helpers/mock-graph.js`).

## Estrutura

```
src/
  server.js            entrada (--role=api | worker | scheduler | all)
  app.js, context.js   Express e dependências compartilhadas
  config/              variáveis de ambiente (Zod)
  routes/ controllers/ middleware/ validation/
  services/            authorization (gate central), dispatch, suppression, instances, onboarding, webhook-processing, stats
  services/consent/    verificadores de consentimento: crm-db (padrão) e crm-http
  repositories/        SQL (pg) por tabela
  queue/               BullMQ (fila "wa-dispatch-send")
  workers/             worker de envio
  scheduler/           agendador (um ativo por banco, advisory lock)
  whatsapp/            adapter.js (interface + registro), instances.js, messages.js, profile.js, webhooks.js,
                       graph-client.js (Graph API), crm-individual.js
migrations/            SQL versionado (YYYYMMDDHHMMSS_descricao.sql)
scripts/migrate.js     aplica migrations e registra em wa_dispatch.schema_migrations
tests/                 node --test (unitários + integração com Postgres/Redis reais)
```

## Variáveis de ambiente

Lista completa (só nomes) em `.env.example`. Principais:

| Variável | Uso |
|---|---|
| `PORT` | 3031 (padrão; não alterar) |
| `DATABASE_URL`, `DATABASE_SSL` | Postgres. Padrão de produção = banco do CRM (Supabase) em **modo sessão** (porta 5432 direta ou pooler em modo sessão: o agendador usa advisory lock de sessão). Local = Postgres do Docker Compose |
| `REDIS_URL` | Redis da fila |
| `CRM_API_TOKEN`, `ADMIN_API_TOKEN`, `READONLY_API_TOKEN` | Tokens Bearer (mín. 32 caracteres). Papéis `crm`, `admin`, `viewer` |
| `CORS_ALLOWED_ORIGINS` | Origens de navegador permitidas (vazio = nenhuma) |
| `WA_APP_SECRET` | Assinatura `X-Hub-Signature-256` do webhook. Sem ela o webhook responde 503 (falha fechado) |
| `WA_WEBHOOK_VERIFY_TOKEN` | Verificação GET do webhook |
| `WA_APP_ID` | Upload resumível da foto de perfil |
| `WA_CLOUD_ACCESS_TOKEN` | Token padrão da Cloud API. Token por número: crie outra variável e informe o NOME em `credential_ref` da instância |
| `WA_GRAPH_API_VERSION` | Padrão `v26.0` |
| `CONSENT_VERIFIER` | `crm-db` (padrão) ou `crm-http` |
| `CRM_DATABASE_URL`, `CRM_DB_SCHEMA` | Leitura do CRM para consentimento (padrão: mesmo `DATABASE_URL`, schema `public`) |
| `CONSENT_CRM_ACCEPTED_PURPOSES` | Finalidades aceitas pelo verificador `crm-db` (padrão `retorno_simulacao`) |
| `CRM_CONSENT_VERIFY_URL`, `CRM_CONSENT_VERIFY_TOKEN` | Verificador `crm-http` |
| `WHATSAPP_INDIVIDUAL_SERVICE_URL`, `WHATSAPP_INDIVIDUAL_SERVICE_SECRET` | Provedor opcional `crm_individual` |
| `OPT_OUT_KEYWORDS` | Mensagem do cliente igual a uma destas palavras = sair (padrão `PARAR,PARE,SAIR,STOP,CANCELAR,DESCADASTRAR`) |
| `WORKER_CONCURRENCY`, `SCHEDULER_INTERVAL_MS`, `MAX_SEND_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `SEND_TIMEOUT_MS`, `SENDING_LOCK_MS`, `UNKNOWN_VERIFICATION_WINDOW_MS`, `INSTANCE_HEALTH_INTERVAL_MS` | Operação |

## Comandos

```bash
cd whatsapp-dispatch-service
cp .env.example .env            # preencher POSTGRES_PASSWORD, REDIS_PASSWORD e os tokens
npm ci
docker compose up -d            # postgres, redis, migrate, api (127.0.0.1:3031), worker, scheduler
docker compose ps
curl http://127.0.0.1:3031/health
curl http://127.0.0.1:3031/ready

# Sem Docker para o app (Postgres/Redis do compose publicados em 127.0.0.1 — só desenvolvimento):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
DATABASE_URL=... npm run migrate
DATABASE_URL=... REDIS_URL=... npm start                 # api + worker + scheduler no mesmo processo
npm run start:api | start:worker | start:scheduler       # um papel por processo

npm test                        # unitários + integração (exige Postgres/Redis do compose dev ou TEST_DATABASE_URL/TEST_REDIS_URL)
npm run test:unit
```

Os testes de integração criam o banco `wa_dispatch_test` (apagado e recriado a cada arquivo) e usam o Redis no db 1.
Rede com proxy TLS no `docker build`: `docker build --secret id=npm_ca,src=<certificado.crt> .`

## Banco (schema `wa_dispatch`)

Migração: `migrations/20261025190000_wa_dispatch_init.sql` (idempotente; RLS habilitado sem policies públicas; `anon` e
`authenticated` sem acesso). Tabelas: `whatsapp_instances`, `instance_daily_usage`, `campaigns`, `leads`,
`consent_records`, `suppression_list` (DELETE/TRUNCATE bloqueados por trigger), `outbound_messages`, `message_events`,
`onboarding_runs`, `webhook_events`, `audit_logs` e `schema_migrations` (controle do `migrate`).

Dados pessoais guardados: id do lead no CRM, telefone (E.164) e referência de consentimento. Texto de mensagem do
cliente não é gravado; tokens nunca vão para o banco (só o nome da variável em `credential_ref`).

## Endpoints

Todas as rotas `/v1` exigem `Authorization: Bearer <token>`. Respostas de erro: `{ "error": "...", "code": "..." }`.

| Método e rota | Papel | O que faz |
|---|---|---|
| `GET /health` | público | Processo vivo (não consulta dependências) |
| `GET /ready` | público | 200 só com banco + migrações + Redis; senão 503 com `checks` |
| `POST /v1/leads` | crm | Cadastra lead `{crm_lead_id, phone, campaign_code, consent_reference, idempotency_key?}` (ou header `Idempotency-Key`). Responde **202 depois de persistir**, sem esperar envio. Repetido = 200 com o mesmo trabalho; mesma chave com outros dados = 409 |
| `GET /v1/leads?crm_lead_id=` · `GET /v1/leads/:id` | crm, viewer | Consulta lead e trabalho |
| `GET /v1/jobs/:id` | crm, viewer | Estado do trabalho, linha do tempo (solicitado, autorizado, enfileirado, aceito, entregue, lido, respondido, falha, cancelado) e eventos |
| `GET /v1/consent?phone=` | crm | Registros de consentimento (origem, finalidade, data, estado) |
| `POST /v1/consent/revocations` | crm | Revoga `{phone, purpose?, reason, add_to_suppression?}`; cancela pendentes na mesma transação |
| `POST /v1/suppressions` | crm | Não contato `{phone, reason, source}`; cancela pendentes |
| `GET /v1/suppressions/:phone` | crm | Situação do telefone |
| `POST /v1/suppressions/:phone/deactivate` | admin | Desativa (nunca apaga) com `{reason, confirm: "REMOVER +55..."}`; auditado |
| `GET /v1/instances` · `GET /v1/instances/:id` | crm, viewer | Instâncias, uso do dia, último onboarding |
| `POST /v1/instances` · `PATCH /v1/instances/:id` | admin | Cadastra/edita instância |
| `POST /v1/instances/:id/verify` | admin | Confirma a conexão no provedor (única forma de virar `connected`) |
| `POST /v1/instances/:id/{enable,disable,activate,pause,resume,suspend}` | admin | Estado operacional (`suspend`/retomar suspensa exigem `reason`) |
| `POST /v1/instances/:id/onboarding` | admin | (Re)executa a configuração do perfil |
| `GET/POST /v1/campaigns` · `PATCH /v1/campaigns/:code` | leitura / admin | Campanhas (finalidade, template) |
| `GET /v1/stats` | crm, viewer | Métricas |
| `GET /v1/admin/failures` · `GET /v1/admin/audit-logs` | viewer, admin | Falhas e auditoria |
| `POST /v1/admin/jobs/:id/resolve-unknown` | admin | Decisão humana sobre resultado desconhecido `{resolution: sent|not_sent_retry|failed, note}` |
| `GET /webhooks/meta` · `POST /webhooks/meta` | assinatura Meta | Verificação e eventos da Cloud API |

## Fluxo de um lead

1. `POST /v1/leads` grava lead + trabalho (`requested`). Telefone na lista de não contato → recusado na entrada.
2. Agendador → **autorização central** (`services/authorization.js`), na ordem: lista de não contato, revogação
   registrada, campanha ativa/no período, duplicidade (mesmo telefone + campanha), **consentimento na fonte confiável**.
   Cada verificação grava `consent_records`. Recusa → lead `rejected`, trabalho `cancelled`, motivo gravado.
3. Agendador reserva instância por **rodízio** (quem recebeu há mais tempo primeiro) entre as elegíveis: habilitada,
   `connected`, `active`, dentro da janela/fuso, intervalo mínimo cumprido e com **cota diária** (reserva atômica em
   `instance_daily_usage`). Sem instância elegível o trabalho espera; nada é criado para "preencher cota".
4. Worker repete a autorização imediatamente antes do envio, marca `sending` e chama o provedor.
5. Resultado: aceito → `accepted` (não é entrega); temporária → volta a `scheduled` com backoff exponencial;
   permanente → `failed`; **desconhecido** (tempo esgotado, conexão caída após o pedido, 5xx sem erro da Graph, worker
   morto no meio) → `unknown_pending_verification`, **nunca reenviado automaticamente**. A Cloud API não tem consulta de
   status por mensagem: a confirmação chega pelo webhook com `biz_opaque_callback_data` = id do trabalho. Sem
   confirmação dentro de `UNKNOWN_VERIFICATION_WINDOW_MS` → `unknown_needs_review` (decisão humana).
6. Webhook: `sent`/`delivered`/`read`/`failed` em transições monotônicas; mensagem do cliente → `replied`; palavra
   de saída → lista de não contato + revogação + cancelamento dos pendentes; erro 131050 (cliente recusou marketing)
   → lista de não contato.

Erro do provedor que atinge o número inteiro interrompe os envios daquela instância e registra o motivo: credencial
(0, 3, 10, 190, 200-299, 131005) e restrição (368, 130497, 131031, 131042) → `suspended`; qualidade (131048, 131064) →
`paused`; número não registrado (33, 131045, 133010) → `disconnected`; template (131063, 132xxx) → campanha pausada.
`account_update` com ACCOUNT_VIOLATION/ACCOUNT_RESTRICTION/DISABLED_UPDATE suspende as instâncias da WABA.
Rodízio de números nunca contorna bloqueio: a autorização é pelo telefone do cliente, independente da instância.

## Consentimento (fonte confiável)

O campo `consent_reference` enviado pelo CRM **não** é prova. Verificador padrão `crm-db` lê o próprio CRM no mesmo
Postgres, em transação **somente leitura**:

- `simulation_registrations` (o `crm_lead_id` precisa ser o id do cadastro, com o mesmo telefone — comparação
  DDD + 8 últimos dígitos, critério de `phoneComparisonKey` do CRM). Origem registrada `formulario_simulacao`, data =
  `created_at` do cadastro.
- `status = 'do_not_contact'` no cadastro ou em outro cadastro do mesmo telefone, ou em `prospecting_contacts` → revogado
  e telefone vai para a lista de não contato. Cliente arquivado → recusado.
- Telefone da equipe (`admin_users` ativos, `whatsapp_individual_sessions`) → recusado (regra WA-12 do CRM).
- Finalidade fora de `CONSENT_CRM_ACCEPTED_PURPOSES` → recusada. O formulário do CRM não tem campo de aceite/LGPD
  (conferido em 2026-10-25: só o link da política de privacidade); por isso só `retorno_simulacao` é aceita por padrão.
- Falha de leitura, schema ausente, id que não é do CRM → `unverifiable` → recusado.

Alternativa `crm-http` (`CONSENT_VERIFIER=crm-http`): `POST CRM_CONSENT_VERIFY_URL` com Bearer
`CRM_CONSENT_VERIFY_TOKEN`, pedido `{crm_lead_id, phone_e164, purpose}`, resposta
`{state: granted|denied|revoked, origin, evidence_ref, consented_at, reason?, do_not_contact?}`. Sem configuração,
erro, tempo esgotado ou resposta fora do formato → recusado. O CRM **ainda não expõe** esse endpoint.

## Adaptadores de provedor

### WhatsApp Cloud API (`meta_cloud_api`)

Operações implementadas (documentação oficial consultada em 2026-10-25):

| Operação | Chamada | Documentação |
|---|---|---|
| Conferir conexão | `GET /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status` — conectado só com `status = CONNECTED` e telefone igual ao cadastrado | https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers · https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers |
| Enviar | `POST /{phone-number-id}/messages` (template; texto só na janela de 24 h) com `biz_opaque_callback_data` | https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages · https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages · https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview |
| Status/entrada | webhook `messages` (statuses sent/delivered/read/failed, messages) | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status · https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components |
| Assinatura do webhook | `X-Hub-Signature-256` (HMAC-SHA256 com App Secret); verificação `hub.mode`/`hub.verify_token`/`hub.challenge` | https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| Conta/qualidade | webhooks `account_update`, `phone_number_quality_update` (este só dispara nova conferência do número) | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update · https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update |
| Perfil | `GET`/`POST /{phone-number-id}/whatsapp_business_profile` (about ≤139, address ≤256, description ≤512, email ≤128, websites ≤2, vertical, profile_picture_handle) | https://developers.facebook.com/docs/whatsapp/cloud-api/reference/business-profiles · https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles |
| Foto | Resumable Upload: `POST /{app-id}/uploads` → `POST /upload:<id>` (`Authorization: OAuth`, `file_offset: 0`) → handle `h` | https://developers.facebook.com/docs/graph-api/guides/upload |
| Códigos de erro | classificação temporária/permanente/impacto na instância | https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes |

**Limitações registradas (sem sucesso fictício):**
- **Nome comercial (display name)** não é alterável pela API: é definido no registro do número e alterado no WhatsApp
  Manager com revisão da Meta (https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names).
  O onboarding só lê `verified_name`; se for diferente do desejado a etapa fica `unsupported` com o motivo e o
  onboarding termina `completed_with_limitations` (nunca `completed`).
- **Registro do número** (código por SMS/voz, PIN de duas etapas) é feito na Meta, fora deste serviço. Aqui "cadastrar
  a instância" = guardar `phone_number_id`/`waba_id` e conferir de verdade pelo `GET` do número.
- **Consulta de status por mensagem** não existe na Cloud API: só webhook.
- **Reconexão**: não há operação de "reconectar" na Cloud API; o agendador reconfere o número a cada
  `INSTANCE_HEALTH_INTERVAL_MS` (desconectada → `reconnecting` → nova conferência).
- Instagram vai no campo `websites` (máximo 2 sites contando o Instagram). Recado/status = `about`.

### `crm_individual` (opcional)

Usa só as rotas que o `whatsapp-individual-service` já expõe, com `X-Service-Secret`:
`GET /sessions/:userId/status` (conexão) e `POST /sessions/:userId/send` `{to, text}` (envio).
`provider_config.crm_user_id` = id do usuário do CRM dono da sessão. Não suportado (o serviço não expõe): templates,
consulta de status, confirmação de entrega para este serviço (os eventos vão para o CRM), perfil/foto do próprio número,
criação de sessão/QR (continua pelo CRM). Resultado: só campanhas `message_type = text`; trabalho com resultado
desconhecido vai para revisão humana.

## Configuração das 2 instâncias iniciais (sem código)

Pré-requisito por número, na Meta: número registrado na WABA com status CONNECTED, `phone_number_id` e `waba_id` em
mãos, token com permissão `whatsapp_business_messaging`/`whatsapp_business_management` guardado numa variável de
ambiente (ex.: `WA_TOKEN_NUMERO_1`, `WA_TOKEN_NUMERO_2`) e o webhook do app apontado para `https://<host>/webhooks/meta`
com `WA_WEBHOOK_VERIFY_TOKEN` e `WA_APP_SECRET`.

```bash
API=http://127.0.0.1:3031; ADMIN="Authorization: Bearer $ADMIN_API_TOKEN"

# 1) Campanha (finalidade coberta pelo consentimento) — template aprovado na Meta
curl -X POST $API/v1/campaigns -H "$ADMIN" -H 'content-type: application/json' -d '{
  "code":"retorno-simulacao","name":"Retorno da simulação","purpose":"retorno_simulacao",
  "message_type":"template","template_name":"<nome_do_template>","template_language":"pt_BR","enabled":true}'

# 2) Instância 1 (repita com os dados do número 2)
curl -X POST $API/v1/instances -H "$ADMIN" -H 'content-type: application/json' -d '{
  "name":"Numero 1","phone":"+55DDDNUMERO","provider":"meta_cloud_api",
  "provider_config":{"phone_number_id":"<id>","waba_id":"<waba>"},"credential_ref":"WA_TOKEN_NUMERO_1",
  "daily_limit":50,"min_interval_seconds":60,"timezone":"America/Sao_Paulo",
  "send_window":{"days":[1,2,3,4,5,6],"start":"08:00","end":"19:00"},
  "profile_config":{"display_name":"Matheus Machado Corretor de Imóveis","about":"<recado>","description":"<descrição>",
    "address":"<endereço>","email":"<e-mail>","instagram_url":"https://instagram.com/<perfil>",
    "vertical":"PROF_SERVICES","photo_url":"https://<url-https-da-foto-oficial>"}}'

# 3) Conferir conexão (dispara o onboarding do perfil quando conectado)
curl -X POST $API/v1/instances/<id>/verify -H "$ADMIN"
curl $API/v1/instances/<id> -H "$ADMIN"          # profile_state / onboarding.steps

# 4) Habilitar e ativar (ativação exige conexão confirmada e perfil concluído)
curl -X POST $API/v1/instances/<id>/enable -H "$ADMIN"
curl -X POST $API/v1/instances/<id>/activate -H "$ADMIN" -H 'content-type: application/json' -d '{}'
```

Foto do perfil: usar só o asset oficial atual da marca (regra 10 do `CLAUDE.md`), publicado numa URL https.

## Novas instâncias, pausa e desativação (sem código)

- Nova instância: mesmo passo 2 → 3 → 4 com outro nome/telefone/`credential_ref`. Não há limite de quantidade no código.
- Ajustar cota, janela, fuso, intervalo, ordem do rodízio, perfil: `PATCH /v1/instances/:id`.
- Pausar/retomar: `/pause`, `/resume`. Suspender (exige motivo): `/suspend`. Desligar do rodízio: `/disable`.
  Pausa, suspensão e desativação devolvem ao agendamento os trabalhos já reservados para a instância.
- Pelo banco: `update wa_dispatch.whatsapp_instances set enabled = false where name = '...'` (o agendador e o worker
  leem o banco a cada ciclo). Preferir a API, que audita (`audit_logs`).

## Backup e recuperação

- Fonte de verdade = Postgres (`wa_dispatch`). Backup: `pg_dump --schema=wa_dispatch -Fc "$DATABASE_URL" > wa_dispatch.dump`;
  restauração: `pg_restore --clean --if-exists -d "$DATABASE_URL" wa_dispatch.dump`. No Supabase o schema entra no
  backup do projeto.
- Redis só transporta ids (AOF ligado, `noeviction`). Se o Redis perder dados, o agendador reenfileira todos os
  trabalhos `queued` do Postgres (jobId = id do trabalho, sem duplicar). Trabalho que estava em `sending` quando um
  processo morreu vira `unknown_pending_verification` (sem reenvio).
- Volumes do Compose: `pgdata`, `redisdata`.

## Ponto de integração com o CRM (não ligado)

Para ligar, o CRM precisaria (decisão do dono):
1. Chamar `POST /v1/leads` com o id do cadastro (`simulation_registrations.id`) e o telefone do cadastro, a partir de
   uma rota/servidor do CRM (token `CRM_API_TOKEN` só no servidor).
2. Repassar "Não contactar" e revogações: `POST /v1/suppressions` e `POST /v1/consent/revocations` (o verificador
   `crm-db` já lê `do_not_contact` do banco a cada autorização e antes de cada envio).
3. Ler o andamento: `GET /v1/jobs/:id` / `GET /v1/leads?crm_lead_id=`.
A resposta do cliente no número deste serviço **não** chega ao Chat do CRM (o webhook vem para cá); a saída por palavra
de opt-out é tratada aqui e não é avisada ao CRM.

## Pendências externas

- Credenciais da Meta: `phone_number_id`, `waba_id` e token de cada número, `WA_APP_SECRET`, `WA_APP_ID`,
  `WA_WEBHOOK_VERIFY_TOKEN`, template aprovado e assinatura do webhook do app apontando para este serviço.
- Aplicar a migration no Postgres de produção (schema `wa_dispatch`).
- Hospedagem com Redis persistente e porta 3031 (o serviço não roda na Vercel).
- Consentimento: confirmação do dono de que o cadastro no formulário cobre a finalidade `retorno_simulacao`; endpoint
  `crm-http` do CRM inexistente.
- Integração com o CRM (seção acima).
