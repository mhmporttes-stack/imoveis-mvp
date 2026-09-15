-- Envio automatico do Relatorio Diario, 1x por dia perto do fim do
-- expediente (22:00 America/Sao_Paulo = 01:00 UTC — o fuso nao observa
-- horario de verao desde 2019, entao o offset fixo -03:00 e seguro aqui).
-- Reaproveita o MESMO token/mecanismo do cron ja existente
-- (crm-automations-every-minute) em vez de criar uma segunda forma de
-- autenticar - so um novo job com URL e horario diferentes.
select cron.schedule(
  'daily-report-once-a-day',
  '0 1 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/daily-report',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
