-- Alertas de estabilidade do WhatsApp individual (dono, 2026-10-10). SÓ ACRESCENTA e é idempotente:
-- dois INSERT ... ON CONFLICT DO NOTHING em crm_alert_definitions. Nenhuma tabela, coluna, constraint, RLS ou linha
-- existente é alterada. O código funciona SEM esta migration (usa o texto padrão, alerta ligado); com ela, o dono
-- pode editar o texto e ligar/desligar em Automações > Alertas.
--
-- 1) whatsapp_connection_self (Importante): avisa SÓ o corretor dono do número quando o próprio WhatsApp cai
--    (lib/whatsapp-connection-alert.js, notifyBrokerOwnConnection). Variável do texto: {numero} (" (Número 2)" ou vazio).
--    O push deste alerta é o único alerta da Central liberado na política de notificações (kind whatsapp_connection).
-- 2) whatsapp_service_stalled (Importante): avisa os administradores gerais quando o serviço do WhatsApp (Railway)
--    para de renovar o lease há mais de 5 min (lib/whatsapp-service-stall.js, cron whatsapp-flows).
--    Variáveis: {minutos} {horario}.
insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values
(
  'whatsapp_connection_self',
  'Seu WhatsApp desconectou',
  'Seu WhatsApp{numero} saiu do ar e você não está recebendo nem enviando mensagens por ele. Toque no ícone do WhatsApp no topo da tela e conecte de novo.',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"whatsapp_connection_self"}'::jsonb,
  true
),
(
  'whatsapp_service_stalled',
  'Serviço do WhatsApp parado',
  'O serviço que mantém os WhatsApp dos corretores conectados não responde há {minutos} minutos (último sinal às {horario}). Nenhum número está recebendo ou enviando mensagens. Verifique o serviço no Railway.',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"whatsapp_service_stalled"}'::jsonb,
  true
)
on conflict (key) do nothing;
