-- Alexa V3: estoque de clientes por corretor e status em UMA consulta agrupada
-- (a regra de etapas/grupos continua no código; aqui só se conta). Só lê.
create or replace function public.crm_status_counts_by_broker()
returns table (responsible_user_id uuid, status text, total bigint)
language sql
stable
as $$
  select responsible_user_id, coalesce(status, '') as status, count(*)::bigint as total
  from public.simulation_registrations
  group by responsible_user_id, coalesce(status, '');
$$;

revoke all on function public.crm_status_counts_by_broker() from public, anon, authenticated;
grant execute on function public.crm_status_counts_by_broker() to service_role;
