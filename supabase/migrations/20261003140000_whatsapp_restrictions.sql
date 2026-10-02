-- WhatsApp restringido (status OPERACIONAL informado pelo próprio corretor).
-- Migration ADITIVA e idempotente: só cria tabela/índices nova; não altera nem
-- apaga nada existente. NÃO libera Prospecção/Meta Diária/disparos: a
-- elegibilidade continua exigindo whatsapp_individual_sessions.status = 'connected'.
-- Guarda histórico: cada restrição é uma linha (aberta = ended_at nulo).

create table if not exists public.whatsapp_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  reported_by uuid references public.admin_users(id) on delete set null,
  reported_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual', 'automatic_connected')),
  ended_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint whatsapp_restrictions_end_consistent check ((ended_at is null) = (end_reason is null))
);

-- No máximo UMA restrição aberta por corretor (idempotência do "marcar").
create unique index if not exists whatsapp_restrictions_one_open_per_user
  on public.whatsapp_restrictions (user_id) where ended_at is null;
create index if not exists whatsapp_restrictions_user_idx
  on public.whatsapp_restrictions (user_id, reported_at desc);

comment on table public.whatsapp_restrictions is
  'Histórico do status operacional "WhatsApp restringido" informado pelo corretor. Apenas informativo: não libera Prospecção/Meta Diária/disparos.';

alter table public.whatsapp_restrictions enable row level security;
revoke all on public.whatsapp_restrictions from anon, authenticated;
grant all on public.whatsapp_restrictions to service_role;
