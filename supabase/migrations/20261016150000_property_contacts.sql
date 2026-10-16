-- Contato do imóvel (dono, 2026-10-16): quem chamar para agendar visita — nome, telefone/WhatsApp e tipo
-- (proprietário ou corretor parceiro). Dado INTERNO: só admin/gestor no painel, nunca no site público.
--
-- Tabela separada (e não colunas em public.properties) de propósito: properties tem a policy
-- "Public can read published properties" para a anon key, que é pública no navegador — uma coluna nova ali
-- ficaria legível por qualquer pessoa direto na API REST do Supabase. Aqui segue o padrão do projeto:
-- RLS habilitado SEM policy (só o service role, no servidor, lê e grava — lib/properties.js).
create table if not exists public.property_contacts (
  property_id text primary key references public.properties(id) on delete cascade,
  contact_name text not null default '',
  contact_phone text not null default '',
  contact_type text not null default '' check (contact_type in ('', 'proprietario', 'corretor')),
  updated_at timestamptz not null default now()
);

alter table public.property_contacts enable row level security;
