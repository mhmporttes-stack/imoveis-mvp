-- Atalhos do Chat do WhatsApp: mensagens/mídias prontas que o atendente envia
-- com um clique (lista de documentos, endereço, modelo de carta, link de
-- simulação do corretor…). kind:
--   text             — texto pronto
--   image / document — mídia (media_url) com legenda opcional (body)
--   simulation_link  — envia o link de simulação do corretor RESPONSÁVEL pelo
--                      cliente (calculado na hora), direto na simulação
create table if not exists public.whatsapp_chat_shortcuts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'image', 'document', 'simulation_link')),
  label text not null,
  body text,
  media_url text,
  media_name text,
  media_mime text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_chat_shortcuts_order_idx
  on public.whatsapp_chat_shortcuts (active, sort_order, created_at);

alter table public.whatsapp_chat_shortcuts enable row level security;
revoke all on public.whatsapp_chat_shortcuts from anon, authenticated;
grant all on public.whatsapp_chat_shortcuts to service_role;
