-- Agendamento da sincronizacao de LEITURA da Meta Ads (Gestao de Trafego,
-- Fase 1). Mesmo padrao e mesmo token dos demais crons do projeto
-- (pg_cron + net.http_get + vault crm_automation_cron_token, validado na
-- rota via SUPABASE_CRON_TOKEN_HASH) - nenhum mecanismo novo de autenticacao.
--
-- pg_cron roda em UTC; Marilia/SP e America/Sao_Paulo (-03:00 fixo, sem
-- horario de verao desde 2019). A Ad Account da Meta esta em
-- America/Los_Angeles: os "dias" dos Insights seguem esse fuso e sao
-- resolvidos dentro do proprio codigo (lib/meta-ads-sync.js), nao aqui.

-- Intraday: a cada 2h, das 08:00 as 22:00 (Sao Paulo) = 11,13,15,17,19,21,23
-- e 01 UTC. Dia corrente, nivel "ad" (poucas chamadas por execucao).
select cron.schedule(
  'meta-ads-intraday-sync',
  '0 1,11,13,15,17,19,21,23 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/meta-ads-intraday-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

-- Consolidacao diaria: 06:00 (Sao Paulo) = 09:00 UTC, depois que o dia da
-- conta (Los Angeles) ja virou em horario de verao (04:00 BRT) e de
-- inverno (05:00 BRT). Reconsulta a janela movel completa (entidades +
-- 3 niveis de insights) para incorporar ajustes retroativos de atribuicao.
select cron.schedule(
  'meta-ads-daily-consolidation',
  '0 9 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/meta-ads-daily-consolidation',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
