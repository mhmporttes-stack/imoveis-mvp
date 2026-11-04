-- Atalho do iPhone para o Lote de SMS (dono, 2026-11-04): chave pessoal (só o hash) para o Atalho buscar a lista do dia e avisar
-- cada envio, sem cookie de sessão. Aditiva e idempotente. RLS ligado, sem policy pública (acesso só pelo servidor).
create table if not exists public.sms_shortcut_keys (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create unique index if not exists sms_shortcut_keys_token_hash_idx on public.sms_shortcut_keys (token_hash);
alter table public.sms_shortcut_keys enable row level security;
revoke all on public.sms_shortcut_keys from anon, authenticated;
