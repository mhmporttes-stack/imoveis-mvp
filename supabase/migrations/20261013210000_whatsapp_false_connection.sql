-- "Conexão falsa" do WhatsApp individual (dono, 2026-10-13): sessão marcada como conectada que NÃO está recebendo
-- mensagens (queda 500/428 em loop ou silêncio em horário comercial). SÓ ACRESCENTA e é idempotente.
-- 1) Duas colunas em whatsapp_individual_sessions: silent_since (desde quando suspeita) e silent_reason (flapping|silence).
--    Quem escreve é só o detector (lib/whatsapp-false-connection.js, cron whatsapp-flows). Webhook de status não toca.
-- 2) Definição de alerta `whatsapp_false_connection` (Importante), editável na Central. Variáveis: {numero} {corretor}.
alter table public.whatsapp_individual_sessions
  add column if not exists silent_since timestamptz,
  add column if not exists silent_reason text;

insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'whatsapp_false_connection',
  'WhatsApp conectado, mas sem receber',
  'O WhatsApp{numero} de {corretor} aparece como conectado, mas não está recebendo mensagens. Abra o ícone do WhatsApp no topo da tela, desconecte e conecte de novo pelo QR Code.',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"whatsapp_false_connection"}'::jsonb,
  true
)
on conflict (key) do nothing;
