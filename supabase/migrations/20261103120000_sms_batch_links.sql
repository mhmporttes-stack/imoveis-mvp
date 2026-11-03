-- Lote de SMS: link único por contato (dono, 2026-11-03, PRO-18f). Cada contato recebe `<link da campanha>?t=<token>`; o token
-- é opaco (HMAC do id do contato, sem dado pessoal) e o mapeamento token -> contato só passa a existir quando o envio é
-- GRAVADO (lib/sms-batch-links.mjs). Guarda quem clicou (first/last/contagem) e qual cadastro de cliente veio do clique.
-- NUNCA UNIQUE por telefone: o telefone do cadastro pode ser outro; só o token liga. Aditiva e idempotente. Sem esta migration
-- o Lote funciona como antes (link sem rastreio por contato).
create table if not exists public.sms_batch_links (
  token text primary key,
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  phone_normalized text not null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  sent_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  click_count integer not null default 0,
  registration_id uuid references public.simulation_registrations(id) on delete set null,
  registered_at timestamptz
);

create index if not exists sms_batch_links_campaign_idx on public.sms_batch_links (campaign_id, last_clicked_at desc);
create index if not exists sms_batch_links_contact_idx on public.sms_batch_links (contact_id);
create index if not exists sms_batch_links_registration_idx on public.sms_batch_links (registration_id) where registration_id is not null;

alter table public.sms_batch_links enable row level security;
revoke all on public.sms_batch_links from anon, authenticated;
grant all on public.sms_batch_links to service_role;
