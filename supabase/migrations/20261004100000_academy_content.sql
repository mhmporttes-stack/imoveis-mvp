-- Academia (F2) 1/4: conteúdo versionado (trilhas, versões, módulos, aulas).
-- Aditiva e isolada: só cria objetos novos (prefixo academy_), não toca nenhuma tabela existente.
-- RLS ligado e SEM policy: só o service_role (servidor) acessa; a autorização real é feita em lib/ (padrão do projeto).
-- Versão publicada é imutável (trigger): editar = nova versão (F3). Nada é apagado (FKs restrict).

create table if not exists public.academy_tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 0),
  kind text not null default 'formacao_inicial'
    check (kind in ('formacao_inicial','aperfeicoamento','especializacao','reciclagem','atualizacao')),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  is_mandatory_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_track_versions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.academy_tracks(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  published_by uuid references public.admin_users(id) on delete set null,
  change_note text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, version_number)
);
create unique index if not exists academy_track_versions_one_published_idx
  on public.academy_track_versions (track_id) where status = 'published';
create unique index if not exists academy_track_versions_one_draft_idx
  on public.academy_track_versions (track_id) where status = 'draft';

create table if not exists public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  track_version_id uuid not null references public.academy_track_versions(id) on delete restrict,
  stable_key uuid not null default gen_random_uuid(),
  position integer not null check (position > 0),
  title text not null check (length(btrim(title)) > 0),
  summary text,
  unlock_rule jsonb,
  is_final boolean not null default false,
  requires_exam boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists academy_modules_version_position_idx
  on public.academy_modules (track_version_id, position);

create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.academy_modules(id) on delete restrict,
  stable_key uuid not null default gen_random_uuid(),
  position integer not null check (position > 0),
  title text not null check (length(btrim(title)) > 0),
  est_minutes integer not null default 0 check (est_minutes >= 0),
  kind text not null default 'lesson' check (kind in ('lesson','final_exam')),
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_lessons_module_position_idx
  on public.academy_lessons (module_id, position);

-- Imutabilidade da versão publicada: módulos e aulas só mudam enquanto a versão é rascunho.
create or replace function public.academy_guard_published_content()
returns trigger language plpgsql as $$
declare v_status text; v_version uuid;
begin
  if tg_table_name = 'academy_modules' then
    v_version := coalesce(case when tg_op = 'DELETE' then old.track_version_id else new.track_version_id end, null);
  else
    select m.track_version_id into v_version from public.academy_modules m
      where m.id = case when tg_op = 'DELETE' then old.module_id else new.module_id end;
  end if;
  select status into v_status from public.academy_track_versions where id = v_version;
  if v_status is distinct from 'draft' then
    raise exception 'academy_published_content_is_immutable' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists academy_modules_guard on public.academy_modules;
create trigger academy_modules_guard before insert or update or delete on public.academy_modules
  for each row execute function public.academy_guard_published_content();
drop trigger if exists academy_lessons_guard on public.academy_lessons;
create trigger academy_lessons_guard before insert or update or delete on public.academy_lessons
  for each row execute function public.academy_guard_published_content();

-- Versão publicada: não muda de trilha, número nem configurações; só pode virar 'retired'.
create or replace function public.academy_guard_version_update()
returns trigger language plpgsql as $$
begin
  if old.status in ('published','retired') and (
       new.track_id is distinct from old.track_id
    or new.version_number is distinct from old.version_number
    or new.settings is distinct from old.settings) then
    raise exception 'academy_published_version_is_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'retired' and new.status is distinct from 'retired' then
    raise exception 'academy_retired_version_is_final' using errcode = 'P0001';
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'academy_published_version_cannot_return_to_draft' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists academy_track_versions_guard on public.academy_track_versions;
create trigger academy_track_versions_guard before update on public.academy_track_versions
  for each row execute function public.academy_guard_version_update();

alter table public.academy_tracks enable row level security;
alter table public.academy_track_versions enable row level security;
alter table public.academy_modules enable row level security;
alter table public.academy_lessons enable row level security;
revoke all on table public.academy_tracks, public.academy_track_versions, public.academy_modules, public.academy_lessons from anon, authenticated;
revoke all on function public.academy_guard_published_content() from public, anon, authenticated;
revoke all on function public.academy_guard_version_update() from public, anon, authenticated;
