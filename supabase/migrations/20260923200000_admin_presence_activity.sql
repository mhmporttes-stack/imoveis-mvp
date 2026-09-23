-- Histórico de atividade real dos usuários no CRM (tela Online > Horas no CRM).
-- Uma linha por (usuário, minuto) em que houve INTERAÇÃO real (clique, tecla,
-- rolagem, toque) — ou "grace" (clique em WhatsApp / contato registrado, que
-- leva o corretor para fora do CRM e por isso ganha uma tolerância maior de
-- inatividade). O tempo online/ausente é sempre CALCULADO a partir dessas
-- marcas na hora da leitura (lacuna <= 5 min = online contínuo; 5 a 30 min =
-- ausente; acima disso = offline/pausa), nunca armazenado.
create table if not exists public.admin_presence_activity (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  minute_at timestamptz not null,
  kind text not null default 'interaction' check (kind in ('interaction', 'grace')),
  primary key (user_id, minute_at)
);

create index if not exists admin_presence_activity_minute_idx on public.admin_presence_activity (minute_at);

alter table public.admin_presence_activity enable row level security;
revoke all on public.admin_presence_activity from anon, authenticated;
grant all on public.admin_presence_activity to service_role;
