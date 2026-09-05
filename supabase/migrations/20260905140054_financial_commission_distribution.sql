alter table public.admin_users
  add column if not exists broker_commission_percentage numeric(7,4) not null default 50 check (broker_commission_percentage between 0 and 100),
  add column if not exists agency_commission_percentage numeric(7,4) not null default 50 check (agency_commission_percentage between 0 and 100),
  add column if not exists default_manager_percentage numeric(7,4) not null default 10 check (default_manager_percentage between 0 and 100),
  add column if not exists manager_id uuid references public.admin_users(id) on delete set null;

alter table public.admin_users
  add constraint admin_users_commission_split_check
  check (round(broker_commission_percentage + agency_commission_percentage, 4) = 100);

alter table public.financial_sales
  add column if not exists broker_id uuid references public.admin_users(id) on delete set null,
  add column if not exists has_manager_commission boolean not null default false,
  add column if not exists manager_id uuid references public.admin_users(id) on delete set null,
  add column if not exists manager_name text not null default '',
  add column if not exists manager_email text not null default '',
  add column if not exists manager_percentage numeric(7,4) not null default 0 check (manager_percentage between 0 and 100),
  add column if not exists manager_commission numeric(14,2) not null default 0 check (manager_commission >= 0),
  add column if not exists distribution_base numeric(14,2) not null default 0 check (distribution_base >= 0),
  add column if not exists broker_share_percentage numeric(7,4) not null default 50 check (broker_share_percentage between 0 and 100),
  add column if not exists broker_commission numeric(14,2) not null default 0 check (broker_commission >= 0),
  add column if not exists agency_share_percentage numeric(7,4) not null default 50 check (agency_share_percentage between 0 and 100),
  add column if not exists agency_commission numeric(14,2) not null default 0 check (agency_commission >= 0);

alter table public.financial_sales
  add constraint financial_sales_share_split_check
  check (round(broker_share_percentage + agency_share_percentage, 4) = 100),
  add constraint financial_sales_manager_check
  check (
    (not has_manager_commission and manager_id is null and manager_percentage = 0 and manager_commission = 0)
    or
    (has_manager_commission and manager_id is not null and manager_percentage > 0 and manager_percentage <= 100)
  );

update public.financial_sales sale
set broker_id = registration.responsible_user_id
from public.simulation_registrations registration
where sale.client_id = registration.id
  and sale.broker_id is null;

with expense_totals as (
  select sale_id, coalesce(sum(amount), 0) as total
  from public.financial_expenses
  group by sale_id
), free_values as (
  select
    sale.id,
    greatest(0, round(sale.gross_commission - case when sale.invoice_issued then sale.gross_commission * 0.15 else 0 end - coalesce(expense.total, 0), 2)) as free_commission
  from public.financial_sales sale
  left join expense_totals expense on expense.sale_id = sale.id
)
update public.financial_sales sale
set
  distribution_base = free.free_commission,
  broker_commission = round(free.free_commission * 0.5, 2),
  agency_commission = free.free_commission - round(free.free_commission * 0.5, 2)
from free_values free
where sale.id = free.id;

create index if not exists financial_sales_broker_id_idx on public.financial_sales(broker_id);
create index if not exists financial_sales_manager_id_idx on public.financial_sales(manager_id);
