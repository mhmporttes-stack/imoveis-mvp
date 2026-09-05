alter table public.financial_sales
  add column if not exists invoice_issued boolean not null default false;
