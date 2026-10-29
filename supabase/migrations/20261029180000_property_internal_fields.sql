-- Campos INTERNOS do imóvel (dono, 2026-10-29): exclusividade, endereço completo e documentos.
-- Aditiva e idempotente. Nunca expostos no site público (lib/public-properties.js remove).
alter table public.properties add column if not exists exclusivity text not null default '';
alter table public.properties add column if not exists full_address text not null default '';
alter table public.properties add column if not exists documents_json jsonb not null default '[]'::jsonb;
