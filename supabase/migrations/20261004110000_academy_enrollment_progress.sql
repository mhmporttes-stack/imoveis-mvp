-- Academia (F2) 2/4: matrícula, progresso por aula e trilha de eventos.
-- Aditiva e isolada. O aluno é sempre admin_users.id (nunca e-mail). RLS ligado e sem policy (só service_role).
-- Histórico preservado: user_id e FKs restrict (nada é apagado em cascata).

create table if not exists public.academy_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete restrict,
  track_id uuid not null references public.academy_tracks(id) on delete restrict,
  track_version_id uuid not null references public.academy_track_versions(id) on delete restrict,
  source text not null default 'self_start'
    check (source in ('manual','self_start','auto_new_broker','recommendation','recycle')),
  required boolean not null default false,
  due_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('assigned','in_progress','completed','expired','cancelled')),
  assigned_by uuid references public.admin_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Uma matrícula ATIVA por aluno e trilha (permite refazer reciclagem depois de concluída).
create unique index if not exists academy_enrollments_one_active_idx
  on public.academy_enrollments (user_id, track_id) where status in ('assigned','in_progress');
create index if not exists academy_enrollments_user_idx on public.academy_enrollments (user_id);
create index if not exists academy_enrollments_due_idx on public.academy_enrollments (due_at) where due_at is not null;

create table if not exists public.academy_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.academy_enrollments(id) on delete restrict,
  lesson_id uuid not null references public.academy_lessons(id) on delete restrict,
  status text not null default 'completed' check (status in ('in_progress','completed')),
  completed_at timestamptz,
  seconds_spent integer not null default 0 check (seconds_spent >= 0),
  created_at timestamptz not null default now(),
  unique (enrollment_id, lesson_id)
);
create index if not exists academy_lesson_progress_enrollment_idx on public.academy_lesson_progress (enrollment_id);

create table if not exists public.academy_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.admin_users(id) on delete set null,
  real_actor_email text,
  user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  ref uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_events_user_created_idx on public.academy_events (user_id, created_at);

alter table public.academy_enrollments enable row level security;
alter table public.academy_lesson_progress enable row level security;
alter table public.academy_events enable row level security;
revoke all on table public.academy_enrollments, public.academy_lesson_progress, public.academy_events from anon, authenticated;
