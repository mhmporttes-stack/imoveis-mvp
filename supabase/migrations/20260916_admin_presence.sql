-- Presença/atividade recente da equipe no CRM (aba Gestão > Desempenho >
-- Online). Uma linha por usuário administrativo, atualizada por heartbeat do
-- próprio navegador (nunca por evento de login/logout — fechar o navegador
-- sem logout não deve manter alguém "online" para sempre; o status é sempre
-- DERIVADO da idade de last_activity_at na hora da leitura, nunca armazenado).
create table if not exists public.admin_presence (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  last_activity_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_presence_last_activity_idx on public.admin_presence (last_activity_at);

alter table public.admin_presence enable row level security;
revoke all on public.admin_presence from anon, authenticated;
grant all on public.admin_presence to service_role;
