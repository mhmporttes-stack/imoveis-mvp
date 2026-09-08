alter table public.simulations
  add column if not exists entry_simulation_snapshots jsonb not null default '[]'::jsonb;
