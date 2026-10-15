-- ROL-2f (dono, 2026-10-15): o ícone do prédio no painel Online fica VERDE só quando a pessoa está no Wi-Fi da
-- imobiliária AGORA; quem veio hoje mas saiu continua apto na roleta até 9h (contorno verde). Guarda a última vez
-- que o heartbeat chegou pelo Wi-Fi do escritório. A regra da roleta (office_presence_ok / valid_until) NÃO muda.

alter table public.office_presence_checkins add column if not exists last_wifi_seen_at timestamptz;

create or replace function public.register_office_checkin(p_user_id uuid, p_source text, p_ip text default null, p_released_by uuid default null)
returns timestamptz
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_until timestamptz;
begin
  insert into public.office_presence_checkins (user_id, checkin_date, first_seen_at, valid_until, source, ip, released_by, last_wifi_seen_at)
  values (p_user_id, (v_now at time zone 'America/Sao_Paulo')::date, v_now, public.office_presence_valid_until(v_now), p_source, p_ip, p_released_by,
          case when p_source = 'wifi' then v_now end)
  on conflict (user_id, checkin_date) do update
    set last_wifi_seen_at = case when excluded.source = 'wifi' then v_now else public.office_presence_checkins.last_wifi_seen_at end;
  select max(valid_until) into v_until from public.office_presence_checkins where user_id = p_user_id;
  return v_until;
end;
$function$;

revoke execute on function public.register_office_checkin(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.register_office_checkin(uuid, text, text, uuid) to service_role;
