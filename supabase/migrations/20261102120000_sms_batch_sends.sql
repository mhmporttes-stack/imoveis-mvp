-- Lote de SMS (dono, 2026-11-02): registro de cada SMS enviado por TOQUE (iPhone, app Mensagens) a contatos da base que
-- ainda não tiveram nenhuma tentativa de contato. Aditiva e idempotente. O envio de SMS conta como TENTATIVA de contato:
-- a elegibilidade (lib/sms-batch.js) nunca volta a oferecer quem já tem uma linha 'sent' aqui. 'opt_out' = respondeu SAIR.
create table if not exists public.sms_batch_sends (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null,
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  event text not null default 'sent' check (event in ('sent', 'opt_out')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  sent_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sms_batch_sends_phone_idx on public.sms_batch_sends (phone_normalized);
create index if not exists sms_batch_sends_created_idx on public.sms_batch_sends (created_at desc);

alter table public.sms_batch_sends enable row level security;
revoke all on public.sms_batch_sends from anon, authenticated;
grant all on public.sms_batch_sends to service_role;
