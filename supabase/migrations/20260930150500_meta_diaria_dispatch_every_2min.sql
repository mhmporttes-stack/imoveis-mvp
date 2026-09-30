-- Aperta o cron da automação da Meta Diária de 5 em 5 min pra 2 em 2 min.
--
-- Achado real, 2026-09-30 (reclamação repetida do dono: "Próximo disparo"
-- sempre atrasado, mesmo depois de corrigir os bugs de fila/pausa): o
-- intervalo médio entre mensagens agendadas por corretor (min_gap/max_gap
-- ou oscilação, ~5 a 16 min pra maioria) é PARECIDO OU MENOR que o
-- intervalo de checagem do cron (5 min) — então a cada ciclo, mais de 1
-- item novo ficava "vencido" mas só 1 mensagem de verdade saía (limite
-- deliberado, anti-banimento, que continua intacto). Resultado: o atraso
-- só crescia, nunca alcançava, mesmo com tudo funcionando certo por trás.
--
-- Checar a cada 2 min (em vez de mudar o limite de 1 envio real por ciclo)
-- dá margem de sobra: até 30 checagens/hora, folga confortável até pro
-- corretor com o ritmo mais apertado. maxDuration da rota é 55s, bem
-- abaixo dos 120s entre disparos do cron, então não corre risco de uma
-- execução sobrepor a próxima.
select cron.unschedule('whatsapp-meta-diaria-dispatch-every-5-min');

select cron.schedule(
  'whatsapp-meta-diaria-dispatch-every-2-min',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/whatsapp-meta-diaria-dispatch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
