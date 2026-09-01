create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'whatsapp-master-scheduled-activities',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'crm_scheduled_activities_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')
    ),
    timeout_milliseconds := 15000
  );
  $$
);
