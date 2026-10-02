-- Manual do CRM: topicos, secoes, versoes, novidades e leituras. Aditiva e isolada (so cria objetos novos).
-- RLS ligado e sem policy: so o service_role acessa; a autorizacao real (audiencia por perfil) e feita no servidor.

create table if not exists public.manual_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  description text not null default '',
  icon text not null default '',
  sort_order integer not null default 0,
  audiences text[] not null default array['all']::text[],
  status text not null default 'draft' check (status in ('draft','pending','published')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.manual_sections (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.manual_topics(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  body text not null default '',
  sort_order integer not null default 0,
  audiences text[] not null default array['all']::text[],
  status text not null default 'draft' check (status in ('draft','pending','published')),
  published_version_id uuid,
  last_updated_at timestamptz not null default now(),
  unique (topic_id, slug)
);

create table if not exists public.manual_news (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  body text not null default '',
  audiences text[] not null default array['all']::text[],
  status text not null default 'draft' check (status in ('draft','pending','published','discarded')),
  important boolean not null default false,
  requires_ack boolean not null default false,
  badge_until timestamptz,
  suggested_section_id uuid references public.manual_sections(id) on delete set null,
  suggested_body text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  alert_dedupe_key text
);

create table if not exists public.manual_section_versions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.manual_sections(id) on delete cascade,
  version integer not null,
  body_before text not null default '',
  body_after text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  news_id uuid references public.manual_news(id) on delete set null,
  unique (section_id, version)
);

create table if not exists public.manual_news_reads (
  news_id uuid not null references public.manual_news(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  unique (news_id, user_id)
);

create index if not exists manual_topics_published_idx on public.manual_topics (sort_order) where status = 'published';
create index if not exists manual_sections_topic_idx on public.manual_sections (topic_id, sort_order);
create index if not exists manual_sections_published_idx on public.manual_sections (topic_id) where status = 'published';
create index if not exists manual_news_published_idx on public.manual_news (published_at desc) where status = 'published';
create index if not exists manual_versions_pending_idx on public.manual_section_versions (section_id) where approved_at is null;
create index if not exists manual_news_reads_user_idx on public.manual_news_reads (user_id);

alter table public.manual_topics enable row level security;
alter table public.manual_sections enable row level security;
alter table public.manual_news enable row level security;
alter table public.manual_section_versions enable row level security;
alter table public.manual_news_reads enable row level security;

revoke all on table public.manual_topics, public.manual_sections, public.manual_news,
  public.manual_section_versions, public.manual_news_reads from anon, authenticated;
grant all on table public.manual_topics, public.manual_sections, public.manual_news,
  public.manual_section_versions, public.manual_news_reads to service_role;
