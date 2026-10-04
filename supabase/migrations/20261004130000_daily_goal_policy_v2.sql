-- Política de disparos v2 do WhatsApp individual (REGRA OFICIAL — dono, 2026-10-04).
-- ADITIVA e idempotente: só cria UMA coluna booleana, com padrão FALSE. Nenhum dado existente é alterado,
-- nenhuma linha muda de comportamento: quem está com false continua exatamente como hoje.
--
-- Chave POR CORRETOR: ao ligar (true) para UM corretor, só ele passa a usar a política nova (30 mensagens por dia,
-- 10/10/10 por tentativa, janela 06:30–15:30 de segunda a sábado, intervalo de 90 s a 8 min com pausa de 15–30 min a
-- cada ~10 envios, reconexão sem rajada, modelos novos). Os demais seguem como antes até a chave ser ligada.
--
-- Pode ser aplicada ANTES ou DEPOIS do código novo: sem a coluna, o código trata a chave como desligada.
-- O monitor de taxa de entrega NÃO usa esta coluna nem exige migration (usa crm_settings).

alter table public.daily_goal_auto_settings
  add column if not exists policy_v2_enabled boolean not null default false;

comment on column public.daily_goal_auto_settings.policy_v2_enabled is
  'Política de disparos v2 (2026-10-04): true = 30 msgs/dia (10/10/10), 06:30-15:30 seg-sáb, intervalos 90s-8min com pausas, modelos novos. Padrão false (política antiga).';
