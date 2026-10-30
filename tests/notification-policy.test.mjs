// Política de notificações (regra do dono, 2026-10-06): só cliente novo e atividade agendada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALERT_PUSH_KINDS, ALLOWED_NOTIFICATION_KINDS, INFORMATIVE_PUSH_KINDS, NOTIFICATION_KIND, alertPushKind, isNotificationAllowed, notificationKindForAutomationTrigger } from "../lib/notification-policy-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("só cliente novo, atividade agendada, transferência de clientes e teste são permitidos; o resto é negado", () => {
  // whatsapp_connection: exceção do dono (2026-10-10, WA-20) — push da queda do PRÓPRIO WhatsApp, só ao corretor dono.
  // official_chat_assigned: exceção do dono (2026-10-18, PRES-25) — conversa do oficial atribuída pelo código do atendimento.
  // documents_list_auto: exceção do dono (2026-10-20) — lista de documentos pedida no oficial (enviada sozinha ou pendente).
  // marketplace_extension_silent: exceção do dono (2026-10-22, MKT-2g) — extensão do Marketplace sem sinal, push aos admins.
  assert.deepEqual([...ALLOWED_NOTIFICATION_KINDS].sort(), ["clients_transferred", "documents_list_auto", "henry_birthday", "henry_lockout", "marketplace_extension_silent", "marketplace_inbound", "marketplace_internal", "new_client", "official_chat_assigned", "scheduled_activity", "test", "whatsapp_connection"]);
  for (const kind of ["new_client", "scheduled_activity", "clients_transferred", "test", "whatsapp_connection", "official_chat_assigned", "documents_list_auto", "marketplace_extension_silent", "marketplace_internal"]) assert.equal(isNotificationAllowed(kind), true, kind);
  for (const kind of ["chat_message", "chat_internal", "document_analysis", "automation", "prospecting_reply", "alert", "", undefined, null]) assert.equal(isNotificationAllowed(kind), false, String(kind));
});

test("regra de automação: só gatilho de cliente novo ou de atividade agendada notifica", () => {
  assert.equal(notificationKindForAutomationTrigger("client_form_submitted"), NOTIFICATION_KIND.NEW_CLIENT);
  assert.equal(notificationKindForAutomationTrigger("client_added_by_broker"), NOTIFICATION_KIND.NEW_CLIENT);
  for (const trigger of ["activity_created", "activity_upcoming", "activity_overdue"]) assert.equal(notificationKindForAutomationTrigger(trigger), NOTIFICATION_KIND.SCHEDULED_ACTIVITY);
  for (const trigger of ["time_without_contact", "status_changed", "activity_completed", "simulation_sent", ""]) assert.equal(isNotificationAllowed(notificationKindForAutomationTrigger(trigger)), false, trigger);
});

test("push: sendPushToUser descarta o que não declara um tipo permitido", () => {
  const code = read("lib/push-subscriptions.js");
  assert.ok(code.includes("if (!isNotificationAllowed(payload?.kind)) return { sent: 0, failed: 0, removed: 0, blocked: true };"));
  assert.ok(code.indexOf("isNotificationAllowed(payload?.kind)") < code.indexOf("listPushSubscriptionsForUser(userId)", code.indexOf("export async function sendPushToUser")));
});

test("push: chamadores permitidos declaram o tipo; os demais NÃO declaram (ficam bloqueados)", () => {
  const allowed = {
    "lib/scheduled-activity-notifications.js": 'kind: "scheduled_activity"',
    "lib/crm-automations.js": 'kind: "new_client"',
    "lib/admin-profiles.js": 'kind: "clients_transferred"',
    "app/api/push/test/route.js": 'kind: "test"'
  };
  for (const [file, marker] of Object.entries(allowed)) assert.ok(read(file).includes(marker), `${file} deveria declarar ${marker}`);
  assert.ok(read("lib/crm-automations.js").includes("kind: notificationKindForAutomationTrigger(triggerType)"));
  for (const file of ["lib/whatsapp-chat.js", "lib/whatsapp-individual-inbound.js", "lib/prospecting-reply.js", "lib/supervision-messages.js", "lib/whatsapp-broadcast-schedules.js"]) {
    assert.ok(!/sendPushToUser\([^)]*kind:/.test(read(file)), `${file} não pode declarar tipo permitido`);
  }
  // Central de Alertas: o push só sai com tipo permitido quando o alerta declara `push_kind` = whatsapp_connection
  // (queda do próprio WhatsApp, dono 2026-10-10) ou marketplace_extension_silent (extensão do Marketplace sem sinal, dono
  // 2026-10-22); qualquer outro valor vira "sem tipo" e continua bloqueado.
  const alerts = read("lib/crm-alerts.js");
  assert.ok(alerts.includes("const pushKind = alertPushKind(row.context);"));
  assert.deepEqual([...ALERT_PUSH_KINDS].sort(), ["henry_birthday", "henry_lockout", "marketplace_extension_silent", "whatsapp_connection"]);
  // Informativo com push: só o aniversário avisado pelo Henry (dono, 2026-10-24); os demais Informativos seguem sem push.
  assert.deepEqual([...INFORMATIVE_PUSH_KINDS], ["henry_birthday"]);
  assert.ok(alerts.includes("item.kind === ALERT_KIND.IMPORTANT || INFORMATIVE_PUSH_KINDS.includes(item.context?.push_kind)"));
  assert.equal(alertPushKind({ push_kind: "whatsapp_connection" }), "whatsapp_connection");
  assert.equal(alertPushKind({ push_kind: "marketplace_extension_silent" }), "marketplace_extension_silent");
  for (const value of ["new_client", "official_chat_assigned", "documents_list_auto", "test", "", undefined]) assert.equal(alertPushKind({ push_kind: value }), undefined, String(value));
  assert.equal(alertPushKind(null), undefined);
  // Extensão do Marketplace: só o aviso "sem sinal" declara o push; o de volta (Informativo) fica só no sino.
  const marketplace = read("lib/marketplace-chat.js");
  assert.equal(marketplace.split("push_kind: NOTIFICATION_KIND.MARKETPLACE_EXTENSION_SILENT").length - 1, 1);
  const back = marketplace.slice(marketplace.indexOf("// Voltou depois de um aviso"), marketplace.indexOf("EXTENSION_ALERT_STATE_ID, { episode: null"));
  assert.ok(back.length > 0 && !back.includes("push_kind"));
  assert.ok(!/kind: "(new_client|scheduled_activity|clients_transferred|test)"/.test(alerts));
});

test("sino: avisos de cliente novo usam o tipo permitido; Roleta parou/Documentação/Chat interno/automação genérica não", () => {
  for (const file of ["lib/lead-distribution.js", "lib/whatsapp-sponsored-lead.js", "lib/whatsapp-flows.js"]) {
    const code = read(file);
    assert.ok(code.includes('notification_type: "new_client"'), file);
    assert.ok(!code.includes('notification_type: "automation"'), `${file} ainda cria aviso genérico`);
  }
  assert.ok(read("lib/crm-automations.js").includes("notification_type: notificationKindForAutomationTrigger(triggerType)"));
  const migration = read("supabase/migrations/20261006100000_crm_notifications_policy.sql");
  assert.ok(migration.includes("('new_client', 'scheduled_activity', 'clients_transferred')"));
  assert.ok(migration.includes("before insert on public.crm_notifications"));
  const exception = read("supabase/migrations/20261018150000_crm_notifications_official_chat_assigned.sql");
  assert.ok(exception.includes("('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned')"));
  assert.ok(exception.includes("set search_path = public, extensions"));
  const listAuto = read("supabase/migrations/20261020240000_crm_notifications_documents_list_auto.sql");
  assert.ok(listAuto.includes("('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto')"));
  // marketplace_internal: exceção do dono (2026-10-22, MKT-2i) — nota interna do Chat do Marketplace. chat_internal (WhatsApp) segue fora.
  const mktInternal = read("supabase/migrations/20261022231000_crm_notifications_marketplace_internal.sql");
  assert.ok(mktInternal.includes("('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto', 'marketplace_internal')"));
  // marketplace_inbound: exceção do dono (2026-10-30, MKT-3) — mensagem nova do cliente no Chat do Marketplace.
  const mktInbound = read("supabase/migrations/20261030150000_marketplace_inbound_notice.sql");
  assert.ok(mktInbound.includes("'marketplace_internal', 'marketplace_inbound')"));
});
