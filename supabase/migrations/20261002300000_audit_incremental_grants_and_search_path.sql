-- Auditoria incremental (2026-10-02) sobre os commits depois de 32eb4dd — só endurecimento de permissão,
-- sem nenhuma mudança de dado nem de regra.
--
-- 1) As 3 tabelas novas do Financeiro (Saúde: despesas, ocorrências, configurações) e as 3 antigas do
--    Financeiro (vendas, recebimentos, despesas da venda) tinham RLS ligado e 0 policies — as linhas já
--    estavam bloqueadas — mas ainda mantinham GRANT total (inclusive TRUNCATE, que o RLS não cobre) para
--    anon/authenticated. A regra da casa é RLS ligado + sem policy pública + revoke de anon/authenticated +
--    grant a service_role (todo acesso é pelo servidor, getSupabaseAdminClient). Nenhuma delas é lida pelo
--    navegador (conferido por grep): a mudança não afeta o app.
revoke all on public.financial_operating_expenses from anon, authenticated;
revoke all on public.financial_health_settings from anon, authenticated;
revoke all on public.financial_operating_expense_occurrences from anon, authenticated;
revoke all on public.financial_sales from anon, authenticated;
revoke all on public.financial_payments from anon, authenticated;
revoke all on public.financial_expenses from anon, authenticated;
grant all on public.financial_operating_expenses to service_role;
grant all on public.financial_health_settings to service_role;
grant all on public.financial_operating_expense_occurrences to service_role;
grant all on public.financial_sales to service_role;
grant all on public.financial_payments to service_role;
grant all on public.financial_expenses to service_role;

-- 2) daily_goal_reserve_wallet_slots (nova na fila "Disparar") era executável por anon/authenticated/public;
--    só o servidor (enqueue_extra_prospecting_dispatch, service_role) a chama.
revoke execute on function public.daily_goal_reserve_wallet_slots(uuid, integer) from public, anon, authenticated;
grant execute on function public.daily_goal_reserve_wallet_slots(uuid, integer) to service_role;

-- 3) As duas funções de claim da fila automática ficaram sem search_path fixo (advisor
--    function_search_path_mutable em claim_next_daily_goal_auto_item; a nova claim_next_extra_dispatch_item
--    herdou o mesmo padrão). Mesmo search_path das demais funções da família — comportamento idêntico.
alter function public.claim_next_daily_goal_auto_item(uuid) set search_path = public;
alter function public.claim_next_extra_dispatch_item(uuid) set search_path = public;
