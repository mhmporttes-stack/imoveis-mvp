-- Automação da Meta Diária pelo WhatsApp individual do corretor (QR code),
-- só a 1ª tentativa de cada contato (follow-ups continuam manuais). Opt-in
-- por corretor, nunca liga sozinho. Mesmo padrão de auth/RLS já usado em
-- broker_celebration_events e whatsapp_broadcast_* deste projeto.

-- Configuração/estado por corretor. Uma linha só existe depois que o
-- corretor liga a automação pela 1ª vez (upsert feito pela API).
create table if not exists public.daily_goal_auto_settings (
  broker_id uuid primary key references public.admin_users(id) on delete cascade,
  enabled boolean not null default false,
  paused boolean not null default false,
  paused_reason text,
  consecutive_errors integer not null default 0,
  warmup_start_date date,
  daily_cap_override integer,
  window_start_minutes integer not null default 480, -- 08:00
  window_end_minutes integer not null default 1080,  -- 18:00
  min_gap_minutes integer not null default 20,
  max_gap_minutes integer not null default 40,
  business_days_only boolean not null default true,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fila de envios agendados. Um item = uma tentativa (hoje sempre
-- attempt_number = 1) de um round específico, com horário-alvo já sorteado.
-- status 'sending' é o estado transitório entre o claim (FOR UPDATE SKIP
-- LOCKED) e o resultado do envio — nunca deve ficar assim por muito tempo;
-- serve de trava contra duas execuções do cron pegarem o mesmo item.
create table if not exists public.daily_goal_auto_queue (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.daily_goal_rounds(id) on delete cascade,
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  contact_id uuid references public.prospecting_contacts(id) on delete cascade,
  attempt_number integer not null default 1,
  message_text text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'error', 'canceled')),
  skip_reason text,
  last_error text,
  attempts_count integer not null default 0,
  sent_at timestamptz,
  wa_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, attempt_number)
);

create index if not exists daily_goal_auto_queue_dispatch_idx
  on public.daily_goal_auto_queue (broker_id, status, scheduled_for);

create index if not exists daily_goal_auto_queue_contact_idx
  on public.daily_goal_auto_queue (contact_id, status);

-- Origem da tentativa (manual/automática) — item 7 do pedido: precisa
-- aparecer no relatório de Desempenho, sem depender de tabela separada.
alter table public.daily_goal_attempts
  add column if not exists origin text not null default 'manual' check (origin in ('manual', 'auto'));

-- Reivindica (no máximo) 1 item pronto para envio de um corretor, de forma
-- atômica — evita que duas execuções concorrentes do cron mandem a mesma
-- mensagem duas vezes (mesmo padrão de claim_daily_goal_contacts, que já usa
-- FOR UPDATE SKIP LOCKED para o mesmo tipo de corrida).
create or replace function public.claim_next_daily_goal_auto_item(p_broker_id uuid)
returns public.daily_goal_auto_queue
language plpgsql
as $$
declare
  v_id uuid;
  v_row public.daily_goal_auto_queue;
begin
  select id into v_id
  from public.daily_goal_auto_queue
  where broker_id = p_broker_id
    and status = 'pending'
    and scheduled_for <= now()
  order by scheduled_for asc
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.daily_goal_auto_queue
  set status = 'sending', updated_at = now()
  where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

alter table public.daily_goal_auto_settings enable row level security;
alter table public.daily_goal_auto_queue enable row level security;

revoke all on public.daily_goal_auto_settings from anon, authenticated;
revoke all on public.daily_goal_auto_queue from anon, authenticated;

grant all on public.daily_goal_auto_settings to service_role;
grant all on public.daily_goal_auto_queue to service_role;

-- A cada 5 minutos (não a cada minuto: a aleatoriedade de 20-40min entre
-- envios já vem do scheduled_for de cada item da fila, não da cadência do
-- cron). Mesmo padrão de autenticação/agendamento dos outros crons deste
-- projeto (crm_automation_cron_token, net.http_get).
select cron.schedule(
  'whatsapp-meta-diaria-dispatch-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/whatsapp-meta-diaria-dispatch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
