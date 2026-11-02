-- Lote de SMS dos corretores (dono, 2026-11-02): cada corretor recebe até 50 contatos da base por dia, e um contato só pode estar
-- no lote de UM corretor por vez. A reserva dura 24 h (expires_at) e a CHAVE PRIMÁRIA em contact_id é a garantia de "nunca dois
-- corretores com o mesmo contato": o INSERT é atômico, quem perde a corrida recebe 23505 (lib/sms-batch-reservations.mjs).
-- Reserva vencida não vale (apagada ao reservar de novo, ignorada na leitura); ao enviar o SMS a reserva é apagada. Aditiva e
-- idempotente. Sem esta migration o Lote da equipe segue como antes e o do corretor responde com aviso.
create table if not exists public.sms_batch_reservations (
  contact_id uuid primary key references public.prospecting_contacts(id) on delete cascade,
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sms_batch_reservations_broker_idx on public.sms_batch_reservations (broker_id, expires_at);
create index if not exists sms_batch_reservations_expires_idx on public.sms_batch_reservations (expires_at);

alter table public.sms_batch_reservations enable row level security;
revoke all on public.sms_batch_reservations from anon, authenticated;
grant all on public.sms_batch_reservations to service_role;

-- Uma única campanha "SMS - Lote da base" por corretor (destino fixo no corretor): dois toques ao mesmo tempo não criam duas.
create unique index if not exists campaigns_sms_batch_broker_unique
  on public.campaigns (broker_id)
  where name = 'SMS - Lote da base' and kind = 'custom' and broker_id is not null and deleted_at is null;
