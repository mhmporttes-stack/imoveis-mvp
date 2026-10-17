-- Fluxo de clientes que esfriaram — "Segunda chance" (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-17, FUN-15m).
-- A decisora pode manter o cliente com o mesmo corretor: o caso fecha com decision = 'second_chance'.
-- Só amplia o CHECK de `decision` (nenhum dado é alterado); idempotente.
-- O CHECK original foi criado inline (20261016120000), nome padrão cooled_client_cases_decision_check; por segurança,
-- remove qualquer CHECK da tabela que restrinja `decision` antes de recriar.
do $$
declare
  item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid = 'public.cooled_client_cases'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%decision = ANY%'
  loop
    execute format('alter table public.cooled_client_cases drop constraint %I', item.conname);
  end loop;
end $$;

alter table public.cooled_client_cases
  add constraint cooled_client_cases_decision_check
  check (decision is null or decision in ('transferred', 'status', 'second_chance'));
