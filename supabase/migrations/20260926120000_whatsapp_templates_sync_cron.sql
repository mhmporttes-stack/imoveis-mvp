-- Sincroniza os modelos do WhatsApp com a Meta UMA vez por dia, às 5h de Brasília (08:00 UTC; o Brasil não tem horário de
-- verão). Antes a lista só atualizava quando alguém clicava em "Sincronizar com a Meta" em Automações > Disparo, então
-- modelos já aprovados continuavam aparecendo como "Em análise" no CRM. Só LÊ na Meta (sem custo). Mesmo padrão dos
-- outros crons (crm_automation_cron_token).
select cron.schedule(
  'whatsapp-templates-sync-daily',
  '0 8 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/whatsapp-templates-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
