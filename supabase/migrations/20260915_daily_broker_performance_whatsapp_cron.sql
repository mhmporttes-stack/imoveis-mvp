-- Envio automatico do resumo diario de desempenho por corretor via
-- WhatsApp, 1x por dia perto do fim do expediente (22:05 America/Sao_Paulo =
-- 01:05 UTC — o fuso nao observa horario de verao desde 2019, entao o
-- offset fixo -03:00 e seguro aqui). 5 minutos depois do daily-report para
-- nao disparar os dois jobs no mesmo minuto exato.
-- Reaproveita o MESMO token/mecanismo dos crons ja existentes
-- (crm-automations-every-minute, daily-report) em vez de criar uma segunda
-- forma de autenticar - so um novo job com URL e horario diferentes.
select cron.schedule(
  'daily-broker-performance-whatsapp-once-a-day',
  '5 1 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/daily-broker-performance',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
