import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  fillShortcutVariables, hasShortcutVariables, isServiceCommError, reminderScheduledAt, replySuggestionBlocked,
  REPLY_SUGGESTION_INSTRUCTIONS, sanitizeReplySuggestion, serviceUnreachableDedupeKey, shortcutVisibleToViewer, sortWaitingOldestFirst
} from "../lib/whatsapp-chat-assist-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("atalho: [nome]/[empreendimento]/[corretor] preenchidos; sem dado some; outros colchetes ficam", () => {
  assert.equal(fillShortcutVariables("Oi [nome], aqui é [corretor] do [empreendimento].", { clientName: "Maria da Silva", development: "Residencial Sol", brokerName: "Bruna Souza" }), "Oi Maria, aqui é Bruna do Residencial Sol.");
  assert.equal(fillShortcutVariables("Oi [nome], tudo bem?", {}), "Oi, tudo bem?");
  assert.equal(fillShortcutVariables("Veja o [item 2]", {}), "Veja o [item 2]");
  assert.equal(hasShortcutVariables("Oi [Nome]"), true);
  assert.equal(hasShortcutVariables("Oi"), false);
});

test("pacote da equipe: geral para todos; de equipe só gestor, corretores, associados e admin geral", () => {
  const team = { team_manager_id: "g1" };
  assert.equal(shortcutVisibleToViewer({}, null), true);
  assert.equal(shortcutVisibleToViewer(team, null), false);
  assert.equal(shortcutVisibleToViewer(team, { generalAdmin: true }), true);
  assert.equal(shortcutVisibleToViewer(team, { profileId: "g1" }), true);
  assert.equal(shortcutVisibleToViewer(team, { profileId: "b1", managerId: "g1" }), true);
  assert.equal(shortcutVisibleToViewer(team, { profileId: "a1", linkedBrokerManagerId: "g1" }), true);
  assert.equal(shortcutVisibleToViewer(team, { profileId: "b2", managerId: "g2" }), false);
});

test("Aguardando nós: mais antiga primeiro", () => {
  const rows = [{ id: "b", lastMessageAt: "2026-10-30T12:00:00Z" }, { id: "a", lastMessageAt: "2026-10-30T09:00:00Z" }];
  assert.deepEqual(sortWaitingOldestFirst(rows).map((row) => row.id), ["a", "b"]);
});

test("Me lembre: horários em São Paulo; passado é recusado", () => {
  const now = Date.parse("2026-10-30T13:00:00Z"); // 10h em SP
  assert.equal(reminderScheduledAt("in_1h", { now }), "2026-10-30T14:00:00.000Z");
  assert.equal(reminderScheduledAt("today_18", { now }), "2026-10-30T21:00:00.000Z");
  assert.equal(reminderScheduledAt("tomorrow_9", { now }), "2026-10-31T12:00:00.000Z");
  assert.equal(reminderScheduledAt("custom", { now, custom: "2026-11-02T15:30" }), "2026-11-02T18:30:00.000Z");
  assert.equal(reminderScheduledAt("custom", { now, custom: "2026-10-29T15:30" }), null);
  assert.equal(reminderScheduledAt("today_18", { now: Date.parse("2026-10-30T22:00:00Z") }), null);
});

test("falha de comunicação com o serviço é reconhecida; recusa do WhatsApp não", () => {
  assert.equal(isServiceCommError("Falha ao comunicar com o serviço de WhatsApp individual (status 502)."), true);
  assert.equal(isServiceCommError("fetch failed"), true);
  assert.equal(isServiceCommError("O número não possui WhatsApp."), false);
  assert.match(serviceUnreachableDedupeKey(Date.parse("2026-10-30T13:20:00Z")), /^wa_svc_unreachable:2026-10-30T10$/);
});

test("IA: nunca promete aprovação/valor, usa o nome oficial e fica desligada para Não contactar/grupo", () => {
  assert.match(REPLY_SUGGESTION_INSTRUCTIONS, /Nunca prometa aprovação/);
  assert.match(REPLY_SUGGESTION_INSTRUCTIONS, /Matheus Machado Corretor de Imóveis/);
  assert.equal(sanitizeReplySuggestion("Sua aprovação garantida!"), "");
  assert.equal(sanitizeReplySuggestion("Equipe Matheus Machado Imóveis"), "Equipe Matheus Machado Corretor de Imóveis");
  assert.equal(replySuggestionBlocked({ clientStatus: "do_not_contact" }), true);
  assert.equal(replySuggestionBlocked({ phoneDoNotContact: true }), true);
  assert.equal(replySuggestionBlocked({ isGroup: true }), true);
  assert.equal(replySuggestionBlocked({ clientStatus: "in_service" }), false);
});

test("sugestão só preenche a caixa: a rota não envia e a tela usa setText", () => {
  const route = read("app/api/admin/whatsapp-chat/conversations/[id]/suggest-reply/route.js");
  assert.doesNotMatch(route, /sendChatMessage|deliverChatMessage/);
  const lib = read("lib/whatsapp-chat.js");
  const fn = lib.slice(lib.indexOf("export async function suggestChatReply"), lib.indexOf("export async function summarizeChatConversation"));
  assert.doesNotMatch(fn, /deliverChatMessage|sendIndividualMessage|sendWhatsapp/);
  assert.match(read("components/WhatsappChat.jsx"), /onSuggestion=\{\(value\) => \{ setText\(value\)/);
});

test("Me lembre usa a Agenda de sempre (calendar_activities) e o botão de atalhos continua", () => {
  assert.match(read("components/WhatsappChatAssistBar.jsx"), /\/api\/calendar-activities/);
  assert.match(read("components/WhatsappChat.jsx"), /<WhatsappChatShortcuts canManage=\{canManage\}/);
});
