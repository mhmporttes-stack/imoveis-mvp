-- Lease (arrendamento) do microsserviço WhatsApp individual: DONO ÚNICO das sessões.
--
-- Por quê: cada `git push` em main republicava o serviço no Railway; o serviço
-- novo subia e o antigo só recebia SIGTERM alguns segundos depois. Nesse intervalo
-- havia DUAS instâncias com a mesma sessão do WhatsApp -> erro 440 ("conexão
-- substituída") e risco de logout. O serviço agora só conecta/retoma sessões
-- enquanto detém este lease; o novo ESPERA o antigo liberar (SIGTERM) ou o lease
-- expirar (TTL curto, renovado a cada ~15 s).
--
-- Migration ADITIVA e idempotente (pode rodar mais de uma vez; nada é apagado):
--   1) tabela public.whatsapp_service_lease (RLS ligado, só service_role);
--   2) três funções atômicas (compare-and-set): acquire / renew / release;
--   3) amplia (aditivamente) o CHECK da telemetria com os eventos novos de lease
--      e de reconciliação — todos os tipos antigos continuam válidos.
-- Pode ser aplicada ANTES ou DEPOIS do código novo: sem a tabela/funções o serviço
-- funciona como antes (sem lease) e registra aviso no log — nada cai.
-- NUNCA guardar aqui credencial, mensagem ou telefone: só ids técnicos de processo.

create table if not exists public.whatsapp_service_lease (
  id text primary key,
  owner_boot_id text not null,
  owner_deploy_id text,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_service_lease enable row level security;
revoke all on public.whatsapp_service_lease from anon, authenticated;
grant all on public.whatsapp_service_lease to service_role;

comment on table public.whatsapp_service_lease is
  'Lease distribuído do whatsapp-individual-service (dono único das sessões Baileys). Uma linha por serviço; acquire/renew/release atômicos. Sem credenciais, sem mensagens.';

-- ACQUIRE: obtém o lease se estiver livre (nunca criado, liberado, expirado ou já nosso).
-- Retorno (jsonb): acquired, took_over (outro dono anterior), previous_released (o anterior
-- liberou no SIGTERM = passagem limpa), expires_at; se negado: holder_boot_id,
-- holder_deploy_id, retry_after_ms.
create or replace function public.whatsapp_service_lease_acquire(
  p_id text,
  p_boot_id text,
  p_deploy_id text,
  p_ttl_seconds integer default 60
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ttl integer := greatest(10, least(coalesce(p_ttl_seconds, 60), 300));
  v_expires timestamptz := clock_timestamp() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 60), 300)));
  v_row public.whatsapp_service_lease%rowtype;
begin
  if coalesce(p_id, '') = '' or coalesce(p_boot_id, '') = '' then
    raise exception 'whatsapp_service_lease_acquire: id e boot_id são obrigatórios';
  end if;

  insert into public.whatsapp_service_lease (id, owner_boot_id, owner_deploy_id, acquired_at, heartbeat_at, expires_at, released_at)
  values (p_id, p_boot_id, p_deploy_id, v_now, v_now, v_expires, null)
  on conflict (id) do nothing;
  if found then
    return jsonb_build_object('acquired', true, 'took_over', false, 'previous_released', false, 'first', true, 'expires_at', v_expires);
  end if;

  -- Serializa quem disputa a mesma linha: o segundo vê o dono novo e é negado.
  select * into v_row from public.whatsapp_service_lease where id = p_id for update;

  if v_row.owner_boot_id = p_boot_id or v_row.released_at is not null or v_row.expires_at <= v_now then
    update public.whatsapp_service_lease
       set owner_boot_id = p_boot_id,
           owner_deploy_id = p_deploy_id,
           acquired_at = case when v_row.owner_boot_id = p_boot_id and v_row.released_at is null then v_row.acquired_at else v_now end,
           heartbeat_at = v_now,
           expires_at = v_expires,
           released_at = null
     where id = p_id;
    return jsonb_build_object(
      'acquired', true,
      'took_over', v_row.owner_boot_id <> p_boot_id,
      'previous_released', (v_row.owner_boot_id <> p_boot_id and v_row.released_at is not null),
      'first', false,
      'expires_at', v_expires
    );
  end if;

  return jsonb_build_object(
    'acquired', false,
    'holder_boot_id', v_row.owner_boot_id,
    'holder_deploy_id', v_row.owner_deploy_id,
    'expires_at', v_row.expires_at,
    'retry_after_ms', greatest(0, (extract(epoch from (v_row.expires_at - v_now)) * 1000)::integer)
  );
end
$$;

-- RENEW: só o dono atual (e ainda não liberado) estende. Se outro assumiu, retorna renewed=false.
create or replace function public.whatsapp_service_lease_renew(
  p_id text,
  p_boot_id text,
  p_ttl_seconds integer default 60
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := clock_timestamp() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 60), 300)));
begin
  update public.whatsapp_service_lease
     set heartbeat_at = v_now, expires_at = v_expires
   where id = p_id and owner_boot_id = p_boot_id and released_at is null;
  if found then
    return jsonb_build_object('renewed', true, 'expires_at', v_expires);
  end if;
  return jsonb_build_object('renewed', false);
end
$$;

-- RELEASE: o dono libera (SIGTERM). Quem não é o dono não consegue liberar o lease de outro.
create or replace function public.whatsapp_service_lease_release(
  p_id text,
  p_boot_id text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.whatsapp_service_lease
     set released_at = v_now, expires_at = v_now
   where id = p_id and owner_boot_id = p_boot_id and released_at is null;
  return jsonb_build_object('released', found);
end
$$;

revoke all on function public.whatsapp_service_lease_acquire(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.whatsapp_service_lease_renew(text, text, integer) from public, anon, authenticated;
revoke all on function public.whatsapp_service_lease_release(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_service_lease_acquire(text, text, text, integer) to service_role;
grant execute on function public.whatsapp_service_lease_renew(text, text, integer) to service_role;
grant execute on function public.whatsapp_service_lease_release(text, text) to service_role;

-- Telemetria: eventos novos (aditivo). Os 12 tipos antigos continuam válidos.
do $$
declare
  v_name text;
begin
  if to_regclass('public.whatsapp_session_telemetry') is null then
    return;
  end if;

  -- Os dois CHECKs são removidos PELO NOME: o Postgres guarda a definição como `event_type = ANY (ARRAY[...])`,
  -- então um filtro por texto ('event_type in') não os encontra (erro visto na aplicação em produção, 04/10).
  alter table public.whatsapp_session_telemetry drop constraint if exists whatsapp_session_telemetry_event_type_check;
  alter table public.whatsapp_session_telemetry drop constraint if exists whatsapp_session_telemetry_user_required;

  alter table public.whatsapp_session_telemetry
    add constraint whatsapp_session_telemetry_event_type_check check (event_type in (
      'service_boot', 'service_shutdown', 'resume_skipped', 'resume_done',
      'cycle_start', 'cycle_end', 'connect_attempt', 'connected', 'disconnected',
      'retry_scheduled', 'interrupted_limit', 'intervention_required',
      'lease_acquired', 'lease_waiting', 'lease_released', 'lease_lost', 'lease_unavailable',
      'session_reconciled'
    ));
  alter table public.whatsapp_session_telemetry
    add constraint whatsapp_session_telemetry_user_required check (
      user_id is not null or event_type in (
        'service_boot', 'service_shutdown', 'resume_done',
        'lease_acquired', 'lease_waiting', 'lease_released', 'lease_lost', 'lease_unavailable'
      )
    );
end
$$;
