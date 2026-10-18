-- Apresentação interativa: "Estratégia de pagamento" (pedido do dono, 2026-10-17/18; docs/BUSINESS_RULES.md PRES-24).
-- Guarda, na linha do link (/s/<token>), a ÚLTIMA estratégia montada pelo cliente (13º, restituição do IR, FGTS a cada 2 anos,
-- valor extra por mês) e o resumo do resultado, para o corretor ver no painel "Apresentação da simulação" e na prévia.
-- ADITIVA e idempotente: só acrescenta duas colunas anuláveis em simulation_presentations. Nenhum dado existente é lido,
-- movido ou apagado. O código tolera a migration não aplicada (a estratégia funciona; só não grava).
-- RLS: a tabela já tem RLS sem policy pública; acesso só pelo servidor (service role). Nada muda aqui.

alter table public.simulation_presentations
  add column if not exists payment_strategy jsonb,
  add column if not exists payment_strategy_at timestamptz;

comment on column public.simulation_presentations.payment_strategy is
  'Última estratégia de pagamento do link: { escolhas, resumo, acao: pdf|contato, salvoEm }. Valores digitados pelo cliente na apresentação.';
comment on column public.simulation_presentations.payment_strategy_at is
  'Quando a estratégia de pagamento foi gravada pela última vez (PDF baixado ou "Falar com meu corretor").';
