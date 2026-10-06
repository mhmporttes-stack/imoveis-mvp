// Política de notificações (regra do dono, 2026-10-06): só cliente novo e atividade agendada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALLOWED_NOTIFICATION_KINDS, NOTIFICATION_KIND, isNotificationAllowed, notificationKindForAutomationTrigger } from "../lib/notification-policy-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("só cliente novo, atividade agendada, transferência de clientes e teste são permitidos; o resto é negado", () => {
  assert.deepEqual([...ALLOWED_NOTIFICATION_KINDS].sort(), ["clients_transferred", "new_client", "scheduled_activity", "test"]);
  for (const kind of ["new_client", "scheduled_activity", "clients_transferred", "test"]) assert.equal(isNotificationAllowed(kind), true, kind);
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
  for (const file of ["lib/whatsapp-chat.js", "lib/whatsapp-individual-inbound.js", "lib/prospecting-reply.js", "lib/crm-alerts.js", "lib/supervision-messages.js", "lib/whatsapp-broadcast-schedules.js"]) {
    assert.ok(!/sendPushToUser\([^)]*kind:/.test(read(file)), `${file} não pode declarar tipo permitido`);
  }
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
});
