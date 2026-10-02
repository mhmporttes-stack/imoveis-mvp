-- Aba "Saúde" do Financeiro: despesas operacionais da empresa + configuração de caixa/reserva.
-- Aditiva e idempotente. Não altera nem lê nenhuma tabela financeira existente.
-- Recorrência NÃO é materializada: a linha guarda a data da 1ª ocorrência (âncora),
-- a periodicidade e, opcionalmente, a data de encerramento.

create extension if not exists pgcrypto;

create table if not exists public.financial_operating_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null default 'Outros',
  expense_type text not null default 'variable' check (expense_type in ('fixed', 'variable', 'extraordinary')),
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null,
  is_recurring boolean not null default false,
  recurrence_period text check (recurrence_period in ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')),
  recurrence_end_date date,
  note text not null default '',
  created_by_email text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_operating_expenses_recurrence_chk
    check ((is_recurring and recurrence_period is not null) or (not is_recurring and recurrence_period is null and recurrence_end_date is null)),
  constraint financial_operating_expenses_end_chk
    check (recurrence_end_date is null or recurrence_end_date >= expense_date)
);

create index if not exists financial_operating_expenses_date_idx on public.financial_operating_expenses(expense_date);
create index if not exists financial_operating_expenses_recurring_idx on public.financial_operating_expenses(is_recurring) where is_recurring;

-- Linha única (id = 1). Saldo inicial NULL = não configurado (o sistema nunca assume 0).
create table if not exists public.financial_health_settings (
  id smallint primary key default 1 check (id = 1),
  opening_cash_balance numeric(14,2),
  opening_cash_date date,
  reserve_months numeric(5,2) not null default 3 check (reserve_months > 0),
  critical_months numeric(5,2) not null default 1 check (critical_months >= 0),
  updated_by_email text not null default '',
  updated_at timestamptz not null default now(),
  constraint financial_health_settings_cash_pair_chk
    check ((opening_cash_balance is null) = (opening_cash_date is null))
);

insert into public.financial_health_settings (id) values (1) on conflict (id) do nothing;

-- RLS ligado sem policy pública (padrão do projeto): acesso só pelo servidor (service role).
alter table public.financial_operating_expenses enable row level security;
alter table public.financial_health_settings enable row level security;
