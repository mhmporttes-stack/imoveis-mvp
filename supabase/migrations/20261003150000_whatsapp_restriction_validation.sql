-- Estados do WhatsApp restringido: informada -> validada (admin/gestora) ou
-- rejeitada ("Não validar"), + histórico append-only + instrumentação de
-- desconexão. Migration ADITIVA e idempotente: só adiciona colunas/tabelas;
-- não altera nem apaga dado existente. NÃO libera Prospecção/Meta Diária.

-- 1) Validação na restrição (linhas existentes ficam 'informed', sem validação).
alter table public.whatsapp_restrictions
  add column if not exists validation_status text not null default 'informed',
  add column if not exists validation_origin text,
  add column if not exists validated_by uuid references public.admin_users(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists validation_reason text,
  add column if not exists technical_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_restrictions_validation_status_check') then
    alter table public.whatsapp_restrictions
      add constraint whatsapp_restrictions_validation_status_check
      check (validation_status in ('informed', 'validated', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_restrictions_validation_origin_check') then
    alter table public.whatsapp_restrictions
      add constraint whatsapp_restrictions_validation_origin_check
      check (validation_origin is null or validation_origin in ('admin', 'gestora', 'evidencia_tecnica'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_restrictions_validation_consistent') then
    alter table public.whatsapp_restrictions
      add constraint whatsapp_restrictions_validation_consistent
      check (
        (validation_status = 'informed' and validation_origin is null and validated_at is null)
        or (validation_status in ('validated', 'rejected') and validation_origin is not null and validated_at is not null)
      );
  end if;
end $$;

-- 2) Histórico append-only das alterações de restrição (sem FK: sobrevive à
--    remoção de usuário; UPDATE/DELETE bloqueados por trigger).
create table if not exists public.whatsapp_restriction_events (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid,
  user_id uuid not null,
  event_type text not null check (event_type in ('informed', 'validated', 'rejected', 'resolved', 'auto_ended')),
  actor_id uuid,
  origin text check (origin is null or origin in ('admin', 'gestora', 'evidencia_tecnica', 'corretor', 'sistema')),
  reason text,
  technical_code text,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_restriction_events_user_idx
  on public.whatsapp_restriction_events (user_id, created_at desc);

-- 3) Eventos de sessão (código/mensagem de desconexão) — só EVIDÊNCIA futura.
create table if not exists public.whatsapp_session_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text,
  status_code integer,
  error_message text,
  output jsonb,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_session_events_user_idx
  on public.whatsapp_session_events (user_id, created_at desc);

create or replace function public.whatsapp_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Tabela de histórico é append-only (% bloqueado).', tg_op;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_restriction_events_append_only') then
    create trigger whatsapp_restriction_events_append_only
      before update or delete on public.whatsapp_restriction_events
      for each row execute function public.whatsapp_events_append_only();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_session_events_append_only') then
    create trigger whatsapp_session_events_append_only
      before update or delete on public.whatsapp_session_events
      for each row execute function public.whatsapp_events_append_only();
  end if;
end $$;

-- 4) Último código de desconexão na sessão (só registro).
alter table public.whatsapp_individual_sessions
  add column if not exists last_disconnect_code integer,
  add column if not exists last_disconnect_at timestamptz;

alter table public.whatsapp_restriction_events enable row level security;
alter table public.whatsapp_session_events enable row level security;
revoke all on public.whatsapp_restriction_events from anon, authenticated;
revoke all on public.whatsapp_session_events from anon, authenticated;
grant all on public.whatsapp_restriction_events to service_role;
grant all on public.whatsapp_session_events to service_role;

comment on table public.whatsapp_restriction_events is 'Histórico append-only das alterações do status "WhatsApp restringido" (informada/validada/rejeitada/encerrada).';
comment on table public.whatsapp_session_events is 'Histórico append-only de eventos de sessão do WhatsApp individual (código de desconexão). Só registro, nunca decisão.';
