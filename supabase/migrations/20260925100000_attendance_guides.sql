-- Guia de Atendimento (árvore de decisão dos corretores, ao lado do Chat).
--
-- Mesmo modelo de Rascunho x Publicado dos Fluxos do WhatsApp: o editor grava em `graph` (rascunho, salva a cada
-- mudança); "Publicar" copia para `published_graph`, que é o que os corretores usam. Só admin/gestão edita
-- (verificado no servidor); corretor só lê a versão publicada.
--
-- Aditiva: não altera nenhuma tabela existente.

create table if not exists public.attendance_guides (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  description text,
  -- prospecting | lead | organic = abrem sozinhos conforme a origem do cliente; custom = só quando o corretor escolhe;
  -- library = Banco de Objeções (reutilizado pelos outros guias).
  kind text not null default 'custom' check (kind in ('prospecting', 'lead', 'organic', 'custom', 'library')),
  enabled boolean not null default true,
  sort_order integer not null default 100,
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  published_graph jsonb,
  version integer not null default 1,
  published_version integer,
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists attendance_guides_kind_idx on public.attendance_guides (kind, enabled, sort_order);

-- Progresso POR CLIENTE (ou por conversa, enquanto o contato ainda não é cliente): onde o corretor parou em cada guia.
-- subject_key = 'client:<uuid>' ou 'conv:<uuid>'. Índice único comum (não parcial) para o upsert do PostgREST funcionar.
create table if not exists public.attendance_guide_progress (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null,
  client_id uuid references public.simulation_registrations(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  guide_id uuid not null references public.attendance_guides(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.admin_users(id) on delete set null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_key, guide_id)
);

create index if not exists attendance_guide_progress_client_idx on public.attendance_guide_progress (client_id, updated_at desc);
create index if not exists attendance_guide_progress_conversation_idx on public.attendance_guide_progress (conversation_id, updated_at desc);

alter table public.attendance_guides enable row level security;
alter table public.attendance_guide_progress enable row level security;
revoke all on public.attendance_guides from anon, authenticated;
revoke all on public.attendance_guide_progress from anon, authenticated;
grant all on public.attendance_guides to service_role;
grant all on public.attendance_guide_progress to service_role;
