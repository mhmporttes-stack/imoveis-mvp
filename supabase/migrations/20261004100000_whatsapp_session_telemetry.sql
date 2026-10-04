-- Telemetria de conexão do WhatsApp individual (microsserviço Baileys no Railway).
-- UMA linha por fato (tentativa de conexão, conexão, queda, início/fim de ciclo
-- de reconexão, interrupção por limite, boot do serviço), SEM deduplicação — ao
-- contrário de whatsapp_session_events (que só guarda erros e agrupa repetições
-- em 10 min). Permite responder por SELECT "quantas vezes esta sessão tentou
-- reconectar e em qual intervalo?" (exemplos em docs/WHATSAPP.md).
--
-- Migration ADITIVA e idempotente: só cria tabela/índices/trigger. Não altera
-- nem apaga dado existente e NÃO muda o CHECK de status de
-- whatsapp_individual_sessions (a intervenção usa o status 'error' que já existe).
-- NUNCA guardar aqui credencial, chave, conteúdo de mensagem nem número de
-- telefone: user_id é o id interno do corretor; o texto livre é limitado e
-- sanitizado em lib/whatsapp-session-telemetry-core.mjs.
--
-- Pode ser aplicada ANTES ou DEPOIS do código novo: sem a tabela, o serviço só
-- perde a telemetria (o endpoint responde erro, a sessão não é afetada).

create table if not exists public.whatsapp_session_telemetry (
  id uuid primary key default gen_random_uuid(),
  -- sem FK: o histórico sobrevive à remoção do usuário. NULL só em eventos do próprio serviço.
  user_id uuid,
  event_type text not null check (event_type in (
    'service_boot', 'service_shutdown', 'resume_skipped', 'resume_done',
    'cycle_start', 'cycle_end', 'connect_attempt', 'connected', 'disconnected',
    'retry_scheduled', 'interrupted_limit', 'intervention_required'
  )),
  cycle_id text,
  attempt integer,
  next_attempt integer,
  status_code integer,
  reason text,
  kind text,
  trigger text,
  delay_ms integer,
  connected_ms integer,
  max_retries integer,
  detail text,
  baileys_version text,
  wa_version text,
  wa_version_is_latest boolean,
  boot_id text not null,
  deploy_id text,
  commit_sha text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint whatsapp_session_telemetry_user_required check (
    user_id is not null or event_type in ('service_boot', 'service_shutdown', 'resume_done')
  )
);

create index if not exists whatsapp_session_telemetry_user_idx
  on public.whatsapp_session_telemetry (user_id, occurred_at desc);
create index if not exists whatsapp_session_telemetry_boot_idx
  on public.whatsapp_session_telemetry (boot_id, occurred_at desc);
create index if not exists whatsapp_session_telemetry_type_idx
  on public.whatsapp_session_telemetry (event_type, occurred_at desc);

-- Append-only (mesma função de whatsapp_session_events / whatsapp_restriction_events).
create or replace function public.whatsapp_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Tabela de histórico é append-only (% bloqueado).', tg_op;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_session_telemetry_append_only') then
    create trigger whatsapp_session_telemetry_append_only
      before update or delete on public.whatsapp_session_telemetry
      for each row execute function public.whatsapp_events_append_only();
  end if;
end $$;

-- RLS ligado, sem policy pública: só o servidor (service_role) lê e escreve.
alter table public.whatsapp_session_telemetry enable row level security;
revoke all on public.whatsapp_session_telemetry from anon, authenticated;
grant all on public.whatsapp_session_telemetry to service_role;

comment on table public.whatsapp_session_telemetry is
  'Telemetria append-only de conexão do WhatsApp individual (tentativas, quedas, ciclos de reconexão, boot do serviço, versão do Baileys). Sem credenciais, sem mensagens, sem telefones.';
