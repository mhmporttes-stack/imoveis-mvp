-- Lote de SMS -> Google Contatos do próprio usuário (dono, 2026-11-03, PRO-18g). Registra quais contatos do Lote já foram criados
-- na conta Google de CADA usuário (a conexão é a de google_contacts_connections, que já existe), para o botão "Salvar os 50 no
-- Google Contatos" ser idempotente por usuário (não recria quem já foi salvo). A linha nasce SEM resource_name (reivindicação
-- atômica, antes de chamar o Google) e recebe o `people/...` quando o Google confirma; reivindicação sem confirmação é
-- apagada/refeita pelo código. Aditiva e idempotente. Sem esta migration o Lote funciona como antes e o botão avisa que falta
-- liberar a tabela.
create table if not exists public.sms_batch_google_contacts (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  contact_id uuid not null references public.prospecting_contacts(id) on delete cascade,
  resource_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);

alter table public.sms_batch_google_contacts enable row level security;
revoke all on public.sms_batch_google_contacts from anon, authenticated;
grant all on public.sms_batch_google_contacts to service_role;
