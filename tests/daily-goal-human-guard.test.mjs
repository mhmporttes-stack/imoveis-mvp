import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HUMAN_CONVERSATION_RECENT_MS, HUMAN_GUARD_REASON, humanConversationBlockReason } from "../lib/daily-goal-human-guard-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-03T15:00:00Z");
const hoursAgo = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();

// 13) cadência não envia sobre conversa humana recente
test("13: pessoa da equipe conversou nas últimas 24 h -> a automática NÃO sai (motivo claro)", () => {
  assert.equal(humanConversationBlockReason([{ last_human_reply_at: hoursAgo(2), last_inbound_at: null }], { now: NOW }), HUMAN_GUARD_REASON.HUMAN_RECENT);
  assert.equal(HUMAN_GUARD_REASON.HUMAN_RECENT, "conversa_humana_recente");
});

test("13: cliente escreveu nas últimas 24 h -> a automática NÃO sai", () => {
  assert.equal(humanConversationBlockReason([{ last_human_reply_at: null, last_inbound_at: hoursAgo(3) }], { now: NOW }), HUMAN_GUARD_REASON.CLIENT_RECENT);
});

test("13: conversa antiga, sem conversa ou sem sinais -> pode enviar (demais regras da Meta Diária seguem valendo)", () => {
  assert.equal(humanConversationBlockReason([{ last_human_reply_at: hoursAgo(30), last_inbound_at: hoursAgo(48) }], { now: NOW }), null);
  assert.equal(humanConversationBlockReason([], { now: NOW }), null);
  assert.equal(humanConversationBlockReason(undefined, { now: NOW }), null);
  assert.equal(humanConversationBlockReason([{}], { now: NOW }), null);
});

test("13: qualquer sessão conta (gestor/outro corretor conversando) e o humano tem prioridade no motivo", () => {
  const rows = [{ last_human_reply_at: null, last_inbound_at: hoursAgo(1) }, { last_human_reply_at: hoursAgo(5), last_inbound_at: null }];
  assert.equal(humanConversationBlockReason(rows, { now: NOW }), HUMAN_GUARD_REASON.HUMAN_RECENT);
});

test("13: a trava usa sinais da CONVERSA, nunca só last_whatsapp_contact_at (também gravado por clique e pela automação)", () => {
  const guard = read("lib/daily-goal-human-guard.js");
  assert.match(guard, /last_human_reply_at/);
  assert.match(guard, /last_inbound_at/);
  assert.doesNotMatch(guard, /last_whatsapp_contact_at/);
});

test("13: a trava está no dispatcher, DEPOIS da revalidação e ANTES de marcar o envio e de enviar; cancela com motivo", () => {
  const auto = read("lib/daily-goal-auto.js");
  const guardAt = auto.indexOf("humanConversationBlockFor(contactRow.phone_normalized)");
  assert.ok(guardAt > 0);
  assert.ok(guardAt > auto.indexOf("const selected = await selectVariantForSend"), "depois de toda a revalidação");
  assert.ok(guardAt < auto.indexOf("send_started_at: new Date().toISOString(), message_text: selected.text"), "antes da marca de envio");
  assert.ok(guardAt < auto.indexOf("await sendIndividualMessage(brokerId, { to: contactRow.phone_normalized"), "antes do envio");
  assert.match(auto, /skip_reason: humanBlock/);
  assert.match(auto, /listPhonesBlockedByHumanConversation\(/, "a fila também não é montada para quem está em conversa");
  assert.match(read("components/DailyGoalAdmin.jsx"), /conversa_humana_recente:/, "motivo legível no histórico da automação");
});

// 14) corrida cadência x resposta humana
test("14: corrida — humano responde ANTES da checagem do envio: bloqueia; a checagem é feita com o estado atual", () => {
  const scheduledAt = NOW - 10 * 60 * 1000; // item agendado e montado há 10 min, sem conversa nenhuma
  assert.equal(humanConversationBlockReason([], { now: scheduledAt }), null, "na montagem da fila estava livre");
  const humanReplyAt = new Date(NOW - 1000).toISOString(); // resposta humana 1 s antes do envio
  assert.equal(humanConversationBlockReason([{ last_human_reply_at: humanReplyAt }], { now: NOW }), HUMAN_GUARD_REASON.HUMAN_RECENT, "no instante do envio a trava vê a resposta");
});

test("14: corrida — o item NÃO é gasto: cancelado (não 'enviado'/'skipped'), então volta a ser elegível quando a conversa esfriar", () => {
  const auto = read("lib/daily-goal-auto.js");
  assert.match(auto, /status: "canceled", skip_reason: humanBlock/);
  assert.match(auto, /neq\("status", "canceled"\)/, "item cancelado não conta como já enfileirado");
});

// 15) idempotência
test("15: a decisão é idempotente (mesma entrada, mesma saída) e a janela é a documentada (24 h)", () => {
  const rows = [{ last_human_reply_at: hoursAgo(2) }];
  const first = humanConversationBlockReason(rows, { now: NOW });
  for (let i = 0; i < 5; i += 1) assert.equal(humanConversationBlockReason(rows, { now: NOW }), first);
  assert.equal(HUMAN_CONVERSATION_RECENT_MS, 24 * 60 * 60 * 1000);
  const edge = humanConversationBlockReason([{ last_human_reply_at: new Date(NOW - HUMAN_CONVERSATION_RECENT_MS).toISOString() }], { now: NOW });
  assert.equal(edge, null, "exatamente 24 h já não é recente");
});
