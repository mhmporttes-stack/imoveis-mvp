-- Primeiro acesso do dia do dono (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-4).
-- Uma linha por usuário e dia (data de São Paulo). A chave primária garante o "1 vez por dia": só o primeiro INSERT
-- do dia vence, mesmo com duas abas ou dois aparelhos ao mesmo tempo (lib/primeiro-acesso.js). Guarda também o
-- resultado da fala do bom dia da Alexa (só o motivo, nunca a frase). Aditiva: não mexe em nenhuma tabela existente.

create table if not exists public.admin_first_access_days (
  user_id text not null,
  access_date date not null,
  accessed_at timestamptz not null default now(),
  alexa_status text,
  alexa_at timestamptz,
  primary key (user_id, access_date)
);

create index if not exists admin_first_access_days_accessed_at_idx
  on public.admin_first_access_days (accessed_at desc);

alter table public.admin_first_access_days enable row level security;
revoke all on public.admin_first_access_days from anon, authenticated;
grant all on public.admin_first_access_days to service_role;
