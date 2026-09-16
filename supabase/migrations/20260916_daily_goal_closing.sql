-- Correção da Meta Diária: "meta diária é diária" — a meta não pode carregar
-- progresso de um dia para o outro, e contato disponibilizado para a Meta
-- Diária não pode virar "cliente" antes de qualquer trabalho real.
--
-- daily_goals já era, por construção, uma linha por (corretor, dia) com o
-- valor de meta CONGELADO na geração (new_quota) — ou seja, já funcionava
-- como o "histórico diário" que a regra exige, só faltava (1) um jeito de
-- marcar que aquele dia foi FECHADO (com o resultado final congelado) e
-- (2) uma rotina que realmente feche os dias passados, devolvendo à
-- Prospecção quem não foi trabalhado. Por isso a correção só ACRESCENTA
-- colunas a daily_goals em vez de criar uma tabela de histórico paralela.
alter table public.daily_goals
  add column if not exists done_count integer,
  add column if not exists percent integer,
  add column if not exists goal_met boolean,
  add column if not exists closed_at timestamptz;

-- Busca eficiente de "dias ainda abertos" (usada tanto pelo fechamento sob
-- demanda ao abrir a tela quanto pelo cron diário).
create index if not exists daily_goals_open_idx on public.daily_goals (goal_date) where closed_at is null;

-- Fechamento diário da Meta Diária, 00:10 America/Sao_Paulo = 03:10 UTC
-- (fuso fixo -03:00, sem horário de verão desde 2019 — mesma regra já usada
-- pelos outros cron jobs deste projeto). Roda depois da virada do dia para
-- fechar QUALQUER corretor com dia anterior ainda aberto, mesmo quem não
-- abre a Meta Diária todo dia. Mesmo padrão de autenticação (vault secret
-- crm_automation_cron_token) dos crons já existentes — nenhum mecanismo novo.
select cron.schedule(
  'daily-goal-close-once-a-day',
  '10 3 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/daily-goal-close',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
