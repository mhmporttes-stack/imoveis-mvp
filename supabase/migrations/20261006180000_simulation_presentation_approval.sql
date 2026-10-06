-- Apresentação interativa: chave "Apresentação de aprovação" (pedido do dono, 2026-10-06).
-- Ligada → o MESMO link (/s/<token>) passa a mostrar a apresentação de CRÉDITO APROVADO, com os valores atuais da simulação
-- (que o corretor corrige para os da aprovação). Independente da etapa do funil (decisão do dono: chave manual, para evitar erro).
-- ADITIVA e idempotente: só acrescenta duas colunas anuláveis em simulation_presentations. Nenhum dado existente é lido,
-- movido ou apagado; nulo = desligada (comportamento de hoje). Documentação: docs/DATABASE.md e docs/BUSINESS_RULES.md (PRES-21).

alter table public.simulation_presentations
  add column if not exists approval_enabled_at timestamptz,
  add column if not exists approval_enabled_by uuid;

comment on column public.simulation_presentations.approval_enabled_at is
  'Quando a chave "Apresentação de aprovação" foi ligada; nulo = desligada (o link mostra a simulação).';
comment on column public.simulation_presentations.approval_enabled_by is
  'admin_users.id de quem ligou a chave (auditoria; o histórico do cliente também registra).';
