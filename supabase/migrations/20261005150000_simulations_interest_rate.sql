-- Taxa de juros ANUAL da simulação (opcional), mostrada ao lado das parcelas na apresentação interativa
-- (/s/<token>). Não entra no PDF da simulação. Migration ADITIVA e idempotente: uma coluna nova, anulável, sem
-- valor padrão (simulações existentes ficam com null = "sem taxa cadastrada"). Intervalo aceito: 0 a 30 (% ao ano),
-- até 2 casas decimais (numeric(5,2)). Exemplo de valor: 5.40 (= "5,4% ao ano").
alter table public.simulations
  add column if not exists interest_rate_annual numeric(5,2)
  check (interest_rate_annual is null or (interest_rate_annual >= 0 and interest_rate_annual <= 30));

comment on column public.simulations.interest_rate_annual is
  'Taxa de juros anual (% ao ano) informada pelo corretor, opcional. Aparece só na apresentação interativa; nunca no PDF.';
