-- Previsão de recebimento da comissão + integração com a Agenda.
-- Aditiva e idempotente: não altera nem apaga dado existente.
--
-- 1) financial_sales.expected_receipt_date: data em que se espera receber o SALDO da comissão
--    (≠ sale_date, a data da venda; ≠ financial_payments.received_date, a data real do dinheiro).
--    O valor previsto nunca é gravado: é sempre calculado (comissão livre − recebido − parcelas já datadas).
-- 2) calendar_activities.financial_sale_id: vínculo rastreável atividade ↔ venda. ON DELETE CASCADE
--    (venda excluída não deixa atividade financeira órfã). O índice único parcial garante NO MÁXIMO uma
--    atividade "Confirmar recebimento" aberta (pending) por venda, mesmo com execuções simultâneas.
-- 3) financial_payments.confirmed_activity_id: pagamento criado pela confirmação de uma atividade. O índice
--    único parcial garante NO MÁXIMO um pagamento por atividade (confirmar duas vezes nunca duplica).

alter table public.financial_sales
  add column if not exists expected_receipt_date date;

alter table public.calendar_activities
  add column if not exists financial_sale_id uuid references public.financial_sales(id) on delete cascade;

alter table public.financial_payments
  add column if not exists confirmed_activity_id uuid references public.calendar_activities(id) on delete set null;

create unique index if not exists calendar_activities_financial_sale_open_uidx
  on public.calendar_activities (financial_sale_id)
  where financial_sale_id is not null and status = 'pending';

create index if not exists calendar_activities_financial_sale_idx
  on public.calendar_activities (financial_sale_id)
  where financial_sale_id is not null;

create unique index if not exists financial_payments_confirmed_activity_uidx
  on public.financial_payments (confirmed_activity_id)
  where confirmed_activity_id is not null;

create index if not exists financial_sales_expected_receipt_date_idx
  on public.financial_sales (expected_receipt_date)
  where expected_receipt_date is not null;
