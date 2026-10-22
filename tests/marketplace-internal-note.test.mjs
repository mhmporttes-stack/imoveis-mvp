import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INTERNAL_DIRECTION,
  MAX_INTERNAL_LENGTH,
  buildMarketplaceInternalNote,
  canUseMarketplaceInternal,
  findOutboundEcho
} from "../lib/marketplace-chat-core.mjs";
import { marketplaceReplyTimes } from "../lib/client-attendance-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-22, MKT-2i] Mensagem interna no Chat do Marketplace: "Como a mensagem interna do chat do
// WhatsApp. Apenas eu, o corretor e a gerente visualizam." Nunca vai ao cliente nem à fila; não conta como contato.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const lib = read("lib/marketplace-chat.js");
const fnBody = (name) => {
  const start = lib.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} existe`);
  const next = lib.indexOf("\nexport ", start + 10);
  return lib.slice(start, next < 0 ? undefined : next);
};

test("nota interna: direção internal, status sent (nunca queued/sending), sem id do Facebook", () => {
  const now = new Date("2026-10-22T15:00:00.000Z");
  const row = buildMarketplaceInternalNote({ conversationId: "c1", text: "  Cliente pediu visita sábado  ", senderUserId: "u1", senderName: "Ana", now });
  assert.deepEqual(row, { conversation_id: "c1", direction: INTERNAL_DIRECTION, sender_name: "Ana", sender_user_id: "u1", body: "Cliente pediu visita sábado", status: "sent", message_at: now.toISOString() });
  assert.equal("external_id" in row, false);
  assert.throws(() => buildMarketplaceInternalNote({ conversationId: "c1", text: "   " }), /Digite a mensagem interna/);
  assert.throws(() => buildMarketplaceInternalNote({ conversationId: "c1", text: "x".repeat(MAX_INTERNAL_LENGTH + 1) }), /limite/);
});

test("nota interna não vai para a fila da extensão nem conta no limite por hora", () => {
  const claim = fnBody("claimNextMarketplaceOutbound");
  assert.match(claim, /\.eq\("direction", "outbound"\)\.eq\("status", "queued"\)/);
  assert.match(claim, /\.eq\("direction", "outbound"\)\.eq\("status", "sent"\)\.not\("sender_user_id", "is", null\)/);
  // A sincronização nunca casa uma nota interna como eco de saída.
  const note = { id: "n1", external_id: null, direction: INTERNAL_DIRECTION, status: "sent", body: "oi", created_at: new Date().toISOString() };
  assert.equal(findOutboundEcho({ direction: "outbound", body: "oi" }, [note]), null);
});

test("nota interna não conta como contato, atendimento, resposta nem mexe na conversa", () => {
  const save = fnBody("saveMarketplaceInternalNote");
  for (const forbidden of ["markClientOnHumanMessage", "last_human_reply_at", "last_message_at", "updateConversation", "unread_count", "assigned_user_id:", "crm_notifications", "status: \"queued\""]) {
    assert.equal(save.includes(forbidden), false, `não usa ${forbidden}`);
  }
  // Relógio de 3 dias (MKT-2h): nota entre a mensagem do cliente e a nossa saída não conta e não "consome" a vez.
  const conversation = { assigned_at: "2026-10-22T12:00:00.000Z" };
  const at = (iso) => ({ message_at: iso, created_at: iso });
  const messages = [
    { direction: "inbound", status: "received", ...at("2026-10-22T13:00:00.000Z") },
    { direction: INTERNAL_DIRECTION, status: "sent", ...at("2026-10-22T13:01:00.000Z") },
    { direction: "outbound", status: "sent", ...at("2026-10-22T13:05:00.000Z") }
  ];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), ["2026-10-22T13:05:00.000Z"]);
  assert.deepEqual(marketplaceReplyTimes(conversation, [messages[0], messages[1]]), []);
  // A renormalização pula a nota (não vira última mensagem nem é apagada).
  assert.match(fnBody("renormalizeMarketplaceMessages"), /row\.direction === INTERNAL_DIRECTION\) continue/);
});

test("visibilidade: admin geral, gestor (já limitado à equipe pelo escopo), atribuído ou responsável — mais ninguém", () => {
  assert.equal(canUseMarketplaceInternal({ generalAdmin: true }), true);
  assert.equal(canUseMarketplaceInternal({ manager: true, profileId: "g1", assignedUserId: "b1" }), true);
  assert.equal(canUseMarketplaceInternal({ profileId: "b1", assignedUserId: "b1" }), true);
  assert.equal(canUseMarketplaceInternal({ profileId: "b1", assignedUserId: "b2", clientResponsibleId: "b1" }), true);
  assert.equal(canUseMarketplaceInternal({ profileId: "a1", assignedUserId: "b1", clientResponsibleId: "b1" }), false); // associado do b1
  assert.equal(canUseMarketplaceInternal({ profileId: "b3", assignedUserId: "b1" }), false);
  assert.equal(canUseMarketplaceInternal({ profileId: "", assignedUserId: "" }), false);
  // Filtro no BACKEND (quem não pode nunca recebe a nota) e escopo da conversa antes de tudo.
  const get = fnBody("getMarketplaceConversation");
  assert.ok(get.indexOf("loadScopedConversation") < get.indexOf("canUseInternal"));
  assert.match(get, /if \(!canInternal\) query = query\.neq\("direction", INTERNAL_DIRECTION\)/);
  const save = fnBody("saveMarketplaceInternalNote");
  assert.ok(save.indexOf("loadScopedConversation") < save.indexOf("canUseInternal"));
  assert.match(save, /status: 403|, 403\)/);
});

test("rota da nota interna exige login (requireAdminApi) antes de tudo", () => {
  const route = read("app/api/admin/marketplace-chat/conversations/[id]/internal/route.js");
  assert.ok(route.indexOf("requireAdminApi(request)") < route.indexOf("saveMarketplaceInternalNote(id"));
});

test("migration amplia o check de direção sem mexer em linhas", () => {
  const sql = read("supabase/migrations/20261022200000_marketplace_messages_internal.sql");
  assert.match(sql, /check \(direction in \('inbound', 'outbound', 'internal'\)\)/);
  assert.doesNotMatch(sql, /\b(delete|update|truncate|drop table)\b/i);
});
