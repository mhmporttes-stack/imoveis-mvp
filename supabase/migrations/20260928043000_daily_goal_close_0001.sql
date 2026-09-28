-- 00:01 de São Paulo (03:01 UTC): fecha o dia anterior diariamente.
-- O ranking semanal também aguarda o fechamento antes de consolidar domingo.
select cron.schedule(
  'daily-goal-close-once-a-day',
  '1 3 * * *',
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
