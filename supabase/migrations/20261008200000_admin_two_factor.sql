-- Verificação em duas etapas (TOTP) da conta do dono (regra do dono, 2026-10-08).
-- Aditiva e idempotente. Uma linha por usuário do Supabase Auth que já iniciou a ativação.
-- RLS habilitado SEM policy pública: só o servidor (service role) lê/escreve — lib/admin-two-factor.js.
-- Desativar NÃO apaga a linha: zera o segredo/códigos e incrementa device_epoch, para que aparelhos lembrados
-- e provas de sessão antigas nunca voltem a valer numa reativação.

create table if not exists public.admin_two_factor (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  enabled boolean not null default false,
  enabled_at timestamptz,
  secret_encrypted text,
  pending_secret_encrypted text,
  pending_created_at timestamptz,
  last_used_step bigint,
  recovery_code_hashes text[] not null default '{}',
  device_epoch integer not null default 1,
  failed_attempts integer not null default 0,
  failed_window_started_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_two_factor enable row level security;
revoke all on table public.admin_two_factor from anon, authenticated;

-- Consome UM código de recuperação de forma atômica (dois cliques simultâneos com o mesmo código: só um entra).
create or replace function public.admin_two_factor_consume_recovery_code(p_auth_user_id uuid, p_code_hash text)
returns boolean
language sql
security invoker
set search_path = public
as $$
  with consumed as (
    update public.admin_two_factor
       set recovery_code_hashes = array_remove(recovery_code_hashes, p_code_hash),
           updated_at = now()
     where auth_user_id = p_auth_user_id
       and enabled
       and p_code_hash = any(recovery_code_hashes)
    returning 1
  )
  select exists (select 1 from consumed);
$$;

revoke all on function public.admin_two_factor_consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_two_factor_consume_recovery_code(uuid, text) to service_role;
