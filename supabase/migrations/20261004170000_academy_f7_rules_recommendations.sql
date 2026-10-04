-- Academia (F7): regras de matrícula automática (novos usuários, reciclagem) e recomendações de treinamento.
-- Regras e recomendações só PREPARAM matrículas: nada aqui envia mensagem, push ou WhatsApp (decisão do plano: sem disparo).
-- Aditiva. RLS ligado e sem policy (só service_role).
-- Regra do dono (2026-10-04): a Formação Inicial é obrigatória para NOVOS associados e corretores => regra "new_user" da trilha
-- formacao-inicial, ativa, valendo só para usuários criados a partir de starts_at (os atuais não são afetados).

create table if not exists public.academy_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.academy_tracks(id) on delete restrict,
  kind text not null check (kind in ('new_user','recycle')),
  audience_roles text[] not null default array['broker','associate']::text[]
    check (audience_roles <@ array['admin','manager','broker','associate']::text[] and cardinality(audience_roles) > 0),
  due_days integer check (due_days > 0 and due_days <= 730),
  every_days integer check (every_days >= 30 and every_days <= 1825),
  starts_at timestamptz not null default now(),
  active boolean not null default false,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, kind),
  check (kind <> 'recycle' or every_days is not null)
);

create table if not exists public.academy_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete restrict,
  track_id uuid not null references public.academy_tracks(id) on delete restrict,
  source text not null default 'manual' check (source in ('manual','atendimento_audit')),
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 500),
  status text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_by uuid references public.admin_users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  decided_by uuid references public.admin_users(id) on delete set null,
  decided_by_email text,
  decided_at timestamptz,
  enrollment_id uuid references public.academy_enrollments(id) on delete restrict,
  check ((status = 'open') = (decided_at is null))
);
create unique index if not exists academy_recommendations_one_open_idx on public.academy_recommendations (user_id, track_id) where status = 'open';
create index if not exists academy_recommendations_user_idx on public.academy_recommendations (user_id);

alter table public.academy_assignment_rules enable row level security;
alter table public.academy_recommendations enable row level security;
revoke all on table public.academy_assignment_rules, public.academy_recommendations from anon, authenticated;

-- Regra inicial: Formação Inicial obrigatória para novos corretores e associados, prazo de 30 dias. Idempotente.
insert into public.academy_assignment_rules (track_id, kind, audience_roles, due_days, active)
  select t.id, 'new_user', array['broker','associate']::text[], 30, true
  from public.academy_tracks t where t.slug = 'formacao-inicial'
on conflict (track_id, kind) do nothing;
