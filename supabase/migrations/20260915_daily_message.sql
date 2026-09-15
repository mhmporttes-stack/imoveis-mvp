-- Mensagem do Dia: experiência de abertura da jornada de trabalho.
-- Reaproveita: admin_users (destinatários), crm_settings (configuração,
-- mesmo padrão key/value já usado por outras telas de Automações) — não
-- cria tabela de configuração nova.

create table if not exists public.daily_message_cards (
  id uuid primary key default gen_random_uuid(),
  editorial_id text not null unique,
  type text not null check (type in ('biblical', 'reflection')),
  main_text text not null,
  source_text text not null,
  opening_message text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_message_cards_type_active_idx
  on public.daily_message_cards (type, active);

create table if not exists public.daily_message_dispatches (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.daily_message_cards(id),
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  audience text not null check (audience in ('all', 'selected')),
  idempotency_key text unique
);

-- cycle_key identifica de forma única "a que ciclo esta linha pertence":
-- 'auto:<YYYY-MM-DD>' para o ciclo automático diário (a data em que o ciclo
-- começou, conforme o horário configurado) ou 'dispatch:<dispatch_id>' para
-- um disparo extraordinário. A constraint de unicidade (user_id, cycle_key)
-- é a proteção contra dupla conclusão automática do mesmo usuário no mesmo
-- ciclo (item 21 da especificação) e contra duplo disparo por usuário.
create table if not exists public.daily_message_user_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  card_id uuid not null references public.daily_message_cards(id),
  source text not null check (source in ('auto', 'dispatch')),
  cycle_key text not null,
  dispatch_id uuid references public.daily_message_dispatches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'shown', 'completed')),
  shown_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, cycle_key)
);

create index if not exists daily_message_user_history_user_idx
  on public.daily_message_user_history (user_id, created_at desc);
create index if not exists daily_message_user_history_dispatch_idx
  on public.daily_message_user_history (dispatch_id);

alter table public.daily_message_cards enable row level security;
alter table public.daily_message_dispatches enable row level security;
alter table public.daily_message_user_history enable row level security;

grant all on public.daily_message_cards to service_role;
grant all on public.daily_message_dispatches to service_role;
grant all on public.daily_message_user_history to service_role;
