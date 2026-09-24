-- Rede de tempo dos Fluxos do WhatsApp: a cada minuto, retoma sessões que
-- estavam esperando (bloco "Espera") ou que passaram do prazo de "se não
-- responder". Mesmo padrão dos outros crons (crm_automation_cron_token).
select cron.schedule(
  'whatsapp-flows-timers-every-minute',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/whatsapp-flows',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
