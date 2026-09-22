# Banco de dados e Supabase

Postgres 17 no Supabase, projeto `tshhasbbchjcvhoyizoo`, região `us-west-2`. ~102 migrations incrementais em `supabase/migrations/` (nenhum schema único "canônico" — o histórico de migrations É o schema).

## Como as migrations funcionam aqui

- Nome do arquivo: `YYYYMMDDHHMMSS_descricao.sql` (14 dígitos, timestamp completo). **Nunca use `YYYYMMDD_descricao.sql` (8 dígitos)** — a ordenação lexicográfica de string coloca esse formato DEPOIS de qualquer timestamp completo do mesmo dia, porque `_` (0x5F) vem depois dos dígitos em ASCII. Isso já causou um bug real: duas migrations de 21/09/2026 faziam `ALTER TABLE`/`CREATE INDEX` numa tabela que só era criada por um arquivo `YYYYMMDD_` do mesmo dia — em qualquer replay do zero, elas rodariam antes da tabela existir. Corrigido renomeando o arquivo-base para `..._000000_...`.
- **Não há `supabase/config.toml`** — este projeto não usa `supabase db push`/CLI para deploy de schema, então não há tracking de migrations aplicadas pela ferramenta. O fluxo real: escrever o `.sql`, aplicar direto em produção via script Node descartável usando o client `pg` com a connection string do `.env`, depois commitar o arquivo `.sql` (registro, não fonte de aplicação).
- Migrations usam `create table if not exists`, `create index if not exists`, `drop constraint if exists` antes de recriar — idempotência é o padrão esperado neste projeto, mantenha isso em migrations novas.
- Nomes de arquivo variam entre formatos ao longo do histórico (alguns dias têm `_leads_filters.sql` sem hora nenhuma) — isso é dívida técnica conhecida, não motivo para reproduzir o mesmo padrão em migrations novas.

## RLS não é a camada de autorização real

A maioria das tabelas tem `enable row level security` mas **sem nenhuma policy pública** — nenhuma linha é acessível para `anon`/`authenticated` diretamente. Isso é proposital: o app usa `SUPABASE_SERVICE_ROLE_KEY` no servidor (que ignora RLS) para tudo, e a autorização real acontece em código (`lib/admin-access.js`, `lib/admin-auth.js`). O advisor do Supabase avisa "RLS enabled, no policy" para essas tabelas — isso é esperado, não um bug a corrigir criando policies aleatórias.

Exceções com policy pública de verdade, por serem genuinamente lidas fora do servidor:
- `testimonials` — leitura pública dos depoimentos publicados (`supabase/migrations/20260714_testimonials.sql`).
- `admin_users` — policy "managed by service role" (reforço, não abre acesso).

Ao criar uma tabela nova: siga o padrão (RLS habilitado, sem policy pública) a menos que a tabela seja genuinamente destinada a leitura direta do browser com a anon key — nesse caso, escreva a policy explicitamente e documente por quê.

## Nunca recrie UNIQUE por telefone

Incidente real (corrigido 08/09/2026, ver `supabase/migrations/20260908204500_allow_repeat_simulation_phone.sql`): um índice `simulation_registrations_phone_normalized_unique` impedia um cliente de ser recadastrado com o mesmo telefone, quebrando a regra de negócio real (um telefone pode ter vários atendimentos distintos, inclusive com corretores diferentes — um novo atendimento é um novo registro, não uma fusão). Identidade de um cadastro é o `id`, nunca o telefone. Qualquer rotina que agrupe por telefone precisa ser revisada com cuidado para não fundir atendimentos que deveriam ser distintos.

## Inventário de tabelas por domínio (não exaustivo — confirme com Grep antes de assumir)

| Domínio | Tabelas |
|---|---|
| Usuários/perfis | `admin_users` |
| Catálogo público | `properties`, `empreendimentos`, `testimonials`, `captacoes`, `leads` |
| CRM/simulações | `simulation_registrations`, `simulations`, `simulation_properties`, `simulation_property_benefits` |
| Status/histórico/tags | `client_status_history`, `tags`, `client_tags` |
| Jornada pública do cliente | `client_journeys`, `client_journey_events`, `client_origins` |
| Agenda | `calendar_activities` |
| Automação/notificação | `crm_automation_rules`, `crm_automation_executions`, `crm_notifications`, `crm_settings` |
| Roleta/distribuição | `lead_distribution_state`, `lead_distribution_history` |
| Campanhas | `campaigns`, `campaign_link_views` |
| Prospecção | `prospecting_contacts`, `prospecting_history` |
| Meta Diária / carteira | `daily_goals`, `daily_goal_rounds`, `daily_goal_attempts`, `daily_goal_quota_versions`, `daily_goal_wallet_config`, `daily_goal_broker_messages`, `daily_goal_do_not_contact_log`, `daily_goal_abuse_flags` |
| Documentação do cliente / CCA | `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions`, `cca` |
| Gastos de IA | `ai_usage_log` |
| Financeiro | `financial_sales`, `financial_expenses`, `financial_payments` |
| WhatsApp | `whatsapp_master_events`, `whatsapp_broadcasts`, `whatsapp_broadcast_messages`, `whatsapp_templates` |
| Push/mensagem diária | `push_subscriptions` (mensagem diária usa `crm_settings` + tabela própria — confirme antes de assumir o nome exato) |

Antes de confiar nesta lista para uma mudança de schema, rode `grep -roh '\.from("[a-z_]*")' lib/ | sort -u` para confirmar contra o código atual — este arquivo pode ficar desatualizado se tabelas forem adicionadas depois.

## Fetch de listas grandes

Várias funções em `lib/*.js` usam um helper `fetchAllRows` que pagina em blocos de 1000 para contornar o limite padrão do PostgREST — ao escrever uma query nova que pode retornar mais de 1000 linhas, use o mesmo padrão em vez de `.select()` sem `.range()`/paginação (senão a lista trunca silenciosamente em 1000).

## Chave administrativa

`SUPABASE_SERVICE_ROLE_KEY` só é usada em código server-only (`lib/supabase.js` → `getSupabaseAdminClient()`, importado por arquivos com `import "server-only"` no topo). Nunca importe esse client num Client Component nem passe a chave para o browser.
