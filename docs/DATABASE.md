# DATABASE — banco de dados (Supabase / Postgres)

> Fonte: `supabase/migrations/*.sql` (116 arquivos), `supabase/schema.sql`, `supabase/tests/*.sql` e todos os `.from("...")`/`.rpc("...")` de `lib/`, `app/`, `components/` (2026-09-24, commit `3c82f72`).
> **Nada foi consultado no banco de produção** nesta auditoria: o que é dado/estado de produção está marcado **A CONFIRMAR**. Regras: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) · Permissões: [`PERMISSIONS.md`](PERMISSIONS.md) · Arquitetura: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) · Manual: [`../AGENTS.md`](../AGENTS.md). Complementa `.claude/rules/database-supabase.md`.

## 1. Como o banco é gerenciado

- Um projeto Supabase de produção (id no `CLAUDE.md`). **Não há `supabase/config.toml`** e não se usa `supabase db push`: o histórico de migrations **é** o schema, e o registro de “quais foram aplicadas” **não é rastreado por ferramenta** → o estado aplicado em produção é **A CONFIRMAR** (consultar antes de assumir). Fluxo real: escrever o `.sql` idempotente, aplicar direto no banco (script Node descartável com `pg` e a connection string do `.env`), depois commitar o arquivo.
- **Nome do arquivo:** `YYYYMMDDHHMMSS_descricao.sql` (14 dígitos). Os mais antigos usam 8 dígitos (`YYYYMMDD_`) — dívida conhecida: a ordenação lexicográfica coloca `_` depois dos dígitos, por isso um replay do zero pode rodar fora de ordem (já corrigido uma vez renomeando um arquivo-base). Nunca criar novo arquivo com 8 dígitos.
- **Idempotência** (`if not exists`, `drop … if exists`, `on conflict do nothing`) é o padrão esperado.
- `supabase/schema.sql` (119 linhas) e `supabase/README.md` estão **obsoletos**: só criam a tabela-base `properties` (a única tabela que **não** nasce em migration — `20260713_property_card_fields.sql` apenas a altera) e `README` cita só “rode schema.sql”. Um banco novo exige `schema.sql` **e** todas as migrations em ordem (e as sementes de `crm_settings`/regras são dados, não migration).
- Testes SQL em transação com rollback: `supabase/tests/client_journey.sql`, `client_origins.sql`, `repeat_simulation_phone.sql`.
- Existe uma camada SQLite local legada (`lib/db.js`, `lib/backup.js`, `ENABLE_SQLITE`) usada **só** por `lib/properties.js`/`app/api/properties*` em ambiente não-Vercel; em produção (`VERCEL=1`) é desativada. Ver `SYSTEM_ARCHITECTURE.md` §Legado.

## 2. Segurança do banco

- **RLS ligado sem policy pública** na grande maioria das tabelas (o aviso do advisor “RLS enabled, no policy” é esperado). Acesso só pela **service role** no servidor (`lib/supabase.js` → `getSupabaseAdminClient()`), que ignora RLS. Autorização real em código (`PERMISSIONS.md`).
- Funções sensíveis: `revoke all … from public, anon, authenticated` + `grant execute … to service_role` (padrão das RPCs novas).
- Exceções com policy pública: `testimonials` (leitura dos publicados) e `admin_users` (“managed by service role”, reforço). O site público lê o catálogo por `lib/public-properties.js`/`lib/public-testimonials.js`.
- O navegador usa a **anon key** só para o Supabase Auth (login/reset) e para o canal Realtime (Broadcast) do Chat; nunca lê tabelas.

## 3. Tabelas por domínio (73 = 72 em migrations + `properties` em `schema.sql`)

| Domínio | Tabelas |
|---|---|
| Usuários / presença | `admin_users`, `admin_presence` (1 linha/usuário, `last_activity_at`), `admin_presence_activity` (marcas por minuto p/ relatório), `push_subscriptions` |
| Catálogo público | `properties` (imóveis **e** empreendimentos de catálogo, `is_development`), `empreendimentos` (regras de entrada em JSON, mesmo id do produto), `testimonials`, `captacoes` (imóveis ofertados por proprietários), `leads` (modal da home — sem leitor no código) |
| Simulação | `simulations`, `simulation_properties`, `simulation_property_benefits` |
| **Clientes** | **`simulation_registrations`** (entidade central), `client_status_history`, `tags`, `client_tags`, `calendar_activities`, camada de compatibilidade `crm_clients` (único por `canonical_phone`) + `crm_attendances` (por `legacy_registration_id`) |
| Jornada / origem | `client_journeys` (token, progresso), `client_journey_events` (timeline), `client_origins` (origem imutável, campanha, UTM) |
| Roleta | `lead_distribution_state` (linha `default`), `lead_distribution_history`; posição/flag em `admin_users` (`lead_distribution_position`, `lead_distribution_enabled`) |
| Campanhas | `campaigns` (kind `official`/personalizada, `link_journey`), `campaign_link_views`, `campaign_link_duplicate_submissions` |
| Prospecção | `prospecting_contacts`, `prospecting_history` |
| Meta Diária | `daily_goals`, `daily_goal_rounds`, `daily_goal_attempts`, `daily_goal_quota_versions`, `daily_goal_wallet_config`, `daily_goal_wallet_broker_overrides` (sem tela), `daily_goal_broker_messages`, `daily_goal_do_not_contact_log`, `daily_goal_abuse_flags`, `daily_goal_pending_freeze` (pendentes congelados por corretor/dia — migration `20260925140000`, aplicada em produção em 2026-09-25) |
| Pontuação | `scoring_rule_versions` (versionada por vigência), `scoring_manual_adjustments` |
| Automação / notificação | `crm_automation_rules`, `crm_automation_executions` (idempotência), `crm_notifications`, `crm_settings` (id → JSON: `whatsapp_master`, `daily_goal_messages`, `daily_message_settings`, `daily_report_dispatch`, `client_journey_statuses`, `client_journey_copy`, `whatsapp_manual_templates`, …) |
| Mensagem diária | `daily_message_cards`, `daily_message_dispatches`, `daily_message_user_history` |
| Documentação / CCA | `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions`, `cca` |
| IA | `ai_usage_log` |
| Financeiro | `financial_sales` (uma por cliente), `financial_expenses`, `financial_payments` |
| WhatsApp | `whatsapp_master_events` (bruto do webhook), `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_chat_shortcuts`, `whatsapp_flows`, `whatsapp_flow_sessions`, `whatsapp_flow_logs`, `whatsapp_automation_replies`, `whatsapp_broadcasts`, `whatsapp_broadcast_messages`, `whatsapp_templates`, `whatsapp_manual_log`, `whatsapp_conversation_audit` (auditoria append-only de exclusão/restauração de conversa; sem FK) |
| Meta Ads (leitura) | `meta_ad_accounts`, `meta_ad_entities`, `meta_ad_insights` (upsert diário por entidade), `meta_ad_sync_state` |

**`simulation_registrations` — colunas que as regras dependem** (não exaustivo): `id`, `client_code`, `full_name`, `phone`, `phone_normalized`, `status`, `last_status_change_at`, `approved_at`, `responsible_user_id`, `previous_responsible_user_id`, `responsible_changed_at`, `distribution_type` (`round_robin` ou vazio), `direct_broker_link`, `journey_type` (`simulation`/`quick_service`), `contact_preference`, `acquisition_context` (jsonb, lido pelo trigger da jornada), `last_whatsapp_contact_at`, `last_admin_email`, `scheduled_activity_at/_type/_note/_notified_at/_completed_at/_completed_by`, `prospecting_contact_id`, `prospecting_assigned_pending`, `prospecting_assigned_by_user_id`, `preferences_access_token`, dados de renda/estado civil (`primary_*`, `secondary_*`, `has_children_under_18`, …), `cpf`, `pis`, `email`, `sale_completed_at`, `service_started_at`, `oldest_birth_date`, `created_at`, `updated_at`.

## 4. Funções, RPCs e triggers (o que a aplicação chama)

| Função | Papel |
|---|---|
| `pick_round_robin_broker(excluded)` | roleta por presença (advisory lock); chamada só por `lib/lead-distribution.js` |
| `assign_round_robin_lead(excluded)` | roleta simples (reserva/fallback; **não alterar**) |
| `whatsapp_get_or_create_roulette_client(...)`, `whatsapp_phone_lock_key` | cliente único por telefone via roleta, atômico; desde `20260924210000` recebe `p_conversation_id` (vincula a conversa e a atribui ao mesmo corretor) e `p_history_details` (grava `lead_distribution_history`) | **[2026-09-26]** cria o cliente em `automated_service` (Atendimento automático), não `pending`; as restrições `simulation_registrations_status_check` e `client_status_history_*_status_check` aceitam o valor novo (migration `20260926140000`).
| `whatsapp_chat_apply_inbound/outbound` | atualização atômica da conversa (não lidas, prévia, janela); `apply_inbound` também **restaura** conversa excluída (`deleted_at = null`) e audita |
| `claim_whatsapp_broadcast_message`, `begin_whatsapp_broadcast_send`, `recover_stuck_whatsapp_broadcast_messages` | fila do Disparo sem duplicidade |
| `increment_whatsapp_automation_reply_count`, `increment_whatsapp_flow_count` | contadores |
| `claim_daily_goal_contacts`, `claim_single_prospecting_contact`, `daily_goal_reserve_wallet_slots`, `daily_goal_active_wallet_count`, `daily_goal_wallet_effective_config`, `set_daily_goal_quota` | Meta Diária/carteira (trava por corretor) |
| `set_scoring_rule_version` | nova versão de regra de pontuação |
| `client_journey_action` | avisar/regenerar token da jornada + auditoria |

**Triggers** (todos em tabelas de negócio):

| Trigger | Tabela | Efeito |
|---|---|---|
| `capture_client_journey` | `simulation_registrations` (insert / update de `status`) | cria/atualiza `client_journeys`, `client_origins` (a partir de `acquisition_context`) e eventos da timeline |
| `guard_client_identity` | `simulation_registrations` (update) | **`client_code` e `acquisition_context` são imutáveis** após a criação (levanta exceção) — origem/contexto só se define no INSERT |
| `simulation_registration_create_financial_sale` | `simulation_registrations` (update de `status`) | cria `financial_sales` ao **entrar** em qualquer dos 8 status de venda (`on conflict (client_id) do nothing`) |
| `simulation_registrations_crm_compat_sync` | `simulation_registrations` | sincroniza `crm_clients`/`crm_attendances` |
| `whatsapp_conversation_assignee_sync` | `simulation_registrations` (update de `responsible_user_id`) | conversa do WhatsApp passa ao novo responsável |
| `guard_original_source`, `merge_legacy_campaign_origin` | `client_origins` | origem imutável / compatibilidade com campanha antiga |
| `*_set_updated_at`, `empreendimentos_set_atualizado_em` | várias | `updated_at` |

⚠ **`client_status_history` NÃO é preenchido por trigger**: é gravado pelo código (`recordClientStatusChange`), inclusive o backfill inicial na migration `20260814`. Atualizações diretas de `status` fora de `updateSimulationRegistration` não geram histórico (P-02).

## 5. Agendamento (`pg_cron` + `pg_net`) — definido nas migrations, ativo em produção **A CONFIRMAR**

Todos chamam `GET` na aplicação (host técnico `https://imoveis-mvp.vercel.app`, fixo nas migrations; a exceção é a URL de atividades agendadas, que vem do Vault) com `Authorization: Bearer <segredo do Vault>` (`crm_cron_secret` no job de atividades agendadas; `crm_automation_cron_token` nos demais — nomes dos segredos, nunca os valores); a rota valida contra `CRON_SECRET` ou `SUPABASE_CRON_TOKEN_HASH`. Horários em **UTC**.

| Job (`cron.schedule`) | Cron | São Paulo | Rota |
|---|---|---|---|
| `whatsapp-master-scheduled-activities` | `* * * * *` | a cada minuto | URL vem do Vault (`crm_scheduled_activities_url`) — esperado: `/api/cron/scheduled-activities` (**A CONFIRMAR**) |
| `whatsapp-broadcast-dispatch-every-minute` | `* * * * *` | a cada minuto | `/api/cron/whatsapp-broadcast-dispatch` |
| `whatsapp-flows-timers-every-minute` | `* * * * *` | a cada minuto | `/api/cron/whatsapp-flows` |
| `daily-report-once-a-day` | `0 1 * * *` | 22:00 | `/api/cron/daily-report` |
| `daily-goal-close-once-a-day` | `10 3 * * *` | 00:10 | `/api/cron/daily-goal-close` (fecha o dia anterior **e** congela as pendências de hoje) |
| `meta-ads-intraday-sync` | `0 1,11,13,15,17,19,21,23 * * *` | 08–22 h (de 2 em 2 h) + 22:00 | `/api/cron/meta-ads-intraday-sync` |
| `meta-ads-daily-consolidation` | `0 9 * * *` | 06:00 | `/api/cron/meta-ads-daily-consolidation` |

Removido: `daily-broker-performance-whatsapp-once-a-day` (`20260922200000`). Não há `vercel.json`: **nenhum cron da Vercel**.

## 6. Storage e Realtime

- Buckets (nome padrão / variável): `property-media` (`SUPABASE_STORAGE_BUCKET`, público — imóveis e fotos de captação), `testimonials` (`SUPABASE_TESTIMONIALS_BUCKET`), `property-documents` (`SUPABASE_PROPERTY_DOCS_BUCKET`), `broker-avatars` (`SUPABASE_BROKER_AVATARS_BUCKET`), `whatsapp-chat-media` (`SUPABASE_CHAT_MEDIA_BUCKET`, **criado como público**, limite 10 MB, ~4 MB por upload na Vercel), `client-documents` (`SUPABASE_CLIENT_DOCS_BUCKET`, privado: upload por URL assinada; leitura por URL assinada de 10 min), `whatsapp-inbound-media` (`SUPABASE_INBOUND_MEDIA_BUCKET`, **privado**, criado pelo código; áudio recebido do cliente, servido por rota autenticada).
- Realtime **Broadcast** do Chat: o servidor faz `POST /realtime/v1/api/broadcast` com tópico derivado por HMAC (`wa-chat-<hash>`, não adivinhável) e sem dados; o navegador refaz a busca pela API autenticada (há polling lento de segurança). Ver `WHATSAPP.md`.

## 7. Regras de schema a nunca quebrar

1. **Nunca UNIQUE por telefone** em `simulation_registrations` (`20260905_unique_client_phone` foi removida por `20260908204500`; um telefone pode ter vários atendimentos). Índices por telefone em `whatsapp_conversations.contact_phone` (único) e `crm_clients.canonical_phone` (único) são de **outras** entidades.
2. `whatsapp_messages.meta_message_id` tem índice único **completo** (não parcial), porque o upsert do PostgREST (`on conflict`) não usa índice parcial.
3. `client_document_checklist_items`: índice único parcial `(client_id, person_role, document_type) where document_id is null`; recalcular por **upsert**.
4. `crm_automation_executions(rule_id, client_id, event_key)` único = idempotência das automações.
5. `meta_ad_insights` é **upsert** (a Meta reajusta atribuição depois) — nunca tratar como imutável.
6. Toda tabela nova: RLS ligado, **sem** policy pública, `revoke` de `anon/authenticated` e `grant` à `service_role`, salvo exceção documentada.
7. `whatsapp_messages.direction` aceita `inbound`/`outbound`/`internal`, e a constraint `whatsapp_messages_internal_consistency` exige `direction='internal'` **se e somente se** `message_type='internal'`. Consultas que leem “mensagens do cliente/da equipe” devem excluir `internal` (a mensagem interna nunca passa pela Meta).
7b. Listagens que podem passar de 1000 linhas precisam paginar (`fetchAllRows`/`.range`): o PostgREST corta silenciosamente em 1000 (ver P-01).
8. Antes de `drop`/`alter` que perde dado: testar num script isolado; nunca em produção sem pedido.

## 8. Dados que **não** estão no repositório (A CONFIRMAR em produção)

Regras em `crm_automation_rules` (NOVO LEAD, TRANSFERÊNCIA MANUAL, REDISTRIBUIÇÃO DE LEADS e seus prazos); `scoring_rule_versions` vigentes; cota diária vigente e limite da carteira; `whatsapp_automation_replies` ativas; `crm_settings` (`whatsapp_master`, textos da Jornada…); segredos do Vault (`crm_automation_cron_token`, `crm_cron_secret`, `crm_scheduled_activities_url`); quais migrations foram realmente aplicadas.
