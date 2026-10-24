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
  // Conversa do WhatsApp OFICIAL atribuída ao corretor pelo código do atendimento (dono, 2026-10-18, PRES-25): sino + push,
  // um por atribuição (lib/whatsapp-contact-code.js). As demais mensagens do Chat continuam sem aviso.
  OFFICIAL_CHAT_ASSIGNED: "official_chat_assigned",
  // Lista de documentos pedida pelo cliente no oficial (dono, 2026-10-20): aviso ao corretor de que foi enviada sozinha, ou
  // de que ficou pendente (Não contactar/telefone bloqueado/falha) com a lista pronta na ficha (lib/documents-list-auto.js).
  DOCUMENTS_LIST_AUTO: "documents_list_auto",
  // Extensão do Marketplace sem sinal (dono, 2026-10-22, MKT-2g): o aviso Importante "sem sinal" da Central de Alertas
  // também vai por push aos admins gerais, 1 por episódio (dedupe da entrega). O aviso de volta fica só no sino.
  MARKETPLACE_EXTENSION_SILENT: "marketplace_extension_silent",
  // Mensagem interna no Chat do Marketplace (dono, 2026-10-22, MKT-2i): sino + push para admin geral, corretor
  // responsável/atribuído e gestora da equipe (nunca o autor nem associado), 1 por mensagem; abre a conversa
  // (lib/marketplace-chat.js). Exceção SÓ do Marketplace — a nota interna do Chat do WhatsApp continua sem aviso (AUT-9).
  MARKETPLACE_INTERNAL: "marketplace_internal",
  // Senha da tela do Henry errada várias vezes (dono, 2026-10-23, HENRY-LOCK): o aviso Importante da Central vai também
  // por push ao DONO, um por espera (lib/henry-lock.js). Só ele: o Henry é só do dono.
  HENRY_LOCKOUT: "henry_lockout",
  // Aniversário de cliente avisado pelo Henry ao corretor responsável (dono, 2026-10-24, HENRY-1): aviso INFORMATIVO da
  // Central + push, 1 por cliente por dia, só depois do "sim" e do clique de confirmação do dono (lib/henry-birthday-alerts.js).
  HENRY_BIRTHDAY: "henry_birthday",
  // Botão "enviar push de teste" das configurações.
  TEST: "test"
});

export const ALLOWED_NOTIFICATION_KINDS = Object.freeze(Object.values(NOTIFICATION_KIND));

export function isNotificationAllowed(kind) {
  return ALLOWED_NOTIFICATION_KINDS.includes(kind);
}

// Central de Alertas: só estes alertas Importantes vão também por push, e só quando a entrega declara o tipo em
// `context.push_kind`. Qualquer outro valor (ou nenhum) = sem push.
export const ALERT_PUSH_KINDS = Object.freeze([NOTIFICATION_KIND.WHATSAPP_CONNECTION, NOTIFICATION_KIND.MARKETPLACE_EXTENSION_SILENT, NOTIFICATION_KIND.HENRY_LOCKOUT, NOTIFICATION_KIND.HENRY_BIRTHDAY]);
// Informativos que também vão por push (os demais Informativos nunca): só o aviso de aniversário do Henry (dono, 2026-10-24).
export const INFORMATIVE_PUSH_KINDS = Object.freeze([NOTIFICATION_KIND.HENRY_BIRTHDAY]);

export function alertPushKind(context) {
  const kind = context?.push_kind;
  return ALERT_PUSH_KINDS.includes(kind) ? kind : undefined;
}

// Gatilho de regra de automação -> tipo de notificação permitido (ou "automation", que é bloqueado).
const NEW_CLIENT_TRIGGERS = new Set(["client_form_submitted", "client_added_by_broker"]);
const SCHEDULED_ACTIVITY_TRIGGERS = new Set(["activity_created", "activity_upcoming", "activity_overdue"]);

export function notificationKindForAutomationTrigger(triggerType) {
  if (NEW_CLIENT_TRIGGERS.has(triggerType)) return NOTIFICATION_KIND.NEW_CLIENT;
  if (SCHEDULED_ACTIVITY_TRIGGERS.has(triggerType)) return NOTIFICATION_KIND.SCHEDULED_ACTIVITY;
  return "automation";
}
