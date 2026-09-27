-- Disparo: (1) sorteio de contatos da Base e (2) ROTINAS de disparo (ex.: todo dia às 8h, 30 mensagens da campanha X).
--
-- Aditiva: 1 tabela nova, 2 colunas anuláveis em whatsapp_broadcasts e 1 função. Nada existente muda de comportamento.

create table if not exists public.whatsapp_broadcast_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_id uuid not null references public.whatsapp_templates(id) on delete restrict,
  daily_count integer not null check (daily_count between 1 and 500),
  -- Horário de Brasília (HH:MM) e dias da semana (0 = domingo ... 6 = sábado).
  run_time text not null default '08:00' check (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days_of_week integer[] not null default '{0,1,2,3,4,5,6}',
  -- Grupo 2 do sorteio (contatos já tocados): só entram os sem contato há pelo menos N dias.
  min_days_since_contact integer not null default 60 check (min_days_since_contact between 0 and 3650),
  destination_journey text not null default 'choice',
  link_campaign_id uuid,
  variable_mapping jsonb,
  enabled boolean not null default false,
  -- Freio: se a fração de falhas do lote anterior passar deste valor, a rotina pausa sozinha.
  max_failure_rate numeric not null default 0.3 check (max_failure_rate > 0 and max_failure_rate <= 1),
  paused_reason text,
  last_run_date date,
  last_run_at timestamptz,
  last_broadcast_id uuid,
  last_error text,
  total_runs integer not null default 0,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_broadcast_schedules enable row level security;
revoke all on public.whatsapp_broadcast_schedules from anon, authenticated;
grant all on public.whatsapp_broadcast_schedules to service_role;

alter table public.whatsapp_broadcasts
  add column if not exists schedule_id uuid references public.whatsapp_broadcast_schedules(id) on delete set null,
  add column if not exists run_date date;

-- Um lote por rotina por dia (duas execuções simultâneas nunca duplicam o disparo).
create unique index if not exists whatsapp_broadcasts_schedule_run_uidx
  on public.whatsapp_broadcasts (schedule_id, run_date) where schedule_id is not null;

-- Índices que o sorteio e a atribuição de respostas usam por telefone.
create index if not exists whatsapp_broadcast_messages_phone_idx on public.whatsapp_broadcast_messages (phone_normalized);
create index if not exists prospecting_contacts_phone_idx on public.prospecting_contacts (phone_normalized);

-- Sorteio da Base da Imobiliária (prospecting_contacts com owner_user_id nulo):
--   Grupo 1: NUNCA contatados (sem cartão de cliente, nunca tentados por corretor, nunca disparados, sem conversa) —
--            escolhidos AO ACASO.
--   Grupo 2: só se faltar gente: os de contato mais ANTIGO (último contato há mais de p_min_days), sem cliente ativo
--            com outro corretor. p_free_owner_ids = donos "livres" (o administrador principal e usuários inativos).
-- Nunca sorteia "não contactar", contato reservado na Meta Diária (claimed/recent_attempt) nem quem tem conversa recente.
create or replace function public.pick_broadcast_base_contacts(
  p_limit integer,
  p_min_days integer default 60,
  p_free_owner_ids uuid[] default '{}'
)
returns table (contact_id uuid, name text, phone text, tier integer, last_contact_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 0), 0);
  v_got integer := 0;
begin
  if v_limit = 0 then
    return;
  end if;

  return query
  select p.id, p.name, p.phone_normalized, 1, null::timestamptz
  from prospecting_contacts p
  where p.owner_user_id is null
    and p.status = 'available'
    and p.registration_id is null
    and p.last_attempt_at is null
    and coalesce(p.phone_normalized, '') <> ''
    and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
    and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
    and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null)
  order by random()
  limit v_limit;
  get diagnostics v_got = row_count;

  if v_got >= v_limit then
    return;
  end if;

  return query
  with candidates as (
    select p.id, p.name, p.phone_normalized as phone,
      greatest(
        p.last_attempt_at,
        (select max(coalesce(b.sent_at, b.queued_at)) from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized),
        (select max(c.last_message_at) from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null),
        (select max(coalesce(r.last_whatsapp_contact_at, r.updated_at)) from simulation_registrations r where r.phone_normalized = p.phone_normalized)
      ) as last_contact
    from prospecting_contacts p
    where p.owner_user_id is null
      -- "recent_attempt" = cliente que um corretor tentou e ficou em espera (cooldown em available_after): só volta quando vencer.
      and (p.status = 'available' or (p.status = 'recent_attempt' and (p.available_after is null or p.available_after <= now())))
      and coalesce(p.phone_normalized, '') <> ''
      and not (p.registration_id is null and p.last_attempt_at is null
               and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
               and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
               and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null))
      and not exists (
        select 1 from simulation_registrations r
        where r.phone_normalized = p.phone_normalized
          and (r.status in ('do_not_contact', 'sale_completed')
               or (r.responsible_user_id is not null and not (r.responsible_user_id = any (p_free_owner_ids))))
      )
  )
  select c.id, c.name, c.phone, 2, c.last_contact
  from candidates c
  where c.last_contact is null or c.last_contact < now() - make_interval(days => greatest(coalesce(p_min_days, 60), 0))
  order by c.last_contact asc nulls first, random()
  limit (v_limit - v_got);
end;
$$;

revoke all on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) to service_role;
