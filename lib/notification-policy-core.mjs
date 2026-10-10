// Política de NOTIFICAÇÕES do sistema (regra do dono, 2026-10-06): o CRM só
// notifica (push no celular e sino do painel) em DOIS casos — cliente novo e
// atividade agendada. Qualquer outra coisa (mensagem de Chat, resposta de
// prospecção, automação de "cliente aguardando ação", aviso de roleta, etc.)
// NÃO gera notificação. Padrão é NEGAR: quem quiser notificar precisa declarar
// o tipo permitido. Puro e testado (tests/notification-policy.test.mjs); o
// banco repete a regra no sino (gatilho crm_notifications_policy).

export const NOTIFICATION_KIND = Object.freeze({
  NEW_CLIENT: "new_client",
  SCHEDULED_ACTIVITY: "scheduled_activity",
  // Aviso de transferência: o corretor recebe cliente(s) — é cliente novo para ele.
  CLIENTS_TRANSFERRED: "clients_transferred",
  // Queda do PRÓPRIO WhatsApp do corretor, avisada só a ele (dono, 2026-10-10, WA-20): lib/whatsapp-connection-alert.js
  // -> Central de Alertas -> push. Não vale para outro alerta: o contexto da entrega declara `push_kind`.
  WHATSAPP_CONNECTION: "whatsapp_connection",
  // Botão "enviar push de teste" das configurações.
  TEST: "test"
});

export const ALLOWED_NOTIFICATION_KINDS = Object.freeze(Object.values(NOTIFICATION_KIND));

export function isNotificationAllowed(kind) {
  return ALLOWED_NOTIFICATION_KINDS.includes(kind);
}

// Gatilho de regra de automação -> tipo de notificação permitido (ou "automation", que é bloqueado).
const NEW_CLIENT_TRIGGERS = new Set(["client_form_submitted", "client_added_by_broker"]);
const SCHEDULED_ACTIVITY_TRIGGERS = new Set(["activity_created", "activity_upcoming", "activity_overdue"]);

export function notificationKindForAutomationTrigger(triggerType) {
  if (NEW_CLIENT_TRIGGERS.has(triggerType)) return NOTIFICATION_KIND.NEW_CLIENT;
  if (SCHEDULED_ACTIVITY_TRIGGERS.has(triggerType)) return NOTIFICATION_KIND.SCHEDULED_ACTIVITY;
  return "automation";
}
