-- Face ID / Windows Hello para desbloquear a tela do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md
-- HENRY-LOCK "Face ID"). Aditiva e idempotente. RLS habilitado SEM policy pública: só o servidor (service role) lê e
-- escreve — lib/admin-passkeys.js. A biometria nunca sai do aparelho: aqui fica só a CHAVE PÚBLICA da chave de acesso
-- (WebAuthn) e o contador de assinaturas. Os desafios guardam só o SHA-256, valem minutos e uma vez só.

create table if not exists public.admin_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  credential_id text not null unique,          -- id da credencial (base64url)
  public_key text not null,                     -- chave pública COSE (base64url)
  counter bigint not null default 0,            -- contador de assinaturas (contra repetição/clonagem)
  transports text[] not null default '{}',
  device_name text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists admin_passkeys_user_idx on public.admin_passkeys (user_id);

alter table public.admin_passkeys enable row level security;
revoke all on table public.admin_passkeys from anon, authenticated;

create table if not exists public.admin_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  purpose text not null check (purpose in ('register', 'henry_unlock')),
  challenge_hash text not null,                 -- SHA-256 do desafio (nunca o desafio)
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_passkey_challenges_lookup_idx
  on public.admin_passkey_challenges (user_id, purpose, challenge_hash);

alter table public.admin_passkey_challenges enable row level security;
revoke all on table public.admin_passkey_challenges from anon, authenticated;
