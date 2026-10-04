-- Alerta "WhatsApp precisa de atenção" (sessão individual que exige intervenção humana). SÓ ACRESCENTA e é
-- idempotente: um INSERT ... ON CONFLICT DO NOTHING na Central de Alertas (crm_alert_definitions). Nenhuma
-- tabela, coluna, constraint, RLS ou linha existente é alterada.
-- Importante (bloqueia até "Entendi", com ciência registrada e push), habilitado por padrão. O destinatário NÃO
-- vem da audiência: o detector (lib/whatsapp-session-attention.js) entrega à gestora responsável pelo corretor
-- + administradores gerais ativos, com dedupe_key por corretor+motivo+conexão (UNIQUE recipient_id+dedupe_key já
-- existente). Variáveis do texto: {corretor} {estado} {motivo} {acao} {horario}. Sem esta linha o código não alerta
-- (degrada em silêncio, sem erro).
insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'whatsapp_session_attention',
  'WhatsApp precisa de atenção',
  'WhatsApp de {corretor}: {estado} ({horario}). {motivo} {acao}',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"whatsapp_session_attention"}'::jsonb,
  true
)
on conflict (key) do nothing;
