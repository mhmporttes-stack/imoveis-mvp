-- [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19] Para RECEBER clientes por qualquer distribuição automática (roleta de
-- leads novos, fila de espera, redistribuição, fila de reativação FUN-15l) o WhatsApp do corretor precisa estar
-- CONECTADO no CRM. Desconectado ou com restrição aberta (informada ou validada, PRO-12/13/14) -> é pulado, como offline,
-- sem perder o lugar. "Conectado e ativo" já era exigido (ROL-2d/ROL-2e, whatsapp_user_has_active_number); esta
-- migration acrescenta a restrição aberta no MESMO ponto central (roulette_user_extra_eligible), usado por
-- pick_round_robin_broker e assign_round_robin_lead. O código JS (listOnlineRouletteBrokerIds) aplica o mesmo critério.
-- Idempotente; não mexe em dados.

create or replace function public.roulette_user_extra_eligible(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select public.whatsapp_user_has_active_number(p_user_id)
    and not exists (
      select 1 from public.whatsapp_restrictions r
      where r.user_id = p_user_id and r.ended_at is null
    )
    and public.office_presence_ok(p_user_id);
$function$;

revoke execute on function public.roulette_user_extra_eligible(uuid) from public, anon, authenticated;
grant execute on function public.roulette_user_extra_eligible(uuid) to service_role;
