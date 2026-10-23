import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMarketplaceInternalNotice,
  marketplaceConversationLink,
  resolveMarketplaceInternalRecipients
} from "../lib/marketplace-chat-core.mjs";
import { NOTIFICATION_KIND, isNotificationAllowed } from "../lib/notification-policy-core.mjs";
import { notificationPanelLink } from "../lib/crm-alerts-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-22, MKT-2i] Mensagem interna no Chat do Marketplace avisa (sino + push) admin geral,
// corretor responsável/atribuído e gestora da equipe; nunca o autor, associado nem cliente; 1 aviso por mensagem; abre a
// conversa. Exceção à AUT-9 SÓ do Marketplace (a nota interna do WhatsApp segue sem aviso).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ADMIN = { id: "admin", role: "admin", status: "active" };
const ADMIN_OFF = { id: "admin-off", role: "admin", status: "inactive" };
const GESTORA = { id: "gestora", role: "manager", status: "active" };
const OUTRA_GESTORA = { id: "outra-gestora", role: "manager", status: "active" };
const CORRETOR = { id: "corretor", role: "broker", status: "active", manager_id: "gestora" };
const OUTRO_CORRETOR = { id: "outro-corretor", role: "broker", status: "active", manager_id: "outra-gestora" };
const ASSOCIADO = { id: "associado", role: "associate", status: "active", linked_broker_id: "corretor" };
const USERS = [ADMIN, ADMIN_OFF, GESTORA, OUTRA_GESTORA, CORRETOR, OUTRO_CORRETOR, ASSOCIADO];

const sorted = (list) => [...list].sort();

test("avisa admin geral, o corretor atribuído e a gestora dele; não avisa outra equipe nem inativo", () => {
  const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "corretor", authorId: "" });
  assert.deepEqual(sorted(recipients), ["admin", "corretor", "gestora"]);
});

test("responsável pelo cliente diferente do atribuído: os dois e as gestoras dos dois", () => {
  const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "corretor", clientResponsibleId: "outro-corretor" });
  assert.deepEqual(sorted(recipients), ["admin", "corretor", "gestora", "outra-gestora", "outro-corretor"]);
});

test("nunca avisa o autor (corretor, gestora ou admin)", () => {
  for (const authorId of ["corretor", "gestora", "admin"]) {
    const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "corretor", authorId });
    assert.ok(!recipients.includes(authorId), authorId);
  }
});

test("nunca avisa associado, nem quando ele é o atribuído; a gestora do corretor vinculado é avisada", () => {
  const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "associado" });
  assert.ok(!recipients.includes("associado"));
  assert.deepEqual(sorted(recipients), ["admin", "gestora"]);
  assert.ok(!resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "corretor" }).includes("associado"));
});

test("nunca avisa o cliente: só usuários do painel (admin_users) entram, ids desconhecidos ficam fora", () => {
  const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "cliente-do-facebook", clientResponsibleId: "" });
  assert.deepEqual(recipients, ["admin"]);
});

test("sem duplicar: atribuído = responsável gera um aviso só por pessoa", () => {
  const recipients = resolveMarketplaceInternalRecipients({ users: USERS, assignedUserId: "corretor", clientResponsibleId: "corretor" });
  assert.equal(recipients.length, new Set(recipients).size);
});

test("texto, link da conversa e tipo liberado na política (sino e push)", () => {
  const notice = buildMarketplaceInternalNotice({ authorName: "Matheus", contactName: "Ana" });
  assert.equal(notice.title, "Mensagem interna no Marketplace");
  assert.equal(notice.description, "Matheus adicionou uma mensagem interna na conversa do Marketplace com Ana.");
  const id = "0e1a2b3c-0000-4000-8000-000000000000";
  assert.equal(marketplaceConversationLink(id), `/admin/chat/marketplace?conversa=${id}`);
  assert.equal(marketplaceConversationLink("x'; drop"), "/admin/chat/marketplace");
  assert.equal(notificationPanelLink(marketplaceConversationLink(id)), `/admin/chat/marketplace?conversa=${id}`);
  assert.equal(NOTIFICATION_KIND.MARKETPLACE_INTERNAL, "marketplace_internal");
  assert.equal(isNotificationAllowed("marketplace_internal"), true);
  assert.equal(isNotificationAllowed("chat_internal"), false, "nota interna do WhatsApp continua sem aviso (AUT-9)");
});

test("ligação: a nota chama o aviso uma vez, depois de gravar; sino com link e push com o tipo declarado", () => {
  const lib = read("lib/marketplace-chat.js");
  const save = lib.slice(lib.indexOf("export async function saveMarketplaceInternalNote("), lib.indexOf("async function notifyMarketplaceInternalNote("));
  assert.equal(save.split("notifyMarketplaceInternalNote(").length - 1, 1);
  assert.ok(save.indexOf(".insert(row)") < save.indexOf("notifyMarketplaceInternalNote("));
  const notify = lib.slice(lib.indexOf("async function notifyMarketplaceInternalNote("));
  assert.ok(notify.includes("notification_type: NOTIFICATION_KIND.MARKETPLACE_INTERNAL"));
  assert.ok(notify.includes("link,"));
  assert.ok(notify.includes("kind: NOTIFICATION_KIND.MARKETPLACE_INTERNAL"));
  assert.ok(notify.includes("tag: `marketplace-internal:${messageId}`"));
  // O WhatsApp não foi tocado: a nota interna dele continua com o tipo bloqueado.
  assert.ok(read("lib/whatsapp-chat.js").includes('notification_type: "chat_internal"'));
});

test("sino lê o link sem quebrar antes da migration; a tela abre a conversa por ?conversa=", () => {
  const alerts = read("lib/crm-alerts.js");
  assert.ok(alerts.includes('marketplace_internal: "Marketplace"'));
  assert.ok(alerts.includes("notificationPanelLink(row.link) ||"));
  const page = read("app/admin/chat/marketplace/page.jsx");
  assert.ok(page.includes("isUuid(requested)") && page.includes("initialConversationId={initialConversationId}"));
  const ui = read("components/marketplace/MarketplaceChat.jsx");
  assert.ok(ui.includes('useState(initialConversationId || "")'));
  const migration = read("supabase/migrations/20261022231000_crm_notifications_marketplace_internal.sql");
  assert.ok(migration.includes("add column if not exists link text"));
});
