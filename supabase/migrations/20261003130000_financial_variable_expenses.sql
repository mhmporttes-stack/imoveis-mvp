-- Despesas variáveis da empresa: "previsto × pago".
-- Aditiva e idempotente: só ADICIONA colunas com padrão seguro; nenhum dado existente é alterado ou apagado.
--
-- amount_mode  (financial_operating_expenses): como o valor se comporta.
--   'fixed'    = mesmo valor previsto todo mês (comportamento de sempre; todas as despesas já cadastradas ficam assim)
--   'variable' = o valor realmente pago vira a referência da próxima previsão da série (calculada na leitura)
--   NÃO confundir com expense_type (fixed|variable|extraordinary), que é a "Natureza do gasto".
-- expected_amount (financial_operating_expense_occurrences): o valor PREVISTO congelado no momento em que o
--   pagamento é confirmado, ao lado de paid_amount (o valor pago). Fica NULO em pagamentos já confirmados antes
--   desta migration (o previsto daquela época não foi registrado — nada é inventado nem reescrito).

alter table public.financial_operating_expenses
  add column if not exists amount_mode text not null default 'fixed';

alter table public.financial_operating_expenses
  drop constraint if exists financial_operating_expenses_amount_mode_chk;
alter table public.financial_operating_expenses
  add constraint financial_operating_expenses_amount_mode_chk check (amount_mode in ('fixed', 'variable'));

alter table public.financial_operating_expense_occurrences
  add column if not exists expected_amount numeric(14,2);

alter table public.financial_operating_expense_occurrences
  drop constraint if exists financial_expense_occurrences_expected_chk;
alter table public.financial_operating_expense_occurrences
  add constraint financial_expense_occurrences_expected_chk check (expected_amount is null or expected_amount >= 0);
