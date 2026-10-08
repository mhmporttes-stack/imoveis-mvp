-- "Agendar atendimento" da apresentação interativa (PRES-22, regra do dono de 2026-10-08).
-- ADITIVA e idempotente: tabela nova client_appointments + coluna admin_users.meet_link. Nada existente é alterado.
--  - status 'scheduled' = horário reservado (ocupa a agenda da GESTORA, compartilhada pela equipe dela);
--    'cancelled' = cancelado; 'special_request' = "Combinar outro horário" (não reserva nada: requested_date + requested_text);
--  - índice único parcial (manager_user_id, starts_at) where status = 'scheduled': dois clientes da mesma equipe nunca
--    ficam com o mesmo horário (a segunda reserva concorrente recebe 23505 e o cliente escolhe outro);
--  - RLS habilitado sem policy pública (padrão do projeto: acesso só pelo servidor com a service role).
create table if not exists public.client_appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  presentation_id uuid references public.simulation_presentations(id) on delete set null,
  broker_user_id uuid references public.admin_users(id) on delete set null,
  manager_user_id uuid references public.admin_users(id) on delete set null,
  kind text not null check (kind in ('presencial', 'online')),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'special_request')),
  requested_date date,
  requested_text text check (requested_text is null or length(requested_text) <= 200),
  calendar_activity_id uuid references public.calendar_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint client_appointments_scheduled_time_check check (
    status <> 'scheduled' or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

create unique index if not exists client_appointments_manager_slot_uidx
  on public.client_appointments (manager_user_id, starts_at)
  where status = 'scheduled';
create index if not exists client_appointments_client_idx on public.client_appointments (client_id, created_at desc);

alter table public.client_appointments enable row level security;
revoke all on public.client_appointments from anon, authenticated;
grant all on public.client_appointments to service_role;

-- Link fixo do Google Meet da gestora (só https://meet.google.com/..., validado no código). Vazio = a mensagem ao
-- cliente diz que o link será enviado pelo WhatsApp.
alter table public.admin_users add column if not exists meet_link text;
