-- Lote de SMS: checagem de WhatsApp (dono, 2026-11-02). Antes de montar os 50 do dia o CRM pergunta ao WhatsApp (só consulta,
-- nada é enviado) quais telefones têm conta. Esta tabela é o CACHE da resposta: reconsulta só depois de 30 dias
-- (lib/sms-batch-core.mjs: WA_CHECK_TTL_DAYS). has_whatsapp = false => o contato não entra no lote e aparece na aba
-- "Sem WhatsApp" (só leitura). Não altera contato nem cliente. Aditiva e idempotente. Sem esta migration a lista sai como
-- antes (falha aberta), com aviso discreto na tela.
create table if not exists public.sms_batch_wa_checks (
  phone_normalized text primary key,
  has_whatsapp boolean not null,
  checked_at timestamptz not null default now()
);

create index if not exists sms_batch_wa_checks_checked_idx on public.sms_batch_wa_checks (has_whatsapp, checked_at desc);

alter table public.sms_batch_wa_checks enable row level security;
revoke all on public.sms_batch_wa_checks from anon, authenticated;
grant all on public.sms_batch_wa_checks to service_role;
