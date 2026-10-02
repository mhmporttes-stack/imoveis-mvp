-- Nota fiscal com percentual PRÓPRIO por venda (antes: interruptor invoice_issued = 15% fixo).
-- Aditiva e idempotente. Não altera nenhum valor histórico:
--   venda com nota (invoice_issued) -> 15  (exatamente o percentual que o sistema já aplicava)
--   venda sem nota                  -> 0
-- Comissão livre, repasses (gestor/corretor/imobiliária) e demais colunas calculadas ficam como estão.
-- invoice_issued continua existindo (compatibilidade) e passa a significar invoice_percentage > 0.

alter table public.financial_sales
  add column if not exists invoice_percentage numeric(7,4);

update public.financial_sales
set invoice_percentage = case when invoice_issued then 15 else 0 end
where invoice_percentage is null;

alter table public.financial_sales alter column invoice_percentage set default 0;
alter table public.financial_sales alter column invoice_percentage set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'financial_sales_invoice_percentage_check') then
    alter table public.financial_sales
      add constraint financial_sales_invoice_percentage_check check (invoice_percentage between 0 and 100);
  end if;
end $$;
