# SYSTEM_ARCHITECTURE — arquitetura técnica

> Verificado contra o código em 2026-09-24 (commit `3c82f72`). Visão funcional: [`CRM_CONTEXT.md`](CRM_CONTEXT.md) · Regras: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) · Banco: [`DATABASE.md`](DATABASE.md) · Permissões: [`PERMISSIONS.md`](PERMISSIONS.md) · WhatsApp: [`WHATSAPP.md`](WHATSAPP.md) · Meta: [`TRAFEGO_META.md`](TRAFEGO_META.md) · Manual dos agentes: [`../AGENTS.md`](../AGENTS.md).
> Não foi feita nenhuma consulta a produção; o que depende do ambiente vivo está como **A CONFIRMAR**.

## 1. Visão geral

```
Navegador (site público / painel PWA)
   │  React 19 client components  ◀──props── Server Components (app/**/page.jsx)
   ▼
Next.js 16 App Router (Vercel, runtime Node)
   ├─ app/api/**/route.js  → guards (lib/admin-auth) → lib/*.js  (TODA a lógica e o acesso a dados)
   ├─ proxy.js             → redireciona /admin sem cookie + Cache-Control: no-store
   └─ app/api/cron/*       ◀── pg_cron + pg_net (Supabase)  (bearer + hash)
   ▼
Supabase: Postgres (RLS sem policy pública; RPCs/triggers) · Auth · Storage · Realtime Broadcast · pg_cron/Vault
   ▲
Integrações: WhatsApp Cloud API (webhook ⇄) · Meta Pixel/CAPI/Marketing API · Anthropic · OpenAI(opc.) · Resend · Web Push (VAPID)
```

## 2. Frontend

- **Next.js 16.2 / React 19.2**, App Router, JavaScript (JSX). TypeScript **só** em `lib/simulacao-entrada/*.ts` (`strict: false`, `allowJs`); alias `@/*` → raiz.
- **Padrão**: `app/admin/**/page.jsx` = Server Component (guard `require*Page` + busca em `lib/*`) que passa dados iniciais a um Client Component em `components/*.jsx`, que refaz `fetch` para `/api/**` quando filtros mudam. Manter a guarda de “primeira montagem” (`isFirstRender`) para não dobrar consultas.
- **Páginas públicas**: `/`, `/empreendimentos/[id]`, `/simulacao` (+ `/equipe`), `/captacao` (= `/venda-seu-imovel`), `/minha-jornada/[token]`, `/politica-de-privacidade`. `components/AppChrome.jsx` decide o que envolve cada rota: Pixel, captura de `?c=`, header/rodapé, modal de lead, botões flutuantes (nunca em `/admin`; `/minha-jornada/*` sem nada).
- **Painel**: `app/admin/layout.jsx` injeta heartbeat de presença, alerta sonoro de novo cliente, mensagem diária, faixa “Alterar conta” e badge do Top 1 do ranking. Menu: `components/AdminMenu.jsx` (por perfil). Tela Clientes: `components/AdminSimulationList.jsx` (2.143 linhas; **lista/filtros/paginação server-side**).
- **Estilo**: Tailwind 3 (identidade azul/navy), português do Brasil, datas em `America/Sao_Paulo`, moeda BRL (`Intl.NumberFormat`).
- **PWA** (`docs/pwa-admin.md`): `app/manifest.js` (nome “Painel Matheus”, `start_url /admin/simulacoes`), `public/sw.js` (cache `painel-matheus-v4-<build>`; **regerado a cada build** por `scripts/stamp-service-worker.mjs` no `prebuild` — reverter com `git checkout -- public/sw.js` se só o hash mudou), `public/offline.html`, `components/PwaLifecycle.jsx` (aviso “nova versão”), Web Push.
- Componentes grandes/centrais: `AdminSimulationList` (2.143), `SimulationGenerator` (1.932), `WhatsappChat` (918), `AdminFinancialDashboard` (1.072), `ClientDocumentsModal` (945), `WhatsappDisparoManager` (709), `PerformanceOverviewDashboard` (652).

## 3. Backend (`lib/` + route handlers)

- **`lib/` é a única camada de dados/negócio** (≈110 arquivos, ~26 mil linhas). Route handlers só: guard → `lib` → `NextResponse.json({ error }, { status })`. `server-only` no topo dos módulos que usam a service role.
- `lib/supabase.js`: `getSupabaseAdminClient()` (service role, servidor), `getSupabasePublicClient()` (anon, valida tokens de login); `lib/supabase-browser.js` (anon, só Auth/Realtime no navegador).
- Padrões a manter: `fetchAllRows` (paginar de 1.000 em 1.000), `Promise.all` para consultas independentes, upsert idempotente, RPC para atomicidade (roleta, Disparo, Meta Diária), `logClientJourneyEvent(s)` como ponto único da timeline, `recordClientStatusChange` para histórico de status.
- **Domínios em `lib/`**:

| Domínio | Arquivos principais |
|---|---|
| Auth/perfis | `admin-auth`, `admin-access`, `admin-profiles`, `admin-users`, `admin-user-invitation`, `admin-presence`, `broker-gender` |
| Clientes/funil | `simulation-registrations`, `simulation-registration-schema`, `simulation-list-query`, `simulation-list-utils`, `simulation-mapper`, `client-status`, `client-status-history`, `client-tags`, `client-journey`, `journey-presentation`, `crm-clients`, `crm`, `lead-origin`, `property-preferences` |
| Roleta/campanhas | `lead-distribution`, `campaigns`, `campaign-link-client`, `simulation-links` |
| Agenda/automação/notificação | `calendar-activities`, `crm-automations`, `crm-automation-options`, `scheduled-activity-notifications`, `push-subscriptions`, `web-push`, `daily-message*`, `daily-report*`, `new-client-sound` |
| Prospecção/Meta Diária/ranking | `prospecting`, `prospecting-auto-return`, `daily-goal`, `daily-goal-wallet`, `daily-goal-progress.mjs`, `do-not-contact-reasons`, `performance-overview`, `scoring-rules`, `opportunities`, `opportunity-scoring` |
| WhatsApp | `whatsapp-master`, `whatsapp-chat`, `whatsapp-flows`, `whatsapp-flow-core.mjs`, `whatsapp-broadcasts`, `whatsapp-automation-replies`, `whatsapp-keyword-match.mjs`, `whatsapp-form-completion.mjs`, `whatsapp-sponsored-lead`, `whatsapp-referral.mjs`, `whatsapp-media`, `whatsapp-media-utils.mjs`, `audio-wav.mjs`, `whatsapp-attendance`, `whatsapp-contact-channel`, `whatsapp-manual-summary`, `whatsapp-profile`, `phone-utils`, `client-phone-lookup`, `webm-opus-to-ogg.mjs` |
| Meta/tráfego | `meta-pixel-shared`, `meta-pixel-client`, `meta-conversions-api`, `meta-ads-config`, `meta-ads-sync` |
| Documentos/IA | `client-documents`, `document-analysis`, `document-requirements-engine`, `document-status-labels`, `document-type-options`, `client-document-pdf`, `cca`, `broker-alert`, `ai-usage` |
| Financeiro | `financial`, `financial-calculations` (+ teste) |
| Catálogo/site | `properties`, `public-properties`, `property-*`, `testimonials`, `public-testimonials`, `captacoes`, `captacoes-schema`, `captacao-notifications`, `simulations`, `simulacao-entrada/*` (motor TS), `media-storage`, `format`, `date-utils`, `name-utils` |
| Legado | `db.js`, `backup.js`, `runtime.js` (SQLite local) |

- **Legado**: `lib/db.js`/`lib/backup.js` (SQLite, `ENABLE_SQLITE`) só rodam fora da Vercel e só para `properties`; em produção estão desligados. `mcmv-calculator/` (motor antigo) está no `.gitignore` e **não existe no repositório**; o motor real é `lib/simulacao-entrada/*`.

## 4. APIs (`app/api`, 151 arquivos de rota)

Todas seguem `guard → try/catch → JSON`. Inventário por domínio (guards em [`PERMISSIONS.md`](PERMISSIONS.md) §6):

| Domínio | Rotas (prefixo `/api/`) |
|---|---|
| Sessão/usuários | `admin/session`, `admin/view-as`, `admin/heartbeat`, `admin/presence(*/report)`, `admin-users`, `admin-users/[id]`, `admin-users/[id]/photo`, `push/subscribe`, `push/unsubscribe`, `push/test` |
| Clientes | `simulation-registrations` (POST público), `…/[id]`, `…/[id]/tags`, `…/[id]/preferences` (token), `…/[id]/whatsapp-contact`, `…/list`, `…/manual`, `…/quick-attendance`, `client-tags`, `client-tags/[id]`, `client-journey/[id]`, `client-journey/settings`, `calendar-activities`, `calendar-activities/[id]`, `calendar-activities/client/[clientId]`, `crm-notifications/[id]`, `crm-notifications/new-client-alerts` |
| Roleta/campanhas | `lead-distribution`, `campaigns(*/[id])`, `campaigns/track-view` |
| Prospecção/Meta Diária | `prospecting`, `prospecting/[id]`, `prospecting/bulk`, `prospecting/broker-bases`, `prospecting/broker-bases/[brokerId]`, `prospecting/clients/[id]`, `daily-goal`, `daily-goal/attempt`, `daily-goal/message-override`, `daily-goal/performance`, `daily-goal/settings`, `daily-goal/team-overview`, `daily-goal/team-overview/[brokerId]`, `daily-goal/top-ranking` |
| Ranking/pontuação | `performance-overview(/points-ledger)`, `scoring-rules(/history)`, `scoring-adjustments`, `daily-report`, `admin/opportunities(*/[id])` |
| Automação | `crm-automation-rules(*/[id])`, `crm-settings/whatsapp-master(/test)`, `daily-message/*` |
| WhatsApp | `webhooks/whatsapp-master`, `whatsapp-master/events`, `whatsapp-contact`, `admin/whatsapp-chat/*` (conversas, mensagens, **mensagens internas**, **excluir conversa**, mídia enviada, **mídia recebida/áudio**, atalhos, modelos, janela, resumo, visão geral), `admin/whatsapp-flows/*`, `admin/whatsapp-broadcasts/*`, `admin/whatsapp-master/*` (respostas, manual, perfil, modelos) |
| Documentos/IA | `admin/client-documents/*` (lotes, confirmar, reanalisar, checklist, documentos, PDF, CCA, reset, aviso), `admin/cca(*/[id])`, `analyze`, `simular-entrada` |
| Financeiro | `financeiro(*/[id])` |
| Catálogo/site | `properties(*/[id])`, `empreendimentos/[id]`, `testimonials(*/[id]/publish)`, `captacoes(*/[id]/publish)`, `simulations`, `simulations/[id]`, `leads`, `uploads/images`, `uploads/documents`, `uploads/testimonials`, `uploads/captacoes` |
| Meta | `admin/meta-ads/backfill`, `admin/meta-ads/sync-status` |
| Cron | `cron/scheduled-activities`, `cron/daily-goal-close`, `cron/daily-report`, `cron/whatsapp-broadcast-dispatch`, `cron/whatsapp-flows`, `cron/meta-ads-intraday-sync`, `cron/meta-ads-daily-consolidation` |

`maxDuration = 55` nos crons de Disparo/Fluxos; `30` no webhook do WhatsApp e na rota de mídia; `60` em `media/recover`. A rota temporária de testes `admin/tmp-chat-tests` **foi removida** (P-21, resolvido no commit `9bcae0c`); o `maxDuration = 30` do webhook é comportamento legítimo atual.

## 5. Autenticação e autorização

Detalhes completos em [`PERMISSIONS.md`](PERMISSIONS.md): Supabase Auth → cookies `mm_admin_*` → `proxy.js` (só existência do cookie) → guards por rota/página → `lib/admin-access.js` (escopo). RLS sem policy pública; service role só no servidor.

## 6. Integrações externas

| Integração | Onde | Variáveis (nomes) | Comportamento em falha |
|---|---|---|---|
| WhatsApp Cloud API | `lib/whatsapp-master.js` (+ chat/flows/broadcasts/profile) | `WHATSAPP_*` (ver `WHATSAPP.md`) | erros classificados (`notSent`/`metaRejected`/desconhecido); nunca reenvia no desconhecido |
| Meta Pixel / Conversions API | `components/MetaPixel.jsx`, `lib/meta-*` | `NEXT_PUBLIC_META_PIXEL_ID`, `META_CONVERSIONS_API_ACCESS_TOKEN` | best-effort, nunca bloqueia cadastro |
| Meta Marketing API (leitura) | `lib/meta-ads-*` | `META_ADS_*` | `missing_config`/`partial`/`failed` |
| Anthropic | `lib/document-analysis.js` (fetch direto, sem SDK) | `ANTHROPIC_API_KEY`, `ANTHROPIC_DOCUMENT_MODEL` (padrão `claude-sonnet-5`) | lote marcado com erro; custo em `ai_usage_log` |
| OpenAI (opcional) | `app/api/analyze/route.js` | `OPENAI_API_KEY`, `OPENAI_MODEL` | sem chave: extração heurística |
| Resend (e-mail) | `lib/*-notifications.js`, `crm-automations.js`, `admin-user-invitation.js` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SIMULATION_NOTIFICATION_EMAIL`, `CAPTACAO_NOTIFICATION_EMAIL`, `ADMIN_EMAIL` | `skipped` com motivo |
| Web Push (VAPID) | `lib/web-push.js`, `push-subscriptions.js` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | nunca lança (assinatura inválida é ignorada) |
| Supabase Storage/Realtime | `lib/media-storage.js`, `lib/whatsapp-chat.js` | `SUPABASE_*_BUCKET`, `SUPABASE_SERVICE_ROLE_KEY` | Realtime best-effort |

**Webhooks recebidos:** apenas o da Meta (`/api/webhooks/whatsapp-master`). Não há webhooks de saída.

## 7. Variáveis de ambiente (nomes — nunca valores)

Usadas no código e presentes em `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_EMAILS`, `ENABLE_SQLITE`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SIMULATION_NOTIFICATION_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SUPABASE_CRON_TOKEN_HASH`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_REMINDER_TEMPLATE_NAME`, `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_META_PIXEL_ID`, `META_CONVERSIONS_API_ACCESS_TOKEN`, `META_ADS_ACCESS_TOKEN`, `META_ADS_AD_ACCOUNT_ID`, `META_ADS_GRAPH_API_VERSION`, `META_ADS_BACKFILL_START_DATE`, `META_ADS_SYNC_WINDOW_DAYS`.

**Usadas no código e AUSENTES de `.env.example`** (documentar lá, sem valor, quando alguém mexer): `ADMIN_OWNER_EMAILS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_DOCUMENT_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `CAPTACAO_NOTIFICATION_EMAIL`, `APP_SECRET` (alias de `WHATSAPP_APP_SECRET`), `WHATSAPP_APP_ID`, `META_APP_ID`, `USD_BRL_RATE`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_TESTIMONIALS_BUCKET`, `SUPABASE_PROPERTY_DOCS_BUCKET`, `SUPABASE_BROKER_AVATARS_BUCKET`, `SUPABASE_CHAT_MEDIA_BUCKET`, `SUPABASE_CLIENT_DOCS_BUCKET`, `SUPABASE_INBOUND_MEDIA_BUCKET`. Runtime/plataforma: `VERCEL`, `VERCEL_URL`, `NODE_ENV`.
Credencial presente no ambiente ≠ ativa: sempre confirme antes de assumir bug de código.

## 8. Cron e funções server-side

Agendados por **`pg_cron` + `pg_net` no Supabase** (não há `vercel.json`): ver tabela em [`DATABASE.md`](DATABASE.md) §5. `cron/scheduled-activities` faz, em ordem: lembretes de atividade legadas → lembretes de `calendar_activities` → `runCrmAutomations` → `reconcileSponsoredLeads` (lead patrocinado) → `reassignOrphanedClientsToOwner`. Funções de banco/RPC: [`DATABASE.md`](DATABASE.md) §4.

## 9. Dependências (`package.json`)

`next 16.2.10`, `react/react-dom 19.2.7`, `@supabase/supabase-js ^2.110`, `zod ^4.4`, `pdf-lib ^1.17`, `xlsx 0.18.5`, `lucide-react 1.23`, Tailwind `3.4.19` + PostCSS/Autoprefixer, TypeScript `^5.9` (dev). **Sem** SDK da Anthropic/Meta/Resend (todas por `fetch`), **sem** biblioteca de push (VAPID nativo em `lib/web-push.js`). Gerenciador: `pnpm` (lockfile). `pnpm-workspace.yaml` só libera build do `sharp`.

## 10. Mapa simplificado de dependências

```
                       ┌──────────────── lib/supabase (50 importadores) ────────────────┐
app/** (172 arquivos usam admin-auth)  ──▶  lib/admin-auth ──▶ lib/admin-profiles ◀── lib/admin-access
                                                              ▲ (54)                ▲ (27)
        ┌─────────────────────────────────────────────────────┴────────────────────┴──────────┐
        │                                                                                      │
 lib/simulation-registrations (23) ──▶ client-status(22), client-status-history, client-tags,  │
        ▲    ▲    ▲    ▲                 client-journey, lead-distribution, campaigns,         │
        │    │    │    │                 financial, crm-clients, lead-origin, meta-conversions │
        │    │    │    └── crm-automations (cron) ──▶ whatsapp-master, push-subscriptions,     │
        │    │    │                                   whatsapp-attendance, lead-distribution   │
        │    │    └── prospecting / daily-goal ──▶ daily-goal-wallet, prospecting-auto-return,  │
        │    │                     └─▶ performance-overview ──▶ scoring-rules, client-status-history
        │    └── client-documents ──▶ document-analysis, requirements-engine, client-document-pdf, cca
        └── whatsapp-chat ◀▶ whatsapp-flows ◀▶ whatsapp-master  (ciclo: uso de import dinâmico)
                 └─▶ phone-utils(23) + client-phone-lookup (estratégia única de telefone)
 lib/campaigns ──▶ performance-overview (usa o funil)          lib/admin-profiles ──▶ campaigns (import dinâmico p/ evitar ciclo)
```

**Áreas compartilhadas de alto risco** (mexer aqui = analisar todos os importadores): `lib/admin-auth.js` (173), `lib/admin-profiles.js` (54), `lib/supabase.js` (50), `lib/admin-access.js` (27), `lib/simulation-registrations.js` (23), `lib/phone-utils.js` (23), `lib/client-status.js` (22), `lib/whatsapp-chat.js` (19), `lib/whatsapp-master.js` e `lib/whatsapp-flows.js` (12 cada), `lib/performance-overview.js` (9). Entre parênteses: nº de arquivos de `app/`, `components/` e `lib/` que os importam. Módulos que alimentam **vários** fluxos: `simulation_registrations` (tabela), `client_status_history` (funil/pontos), `lead_distribution_*`, `crm_notifications`, `whatsapp_conversations`.

## 11. Testes e validação

Sem `lint`, sem `test` em `package.json`, sem CI no repositório (`.github` inexistente). Verificado em 2026-09-24 (Node 24, `node --test`):

| Arquivo | Resultado |
|---|---|
| `tests/broker-gender.test.mjs`, `client-journey.test.mjs`, `daily-goal-progress.test.mjs`, `daily-message-cycle.test.mjs`, `opportunity-scoring.test.mjs`, `phone-utils.test.mjs`, `webm-opus-to-ogg.test.mjs`, `whatsapp-contact-channel.test.mjs`, `whatsapp-form-completion.test.mjs`, `whatsapp-chat-media-referral.test.mjs`, `whatsapp-keyword-match.test.mjs` e `lib/financial-calculations.test.js` | **passam** |
| `tests/whatsapp-flow-core.test.mjs` | 22 de 23 passam; **falha** `modelo 'Menu principal'` (esperado “por Ana, nosso especialista”; o modelo atual gera “Você vai ser atendido(a) por Ana. Já avisamos Ana, …”) |
| `tests/journey-http.test.mjs` | precisa de servidor local em `:3107` (falha sem ele) |
| `tests/journey-auth.integration.mjs` | opt-in (`JOURNEY_QA_CLIENT_ID` + credenciais); cria/apaga usuário temporário — **só em cliente de teste isolado** |
| `supabase/tests/*.sql` | transações com rollback (rodar em banco de teste) |

`pnpm build` (com checagem TS do motor de entrada) é a validação de compilação; **não foi executado** nesta auditoria (sem dependências instaladas; nada foi instalado nem alterado).

## 12. Divergências entre a documentação existente e o código (verificadas em 2026-09-24)

| # | Documento | Diz | O código mostra |
|---|---|---|---|
| D-1 | `.claude/rules/frontend-pwa.md` | lista de Clientes 100% client-side, ~2.400 linhas | busca/filtros/paginação **server-side** (`/api/simulation-registrations/list`, `lib/simulation-list-query.js`), componente com 2.143 linhas |
| D-2 | `.claude/rules/crm-clientes-funil.md` | `client_status_history` é gravado por trigger de banco | é gravado **pelo código** (`recordClientStatusChange`); não há trigger (P-02) |
| D-3 | `.claude/rules/roleta-prospeccao-campanhas.md` | retorno automático da roleta “implementado em `lib/prospecting-auto-return.js` a cada carregamento da lista” | a redistribuição de roleta é a ação `return_to_round_robin` do motor de automações (cron); `prospecting-auto-return` trata **contatos de prospecção** parados ≥ 2 dias e é chamado por `listSimulationRegistrations`/Prospecção — a lista principal atual **não** o chama |
| D-4 | `.claude/rules/auth-permissoes.md` | `requirePrimaryAdminApi` = só o dono; “~30 rotas” | alias de administrador geral; 148 rotas (ver `PERMISSIONS.md` §8) |
| D-5 | `.claude/rules/database-supabase.md` | ~102 migrations; inventário de tabelas “não exaustivo” | 115 migrations; 72 tabelas (o inventário antigo lista ~49; faltam WhatsApp Chat/Fluxos, `meta_ad_*`, presença, `daily_message_*`, `crm_clients/attendances`, `whatsapp_*` novas…) — ver `DATABASE.md` |
| D-6 | `.claude/rules/integracoes-externas.md` | “Cron (Vercel)”, 4 rotas de cron; sem Chat/Fluxos/Meta | crons via **`pg_cron`** (sem `vercel.json`), **7** rotas; Chat, Fluxos, Pixel/CAPI e Meta Ads existem |
| D-7 | `CLAUDE.md` | árvore cita `mcmv-calculator/` e proíbe `scratch/` versionado | `mcmv-calculator/` está no `.gitignore` e **ausente** do clone; `scratch/` **não** está no `.gitignore` |
| D-8 | `README.md`, `supabase/README.md` | SQLite/backup local; “rode `schema.sql`” | produção = Supabase; `schema.sql` só cria `properties` |
| D-9 | `docs/spec-gerador-de-links.md` | tabelas `brokers`/`clients` | schema real: `admin_users`/`simulation_registrations`/`client_origins` (spec = desenho inicial) |
| D-10 | comentários no código | “10 minutos” (`crm-automations.js`), “funil de 8 etapas” (`performance-overview.js`), “gestor vê o mesmo menu do admin” (`AdminMenu.jsx`) | prazo é dado da regra (5 min segundo `.claude/rules`); funil tem 7 macroetapas; gestor usa `adminGroups`, admin usa `ownerGroups` |

Estas divergências **não** foram corrigidas nos arquivos originais (rótulos de proveniência são do dono). Esta camada `docs/` prevalece até alguém reconciliar.

## 13. Problemas identificados durante a auditoria

> **Nenhum foi corrigido** (esta tarefa é só documentação). Severidade = impacto possível, não urgência confirmada. “Confirmado” = comprovado no código; “A CONFIRMAR” = depende de dados/ambiente de produção.

| ID | Problema | Impacto possível | Arquivos |
|---|---|---|---|
| **P-01** | Deduplicação do cadastro casa por **nome idêntico** quando o telefone não bate e carrega **todos** os clientes sem paginação (PostgREST corta em 1.000 linhas) — *confirmado no código; incidência real A CONFIRMAR (volume de clientes/homônimos)* | (a) Duas pessoas com o mesmo nome e telefones diferentes: o 2º formulário **sobrescreve os dados (inclusive telefone)** do 1º e não cria cliente nem gira a roleta. (b) Com > 1.000 clientes, clientes antigos não são encontrados → cadastros duplicados. (c) Cada cadastro dispara a leitura integral da tabela + `autoReturnStaleProspectingContacts()` | `lib/simulation-registrations.js` (`findMatchingRegistration` l.1126, `listSimulationRegistrations` l.332, `createSimulationRegistration`, `createQuickAttendanceRegistration`, `ensureManualSimulationRegistration`) |
| **P-02** | Mudanças de `status` feitas por atualização direta **não gravam** `client_status_history` (ações de card da Prospecção: `prospect`, `in_service`, `return`, `return_to_queue`, `do_not_contact`; fim da 3ª tentativa e materialização da Meta Diária) — *confirmado* | Transições fora do funil cumulativo e da pontuação (`service` etc. leem esse histórico); a timeline compensa parcialmente com `prospecting_history`. Doc existente afirma trigger que não existe | `lib/prospecting.js` (`handleProspectingClientAction`), `lib/daily-goal.js` (`materializeClientOnFirstAttempt`, `registerDailyGoalAttempt`), `lib/client-status-history.js` |
| **P-03** | Para corretor/associado, **toda página** do painel que usa `AdminSectionNav` (≈27 páginas) carrega todos os clientes dele (`listSimulationRegistrations` + `calculateCrmMetrics`) e executa `autoReturnStaleProspectingContacts()` (escrita) numa **leitura** — *confirmado* | Latência e tráfego de banco (histórico de estouro de egress no Supabase); efeito colateral (devolver contatos à fila) disparado por navegação | `components/AdminSectionNav.jsx` l.26–33, `lib/simulation-registrations.js` l.332, `lib/prospecting-auto-return.js` |
| **P-04** | Lembrete de atividade: falha do WhatsApp **interrompe** push/e-mail e a marcação “notificado” → o cron repete **todo minuto** enquanto o modelo (`WHATSAPP_REMINDER_TEMPLATE_NAME`) não existir/aprovado (erro Meta “#132001”, registrado na memória operacional de 2026-09-24) — *confirmado no código* | Nenhum lembrete chega por nenhum canal; ruído/quota de chamadas à Meta e logs a cada minuto | `lib/scheduled-activity-notifications.js` l.10–13, `app/api/cron/scheduled-activities/route.js` |
| **P-05** | Clientes devolvidos à fila (Meta Diária 3ª tentativa, retorno por inatividade, `return`, `do_not_contact`) ficam com `responsible_user_id` nulo e o cron de atividades os **reatribui ao dono** na rodada seguinte — *confirmado no código; agendamento A CONFIRMAR* | Dono acumula clientes “devolvidos” (inclusive `do_not_contact` e `awaiting_return`) como responsável; pode conflitar com “devolver à fila” | `lib/daily-goal.js` (`registerDailyGoalAttempt`), `lib/prospecting.js` (`handleProspectingClientAction`), `lib/prospecting-auto-return.js`, `lib/simulation-registrations.js` (`reassignOrphanedClientsToOwner`) |
| **P-06** | ~~Roleta acionada por WhatsApp não gravava `lead_distribution_history`~~ — **resolvido** em 2026-09-24 (migration `20260924210000`: histórico e vínculo da conversa na mesma transação; também vale para lead patrocinado) | — | `supabase/migrations/20260924210000_whatsapp_chat_internal_delete_sponsored.sql` |
| **P-07** | `POST/DELETE /api/client-tags` exigem só login: **qualquer perfil (inclusive associado)** cria/exclui tags globais; excluir remove a tag de todos os clientes — *confirmado* | Perda/poluição de tags e de histórico de campanha (tag = nome da campanha) | `app/api/client-tags/route.js`, `app/api/client-tags/[id]/route.js`, `lib/client-tags.js` |
| **P-08** | `sendCaptacaoNotification` **nunca é chamada**; captação de imóvel não avisa ninguém. Modal da home grava em `leads` **sem nenhum leitor** no código — *confirmado* | Leads de captação/home podem ficar parados sem o dono saber | `lib/captacao-notifications.js`, `lib/captacoes.js` (`createCaptacao`), `app/api/leads/route.js` |
| **P-09** | Rate limits **em memória** (`/api/leads`, `/api/uploads/captacoes`) não valem em serverless (por instância); formulários públicos de cadastro/captação não têm limite; `uploads/captacoes` grava no bucket público sem login — *confirmado* | Spam de leads/roleta e uso de armazenamento por terceiros | `app/api/leads/route.js`, `app/api/uploads/captacoes/route.js`, `app/api/simulation-registrations/route.js`, `…/quick-attendance/route.js`, `app/api/captacoes/route.js` |
| **P-10** | Identidade do dono e e-mails fixos no código: **duas** implementações de `isOwnerAdminEmail` (só a de `admin-auth` lê env), `AUTOMATION_EMAIL` fixo, perfis “fallback” para e-mails fixos — *confirmado* | Trocar titularidade/e-mail exige alterar código em vários pontos; contas com esses e-mails ganham acesso mesmo sem linha em `admin_users` (perfil de fallback sem escopo de banco) | `lib/admin-auth.js`, `lib/admin-profiles.js`, `lib/crm-automations.js` |
| **P-11** | Resposta pelo Chat **não** atualiza `last_whatsapp_contact_at` (por desenho: atendimento humano usa `last_human_reply_at`) — *confirmado; intenção A CONFIRMAR* | Regras “sem primeiro atendimento”, “cliente aguardando ação” e o tier “lead aguardando” da roleta continuam vendo o cliente como não contatado mesmo após atendimento pelo Chat | `lib/whatsapp-chat.js`, `lib/whatsapp-attendance.js`, `lib/crm-automations.js`, `20260924100000_round_robin_presence_aware.sql` |
| **P-12** | Dois números de WhatsApp no site: `WHATSAPP_PHONE` fixo em `lib/format.js` (Footer, botão flutuante, modal) e o número oficial da API (`WHATSAPP_DISPLAY_PHONE_NUMBER`, botão “Receber minha simulação”) — *confirmado; intenção A CONFIRMAR* | Troca/migração de número exige mexer no código; visitantes podem cair em canais diferentes | `lib/format.js`, `components/Footer.jsx`, `WhatsAppFloatingButton.jsx`, `LeadCaptureModal.jsx`, `app/api/whatsapp-contact/route.js` |
| **P-13** | `meta_ad_insights.attribution_window` é um rótulo constante (`7d_click_1d_view`) que **não é enviado** à API; Conversions API usa `v21.0` fixa — *confirmado* | Métricas de lead podem não corresponder à janela documentada; versão da Graph pode expirar | `lib/meta-ads-config.js`, `lib/meta-ads-sync.js`, `lib/meta-conversions-api.js` |
| **P-14** | Bucket `whatsapp-chat-media` (mídia **enviada**) é criado como **público** (URLs não listadas); de mídia **recebida** só o **áudio** é baixado (bucket privado `whatsapp-inbound-media`); imagem/documento/vídeo do cliente aparecem só como rótulo — *confirmado* | Mídia enviada a clientes acessível por quem tiver o link; foto/documento do cliente não é visível no Chat | `lib/media-storage.js`, `lib/whatsapp-media.js`, `lib/whatsapp-chat.js` |
| **P-15** | Teste `whatsapp-flow-core` quebrado; sem CI/lint/`test` no `package.json` — *confirmado* | Regressões só aparecem manualmente | `tests/whatsapp-flow-core.test.mjs`, `package.json` |
| **P-16** | Gatilho de Fluxo por palavra-chave modo “contém” **sem fronteira de palavra** (as respostas por palavra-chave já usam palavra inteira) — *confirmado; intenção A CONFIRMAR* | Fluxo disparado por palavra dentro de outra (“sim” em “simulação”) | `lib/whatsapp-flow-core.mjs` (`matchTrigger`), `lib/whatsapp-keyword-match.mjs` |
| **P-17** | “Alterar conta” faz `auth.user.email`/`id` virarem os do usuário emulado: `client_status_history.changed_by` (e a pontuação) vão para o **emulado**, enquanto a timeline grava “admin como usuário” — *confirmado* | Ações do admin durante a emulação pontuam para o corretor emulado | `lib/admin-auth.js` (`applyViewAsProfile`), `app/api/simulation-registrations/[id]/route.js`, `lib/performance-overview.js` |
| **P-18** | Higiene do repositório: `README.md` obsoleto; `supabase/schema.sql` só cria `properties`; migrations antigas com nome de 8 dígitos (ordem de replay); `scratch/` fora do `.gitignore`; `mcmv-calculator/` ignorado | Novo desenvolvedor/agente é induzido a erro; replay do zero incompleto | `README.md`, `supabase/README.md`, `supabase/schema.sql`, `.gitignore` |
| **P-19** | Texto de erro visível ao usuário com **codificação corrompida** (“NÃ£o foi possÃ­vel…”) | Mensagens ilegíveis em erros de preferências/cadastro | `app/api/simulation-registrations/[id]/preferences/route.js`, `app/api/simulation-registrations/[id]/route.js`, `lib/simulation-registrations.js` |
| **P-20** | Cron aponta para o host técnico `https://imoveis-mvp.vercel.app` (fixo nas migrations); jobs sem monitoramento/alerta — *confirmado no código; atividade real A CONFIRMAR* | Renomear projeto/domínio ou falha de job passa despercebida | migrations de cron (`*_cron.sql`, `*_sync_crons.sql`, `20260916_daily_goal_closing.sql`) |
| **P-21** | ~~Código TEMPORÁRIO de testes na `main`~~ — **RESOLVIDO** no commit `9bcae0c` (2026-09-25, `chore: remove rota e proteções temporárias de teste do Chat/Roleta/Áudio`). Existiam (commits `TEMP:` de 2026-09-24): trava de envio simulado para destinos `+5500…` em `lib/whatsapp-master.js` (`dryRunForFictionalRecipient`, ID `wamid.DRYRUN…`), pulo de push para conversas `+5500…` em `lib/whatsapp-chat.js` (`notifyInternalMessage`) e a rota `app/api/admin/tmp-chat-tests` (protegida por hash de segredo, rodava no banco de produção). Tudo removido; nenhuma função de produção dependia deles. `maxDuration = 30` do webhook permanece (legítimo). Rota responde 404 em produção. **Resíduo de dados de teste no banco: A CONFIRMAR** (auditoria de leitura pendente/em andamento) | — | `lib/whatsapp-master.js`, `lib/whatsapp-chat.js`, `app/api/webhooks/whatsapp-master/route.js` |

Itens **A CONFIRMAR** adicionais (dados de produção) estão consolidados no fim de [`BUSINESS_RULES.md`](BUSINESS_RULES.md).
