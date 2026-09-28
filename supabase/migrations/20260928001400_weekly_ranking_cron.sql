-- Segunda-feira 00:01 em São Paulo = 03:01 UTC. Usa o mesmo Vault e
-- autenticação dos outros jobs; o vencedor fica congelado em crm_settings.
select cron.schedule(
  'weekly-ranking-monday',
  '1 3 * * 1',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/weekly-ranking',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
