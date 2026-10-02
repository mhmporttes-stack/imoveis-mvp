-- Fecha a exposição restante apontada pelo advisor de segurança do Supabase
-- (rls_disabled_in_public, ERROR) em 9 tabelas + 1 função SECURITY DEFINER.
--
-- Mapeamento feito antes desta migration (leitura de código + catálogo do
-- Postgres, nenhuma alteração de dado):
--   - crm_clients / crm_attendances: camada de compatibilidade (lib/crm-clients.js,
--     lib/simulation-registrations.js), só lidas/escritas via service role
--     (getSupabaseAdminClient). Nenhuma rota pública nem componente cliente
--     as toca.
--   - whatsapp_broadcasts / whatsapp_broadcast_messages / whatsapp_templates:
--     usadas só em lib/whatsapp-*.js (service role). O serviço externo de
--     WhatsApp individual (Railway) nunca fala com o Supabase direto — fala
--     só com o Next.js via webhook com secredo compartilhado
--     (whatsapp-individual-service/src/db.js) e não toca nessas tabelas.
--   - daily_goal_abuse_flags / daily_goal_wallet_config /
--     daily_goal_wallet_broker_overrides / daily_goal_do_not_contact_log:
--     usadas só em lib/daily-goal-wallet.js (service role). Overrides por
--     corretor ainda não tem tela (tabela existe, sem uso hoje) — mesmo
--     tratamento preventivo.
--   - Nenhuma das 9 tabelas tem policy hoje (pg_policies vazio) nem
--     subscription de Realtime (só existem 2 canais Broadcast no repo
--     inteiro, nenhum postgres_changes, nenhum nestas tabelas).
--   - Todas com grant total (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) para
--     anon E authenticated antes desta migration (GRANT default do Supabase
--     ao criar a tabela) com RLS desligado — ou seja, qualquer um com a
--     chave anon pública podia ler/escrever/apagar direto via REST,
--     ignorando o CRM. crm_clients/crm_attendances são as mais sensíveis
--     (dados pessoais via a camada de compatibilidade).
--
-- Estratégia (menor privilégio, mesmo padrão já usado nas tabelas
-- documentais corrigidas anteriormente — RLS ligado, sem policy pública,
-- acesso só via service role no servidor): nenhuma delas precisa de acesso
-- direto do navegador, então RLS liga e NENHUMA policy é criada — não há
-- "pior caso B" aqui, é sempre o caso A.
begin;

alter table public.crm_clients enable row level security;
alter table public.crm_attendances enable row level security;
alter table public.whatsapp_broadcasts enable row level security;
alter table public.whatsapp_broadcast_messages enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.daily_goal_abuse_flags enable row level security;
alter table public.daily_goal_wallet_config enable row level security;
alter table public.daily_goal_wallet_broker_overrides enable row level security;
alter table public.daily_goal_do_not_contact_log enable row level security;

revoke all on public.crm_clients from anon, authenticated;
revoke all on public.crm_attendances from anon, authenticated;
revoke all on public.whatsapp_broadcasts from anon, authenticated;
revoke all on public.whatsapp_broadcast_messages from anon, authenticated;
revoke all on public.whatsapp_templates from anon, authenticated;
revoke all on public.daily_goal_abuse_flags from anon, authenticated;
revoke all on public.daily_goal_wallet_config from anon, authenticated;
revoke all on public.daily_goal_wallet_broker_overrides from anon, authenticated;
revoke all on public.daily_goal_do_not_contact_log from anon, authenticated;

grant all on public.crm_clients to service_role;
grant all on public.crm_attendances to service_role;
grant all on public.whatsapp_broadcasts to service_role;
grant all on public.whatsapp_broadcast_messages to service_role;
grant all on public.whatsapp_templates to service_role;
grant all on public.daily_goal_abuse_flags to service_role;
grant all on public.daily_goal_wallet_config to service_role;
grant all on public.daily_goal_wallet_broker_overrides to service_role;
grant all on public.daily_goal_do_not_contact_log to service_role;

-- log_client_meta_attribution(): função de TRIGGER (RETURNS trigger) presa a
-- client_meta_attribution_log_trigger em client_meta_attribution — nunca
-- deveria ser chamável como RPC solto (/rest/v1/rpc/...), só pelo mecanismo
-- de trigger do Postgres, que independe deste grant. search_path já estava
-- correto (search_path=public, pg_temp, confirmado via pg_proc) — só o
-- EXECUTE via RPC direto precisa ser fechado. Revogar aqui NÃO afeta o
-- trigger (ele continua disparando normalmente em todo INSERT/UPDATE de
-- client_meta_attribution) — não quebra a atribuição de leads da Meta.
revoke execute on function public.log_client_meta_attribution() from anon, authenticated, public;

commit;
