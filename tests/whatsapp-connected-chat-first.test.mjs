import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isConnectedChatFirst, buildCrmChatUrl, decideCardWhatsapp } from "../lib/client-card-whatsapp-core.mjs";
import { isConnectedOwnClientFirstMessageAllowed } from "../lib/distribution-first-message-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-29] Corretor/associado com WhatsApp conectado sempre abre o Chat do CRM, nunca o WhatsApp Web.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = { responsible_user_id: "gab", pending_distribution_at: null, status: "awaiting_return" };
const base = { client, sessionOwnerId: "gab", sessionOwnerRole: "broker", sessionStatus: "connected" };

test("decisão única: só corretor/associado conectado", () => {
  assert.equal(isConnectedChatFirst({ role: "broker", sessionStatus: "connected" }), true);
  assert.equal(isConnectedChatFirst({ role: "associate", sessionStatus: "connected" }), true);
  assert.equal(isConnectedChatFirst({ role: "broker", sessionStatus: "disconnected" }), false);
  assert.equal(isConnectedChatFirst({ role: "admin", sessionStatus: "connected" }), false);
  assert.equal(isConnectedChatFirst({ role: "manager", sessionStatus: "connected" }), false);
});

test("link do Chat com texto pronto", () => {
  assert.equal(buildCrmChatUrl("abc", "Oi João"), "/admin/chat?client=abc&text=Oi%20Jo%C3%A3o");
  assert.equal(buildCrmChatUrl("abc"), "/admin/chat?client=abc");
  assert.equal(buildCrmChatUrl(""), "");
});

test("card: conectado e cliente próprio abre o Chat", () => {
  const d = decideCardWhatsapp({ stateKnown: true, sessionStatus: "connected", isOwnClient: true, phone: "14999998888", device: "mobile" });
  assert.equal(d.action, "chat");
});

test("Chat deixa o corretor conectado iniciar a conversa com o próprio cliente", () => {
  assert.equal(isConnectedOwnClientFirstMessageAllowed(base), true);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, sessionOwnerRole: "associate" }), true);
});

test("travas mantidas", () => {
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, sessionOwnerId: "jen" }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, sessionOwnerRole: "admin" }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, sessionStatus: "disconnected" }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, client: { ...client, status: "do_not_contact" } }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, client: { ...client, status: "archived" } }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, client: { ...client, pending_distribution_at: "2026-10-29T10:00:00Z" } }), false);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, phoneBlocked: true }), false);
});

test("Meta Diária: tentativa registrada antes do destino; conectado devolve chatUrl", () => {
  const src = read("lib/daily-goal.js");
  const fn = src.slice(src.indexOf("export async function registerDailyGoalAttempt("));
  assert.ok(fn.indexOf('from("daily_goal_attempts").insert') < fn.indexOf("chatUrl"));
  assert.match(fn, /isConnectedChatFirst\(\{ role: auth\.profile\?\.role, sessionStatus \}\)/);
  assert.match(read("components/DailyGoalDashboard.jsx"), /whatsappUrl\?\.chatUrl/);
  assert.match(read("lib/whatsapp-chat.js"), /isConnectedOwnClientFirstMessageAllowed\(/);
});
