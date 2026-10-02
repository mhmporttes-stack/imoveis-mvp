-- Resposta à Prospecção pelo WhatsApp conectado por QR (pedido do dono,
-- 2026-10-02). Aditiva e idempotente: duas tabelas novas, 4 colunas novas
-- no log de "Não contactar" já existente e uma função de upsert atômico.
-- Nada existente é alterado ou apagado.

-- 1) Idempotência da automação de resposta, INDEPENDENTE do Chat: cada
-- mensagem recebida (wa_message_id do WhatsApp) é processada uma vez só pela
-- Prospecção, mesmo se o serviço reentregar o evento ou se a gravação no
-- Chat (whatsapp_messages) falhar.
create table if not exists public.whatsapp_inbound_events (
  wa_message_id text primary key,
  session_user_id uuid references public.admin_users(id) on delete set null,
  phone_normalized text,
  message_at timestamptz,
  prospecting_outcome text,
  prospecting_processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2) Pendência "Cliente respondeu — atualizar status" (kind = reply) e
-- "Cliente em Não contactar mandou mensagem" (kind = reactivation). Uma só
-- pendência ABERTA por cliente (índice único parcial) — várias mensagens
-- seguidas só atualizam a mesma linha.
create table if not exists public.prospecting_reply_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  broker_id uuid references public.admin_users(id) on delete set null,
  session_user_id uuid references public.admin_users(id) on delete set null,
  kind text not null check (kind in ('reply', 'reactivation')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  message_count integer not null default 1,
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  last_message_preview text,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists prospecting_reply_alerts_open_client_uidx
  on public.prospecting_reply_alerts (client_id) where status = 'open';
create index if not exists prospecting_reply_alerts_open_broker_idx
  on public.prospecting_reply_alerts (broker_id, last_message_at desc) where status = 'open';

-- 3) Registro do opt-out automático no MESMO log de "Não contactar" já usado
-- pela Prospecção/Meta Diária (origin = 'whatsapp_auto_opt_out'): mensagem
-- recebida, horário, sessão (número do corretor) e id da mensagem.
alter table public.daily_goal_do_not_contact_log
  add column if not exists message_text text,
  add column if not exists message_at timestamptz,
  add column if not exists session_user_id uuid references public.admin_users(id) on delete set null,
  add column if not exists wa_message_id text;

-- Padrão do projeto: RLS ligado, sem policy pública; acesso só pela
-- service role no servidor.
alter table public.whatsapp_inbound_events enable row level security;
alter table public.prospecting_reply_alerts enable row level security;
revoke all on table public.whatsapp_inbound_events, public.prospecting_reply_alerts from anon, authenticated;
grant all on table public.whatsapp_inbound_events, public.prospecting_reply_alerts to service_role;

-- 4) Abre ou atualiza a pendência aberta do cliente de forma atômica (duas
-- mensagens quase simultâneas nunca criam duas pendências).
create or replace function public.upsert_prospecting_reply_alert(
  p_client_id uuid,
  p_contact_id uuid,
  p_broker_id uuid,
  p_session_user_id uuid,
  p_kind text,
  p_message_at timestamptz,
  p_preview text
) returns table (alert_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.prospecting_reply_alerts a
     set message_count = a.message_count + 1,
         last_message_preview = case when p_message_at >= a.last_message_at then p_preview else a.last_message_preview end,
         last_message_at = greatest(a.last_message_at, p_message_at),
         updated_at = now()
   where a.client_id = p_client_id and a.status = 'open'
   returning a.id into v_id;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  begin
    insert into public.prospecting_reply_alerts (client_id, contact_id, broker_id, session_user_id, kind, first_message_at, last_message_at, last_message_preview)
    values (p_client_id, p_contact_id, p_broker_id, p_session_user_id, p_kind, p_message_at, p_message_at, p_preview)
    returning id into v_id;
    return query select v_id, true;
  exception when unique_violation then
    update public.prospecting_reply_alerts a
       set message_count = a.message_count + 1,
           last_message_at = greatest(a.last_message_at, p_message_at),
           updated_at = now()
     where a.client_id = p_client_id and a.status = 'open'
     returning a.id into v_id;
    return query select v_id, false;
  end;
end;
$$;

revoke all on function public.upsert_prospecting_reply_alert(uuid, uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.upsert_prospecting_reply_alert(uuid, uuid, uuid, uuid, text, timestamptz, text) to service_role;
