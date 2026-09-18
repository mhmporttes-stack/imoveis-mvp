-- Fila de disparo do WhatsApp Master (item 27 do pedido): processamento
-- persistente no backend, que continua mesmo se o navegador fechar/atualizar.
-- Mesmo padrão de autenticação e agendamento já usado pelos outros crons
-- deste projeto (crm_automation_cron_token, net.http_get) — nenhum mecanismo
-- novo. A cada minuto (mesma cadência de whatsapp-master-scheduled-activities,
-- migration 20260901_whatsapp_master_reminder_cron.sql), processa um lote de
-- mensagens ainda pendentes de qualquer campanha em andamento; o "Disparar
-- agora" já processa um primeiro lote de imediato dentro da própria
-- requisição, então este cron é a rede de segurança que garante que campanhas
-- grandes terminem mesmo sem ninguém com a tela aberta.
select cron.schedule(
  'whatsapp-broadcast-dispatch-every-minute',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/whatsapp-broadcast-dispatch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
