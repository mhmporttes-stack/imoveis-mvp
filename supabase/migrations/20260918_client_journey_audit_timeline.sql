-- Linha do tempo de auditoria do cliente: estende a tabela já existente
-- client_journey_events (hoje só grava "created"/"status"/"notify"/
-- "regenerate", via trigger de banco) em vez de criar uma segunda estrutura
-- paralela. Também adiciona uma coluna de detalhes estruturados em
-- lead_distribution_history, para registrar o MOTIVO de uma transferência
-- automática (hoje inexistente) sem quebrar as 2 leituras já existentes
-- dessa tabela.

-- 1) client_journey_events: detalhes estruturados por tipo de evento (ex.:
-- de/para de uma transferência, campos alterados, canal de uma tentativa)
-- sem precisar de uma coluna por caso — e um SNAPSHOT do nome/cargo de quem
-- executou a ação (imutável: nunca muda se o cargo da pessoa mudar depois,
-- diferente de resolver isso ao vivo toda vez que a timeline é lida).
alter table public.client_journey_events
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists actor_name text,
  add column if not exists actor_role text;

-- 2) lead_distribution_history: motivo/regra por trás de uma transferência
-- automática (hoje só sabia QUE aconteceu, não POR QUÊ) — coluna nova,
-- opcional, não altera nenhuma leitura/escrita existente dessa tabela.
alter table public.lead_distribution_history
  add column if not exists details jsonb not null default '{}'::jsonb;
