-- Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-LOCK).
-- Aditiva e idempotente. Uma linha por conta (só o dono usa o Henry). RLS habilitado SEM policy pública: só o servidor
-- (service role) lê/escreve — lib/henry-lock.js. Guarda só o HASH da senha (scrypt com salt) e o SHA-256 do token do
-- desbloqueio (o token fica num cookie HttpOnly do aparelho). Tentativas e esperas ficam aqui, nunca no navegador.

create table if not exists public.henry_lock (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  pin_hash text,
  pin_set_at timestamptz,
  idle_minutes integer not null default 10 check (idle_minutes between 1 and 120),
  -- erros seguidos (zera no acerto) e fim da espera atual (5 erros = 1 min, 10 = 5 min, 15+ = 15 min)
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  -- bloqueado desde (null = desbloqueado); fullscreen = tela cheia aberta (só o aparelho do token recebe dados e
  -- o desbloqueio expira com a inatividade)
  locked_at timestamptz,
  fullscreen boolean not null default false,
  unlock_token_hash text,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.henry_lock enable row level security;
revoke all on table public.henry_lock from anon, authenticated;
