-- Despesas da empresa: confirmação de pagamento e reagendamento POR OCORRÊNCIA.
-- Aditiva e idempotente. Despesa só é "paga" (realizada) após confirmação manual: a data
-- chegar não paga. Cada linha referencia a data ORIGINAL da ocorrência (chave estável, mesmo
-- reagendada) de uma despesa de financial_operating_expenses (recorrente ou única).
-- Despesas já cadastradas continuam intactas: sem linha aqui = prevista (não paga).

create table if not exists public.financial_operating_expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.financial_operating_expenses(id) on delete cascade,
  occurrence_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_date date,
  paid_amount numeric(14,2) check (paid_amount is null or paid_amount >= 0),
  rescheduled_to date,
  updated_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_expense_occurrences_unique unique (expense_id, occurrence_date),
  constraint financial_expense_occurrences_paid_chk
    check ((status = 'paid' and paid_date is not null and paid_amount is not null)
        or (status = 'pending' and paid_date is null and paid_amount is null))
);

create index if not exists financial_expense_occurrences_paid_idx
  on public.financial_operating_expense_occurrences(paid_date) where status = 'paid';

alter table public.financial_operating_expense_occurrences enable row level security;
