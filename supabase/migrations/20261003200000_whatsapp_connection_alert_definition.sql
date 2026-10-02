-- Alerta de conexão do WhatsApp para a gestora (REGRA OFICIAL — dono, 2026-10-02). SÓ ACRESCENTA, idempotente:
-- um INSERT ... ON CONFLICT DO NOTHING na Central de Alertas (crm_alert_definitions). Nenhuma tabela, coluna,
-- constraint, RLS ou linha existente é alterada.
-- Informativo, habilitado por padrão para ESTE tipo. O destinatário NÃO vem da audiência: o detector
-- (lib/whatsapp-connection-alert.js) entrega só à gestora responsável pela equipe do corretor, com
-- dedupe_key por corretor+episódio (UNIQUE recipient_id+dedupe_key já existente). Sem gestora = ninguém.
-- trigger.reconnected_* = texto do aviso de reconexão (mesma definição, editável na Central).
insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'whatsapp_connection',
  'WhatsApp desconectado',
  'O WhatsApp de {corretor} foi desconectado.',
  'informative',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"whatsapp_connection","reconnected_title":"WhatsApp reconectado","reconnected_body_template":"O WhatsApp de {corretor} foi conectado novamente."}'::jsonb,
  true
)
on conflict (key) do nothing;
