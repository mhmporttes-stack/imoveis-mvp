-- Job próprio para o cache PESADO de métricas (semana, mês, meta do mês,
-- períodos fechados e o período anterior da comparação do Henry).
-- Aprovado pelo dono em 2026-10-23 ("sem problemas"). Motivo: no job
-- crm-cache-refresh-* as contas de "hoje" gastavam todo o orçamento da rodada
-- e os pesados quase nunca rodavam (overview:este_mes com 3 h de idade).
-- A rota /api/cron/crm-snapshots?mode=heavy tem trava própria e só recalcula
-- o que venceu (semana/mês a cada ~30 min). Enquanto este job roda, o refresh
-- deixa de puxar pesados (reserva automática se ele parar por 30 min).
-- Horários em UTC (São Paulo = UTC-3), minutos :05/:15/... para não cruzar com
-- o refresh (:00/:10/... e :00/:30):
--   06:00-21:59 de São Paulo (09-23 e 00 UTC), todos os dias: de 10 em 10 min;
--   22:00-05:59 de São Paulo (01-08 UTC): de hora em hora, aos :35.
-- Idempotente: cron.schedule com o mesmo nome atualiza o job existente.
select cron.schedule(
  'crm-cache-heavy-daytime',
  '5-55/10 0,9-23 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=heavy',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'crm-cache-heavy-night',
  '35 1-8 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=heavy',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
