-- RAN-10 (dono, 2026-10-23): bônus "Primeiro a chegar" / "Último a sair" da imobiliária (100 pontos; empate de menos
-- de 3 min divide). Uma linha por dia e tipo = a decisão, gravada uma única vez pelo cron scheduled-activities
-- (lib/office-presence-bonus.js, insert "on conflict do nothing") — nunca dá duas vezes. O Ranking e o Extrato leem
-- daqui. Aditiva e idempotente; não mexe em office_presence_checkins nem na roleta (ROL-2f).

create table if not exists public.office_presence_bonus_awards (
  award_date date not null,
  kind text not null check (kind in ('first_arrival', 'last_departure')),
  winners jsonb not null default '[]'::jsonb,
  decided_at timestamptz not null default now(),
  primary key (award_date, kind)
);

alter table public.office_presence_bonus_awards enable row level security;
revoke all on public.office_presence_bonus_awards from anon, authenticated;
grant all on public.office_presence_bonus_awards to service_role;
