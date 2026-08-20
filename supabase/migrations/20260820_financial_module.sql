create extension if not exists pgcrypto;

create table if not exists public.financial_sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  simulation_id uuid,
  property_id uuid,
  property_name text not null default '',
  broker_email text not null default '',
  broker_name text not null default '',
  sale_date date not null default current_date,
  sale_value numeric(14,2) not null default 0 check (sale_value >= 0),
  commission_percentage numeric(9,4) not null default 0 check (commission_percentage >= 0),
  gross_commission numeric(14,2) not null default 0 check (gross_commission >= 0),
  commission_input_mode text not null default 'amount' check (commission_input_mode in ('amount', 'percentage')),
  financial_status text not null default 'pending' check (financial_status in ('pending', 'partial', 'received', 'cancelled')),
  manual_status boolean not null default false,
  notes text not null default '',
  created_by_email text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_sales_client_id_unique unique (client_id)
);

create table if not exists public.financial_expenses (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.financial_sales(id) on delete cascade,
  description text not null default '',
  category text not null default 'Outros',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  note text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.financial_sales(id) on delete cascade,
  installment_number integer not null default 1 check (installment_number > 0),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  expected_date date,
  received_date date,
  status text not null default 'expected' check (status in ('expected', 'received', 'overdue', 'cancelled')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_sales_client_id_idx on public.financial_sales(client_id);
create index if not exists financial_sales_sale_date_idx on public.financial_sales(sale_date);
create index if not exists financial_sales_financial_status_idx on public.financial_sales(financial_status);
create index if not exists financial_sales_broker_email_idx on public.financial_sales(broker_email);
create index if not exists financial_sales_property_name_idx on public.financial_sales(property_name);
create index if not exists financial_expenses_sale_id_idx on public.financial_expenses(sale_id);
create index if not exists financial_payments_sale_id_idx on public.financial_payments(sale_id);
create index if not exists financial_payments_expected_date_idx on public.financial_payments(expected_date);
create index if not exists financial_payments_status_idx on public.financial_payments(status);

alter table public.financial_sales enable row level security;
alter table public.financial_expenses enable row level security;
alter table public.financial_payments enable row level security;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    drop trigger if exists financial_sales_set_updated_at on public.financial_sales;
    create trigger financial_sales_set_updated_at
    before update on public.financial_sales
    for each row execute function public.set_updated_at();

    drop trigger if exists financial_expenses_set_updated_at on public.financial_expenses;
    create trigger financial_expenses_set_updated_at
    before update on public.financial_expenses
    for each row execute function public.set_updated_at();

    drop trigger if exists financial_payments_set_updated_at on public.financial_payments;
    create trigger financial_payments_set_updated_at
    before update on public.financial_payments
    for each row execute function public.set_updated_at();
  end if;
end $$;
