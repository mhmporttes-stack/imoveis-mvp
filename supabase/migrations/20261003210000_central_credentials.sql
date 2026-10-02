-- Ponte ChatGPT -> Central de Comando: credenciais por HASH. Aditiva e isolada (so cria objeto novo).
-- Guarda apenas o SHA-256 (hex, 64 chars) da chave de cada papel; a chave em si nunca entra no banco.
-- RLS ligado e sem policy: so o service_role acessa.

create table if not exists public.central_credentials (
  role text primary key check (role in ('chatgpt','executor','approver')),
  secret_sha256 text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.central_credentials enable row level security;
revoke all on table public.central_credentials from anon, authenticated;
