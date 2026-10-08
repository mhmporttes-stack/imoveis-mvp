import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_WHATSAPP_SLOTS, WHATSAPP_SLOTS, aggregateSessionStatus, alertSubjectKey, buildSessionId, dispatchSessionStatus,
  dispatchSlots, groupSessionRowsByUser, isSlotDispatchEnabled, normalizeSlot, parseSessionId, pickDispatchSlot,
  representativeSessionRow, sanitizeSlotLabel, slotDisplayName, slotFromChatFilter
} from "../lib/whatsapp-session-slots.mjs";
import { sanitizeTelemetryEvent } from "../lib/whatsapp-session-telemetry-core.mjs";
import { pickSendChannel } from "../lib/whatsapp-individual-routing.mjs";

// Dois números de WhatsApp individual por corretor (REGRA OFICIAL — dono, 2026-10-08).
const USER = "3f6c1a52-8b4e-4c1d-9a7e-2b5d8c9e0f11";

test("Número 1 usa EXATAMENTE a chave de antes (id do corretor) — sessões atuais não mudam de id", () => {
  assert.equal(buildSessionId(USER), USER);
  assert.equal(buildSessionId(USER, 1), USER);
  assert.equal(buildSessionId(USER, "1"), USER);
  assert.deepEqual(parseSessionId(USER), { userId: USER, slot: 1 });
});

test("Número 2 = '<id>:2' no microsserviço e volta para (corretor, 2)", () => {
  assert.equal(buildSessionId(USER, 2), `${USER}:2`);
  assert.deepEqual(parseSessionId(`${USER}:2`), { userId: USER, slot: 2 });
  // Caminho da rota do microsserviço (encodeURIComponent) é decodificado pelo express de volta ao mesmo id.
  assert.equal(decodeURIComponent(encodeURIComponent(buildSessionId(USER, 2))), `${USER}:2`);
});

test("ids inválidos são recusados (nada de ':1', ':3', texto qualquer)", () => {
  for (const value of ["", "abc", `${USER}:1`, `${USER}:3`, `${USER}:0`, `${USER}:22`, `${USER}x`, "../etc"]) {
    assert.equal(parseSessionId(value), null, value);
  }
});

test("limite de 2 números por corretor", () => {
  assert.equal(MAX_WHATSAPP_SLOTS, 2);
  assert.deepEqual(WHATSAPP_SLOTS, [1, 2]);
  assert.equal(normalizeSlot(undefined), 1);
  assert.equal(normalizeSlot(null), 1);
  assert.equal(normalizeSlot(""), 1);
  assert.equal(normalizeSlot(2), 2);
  assert.equal(normalizeSlot("2"), 2);
  for (const value of [0, 3, -1, 1.5, "abc", "3"]) assert.equal(normalizeSlot(value), null, String(value));
});

test("status do corretor: só com o Número 1 é idêntico ao de antes", () => {
  for (const status of ["connected", "disconnected", "reconnecting", "error", "qr_required"]) {
    assert.equal(aggregateSessionStatus([{ slot: 1, status }]), status);
    // Linha antiga sem a coluna slot (antes da migration) também é o Número 1.
    assert.equal(aggregateSessionStatus([{ status }]), status);
  }
  assert.equal(aggregateSessionStatus([]), null);
});

test("status do corretor: conectado se QUALQUER número estiver; senão o do Número 1", () => {
  assert.equal(aggregateSessionStatus([{ slot: 1, status: "error" }, { slot: 2, status: "connected" }]), "connected");
  assert.equal(aggregateSessionStatus([{ slot: 2, status: "disconnected" }, { slot: 1, status: "reconnecting" }]), "reconnecting");
  assert.equal(aggregateSessionStatus([{ slot: 2, status: "qr_required" }]), "qr_required");
  assert.equal(representativeSessionRow([{ slot: 1, status: "error" }, { slot: 2, status: "connected" }]).slot, 2);
  assert.equal(representativeSessionRow([{ slot: 2, status: "error" }, { slot: 1, status: "disconnected" }]).slot, 1);
});

test("chave 'Usar para disparo': padrão ligado no Número 1 e desligado no Número 2", () => {
  assert.equal(isSlotDispatchEnabled({ slot: 1, dispatch_enabled: null }), true);
  assert.equal(isSlotDispatchEnabled({ dispatch_enabled: null }), true); // linha antiga = Número 1
  assert.equal(isSlotDispatchEnabled({ slot: 2, dispatch_enabled: null }), false);
  assert.equal(isSlotDispatchEnabled({ slot: 1, dispatch_enabled: false }), false);
  assert.equal(isSlotDispatchEnabled({ slot: 2, dispatch_enabled: true }), true);
  assert.equal(isSlotDispatchEnabled(null), false);
});

test("disparo só por número conectado com a chave ligada", () => {
  const rows = [
    { slot: 1, status: "connected", dispatch_enabled: null },
    { slot: 2, status: "connected", dispatch_enabled: null }
  ];
  assert.deepEqual(dispatchSlots(rows), [1]); // Número 2 conectado mas com a chave no padrão (desligada)
  assert.deepEqual(dispatchSlots([{ ...rows[0] }, { ...rows[1], dispatch_enabled: true }]), [1, 2]);
  assert.deepEqual(dispatchSlots([{ ...rows[0], status: "reconnecting" }, { ...rows[1], dispatch_enabled: true }]), [2]);
  assert.equal(dispatchSessionStatus([{ slot: 1, status: "connected", dispatch_enabled: false }]), "disconnected");
  assert.equal(dispatchSessionStatus([{ slot: 1, status: "connected" }]), "connected");
  assert.equal(dispatchSessionStatus([{ slot: 1, status: "reconnecting" }]), "reconnecting");
  assert.equal(dispatchSessionStatus([]), null);
});

test("meio a meio: meta de 10 com os dois ligados = 5 em cada, alternando", () => {
  const sent = { 1: 0, 2: 0 };
  let last = null;
  const order = [];
  for (let i = 0; i < 10; i += 1) {
    const slot = pickDispatchSlot({ candidates: [1, 2], sentTodayBySlot: sent, lastSlot: last });
    sent[slot] += 1;
    last = slot;
    order.push(slot);
  }
  assert.deepEqual(sent, { 1: 5, 2: 5 });
  assert.deepEqual(order, [1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
});

test("um número cai: os envios vão pelo outro, sem passar da meta total", () => {
  const sent = { 1: 3, 2: 3 };
  let total = 6;
  // Número 1 caiu: só o 2 é candidato até completar a meta de 10.
  while (total < 10) {
    const slot = pickDispatchSlot({ candidates: [2], sentTodayBySlot: sent, lastSlot: 2 });
    assert.equal(slot, 2);
    sent[slot] += 1;
    total += 1;
  }
  assert.equal(sent[1] + sent[2], 10);
  // Volta o Número 1: ele recebe até equilibrar (o total do dia continua sendo controlado pela fila do corretor).
  assert.equal(pickDispatchSlot({ candidates: [1, 2], sentTodayBySlot: sent, lastSlot: 2 }), 1);
  assert.equal(pickDispatchSlot({ candidates: [], sentTodayBySlot: sent }), null);
});

test("empate sem histórico começa pelo Número 1; empate alterna com o último", () => {
  assert.equal(pickDispatchSlot({ candidates: [2, 1] }), 1);
  assert.equal(pickDispatchSlot({ candidates: [1, 2], sentTodayBySlot: { 1: 2, 2: 2 }, lastSlot: 1 }), 2);
  assert.equal(pickDispatchSlot({ candidates: [1, 2], sentTodayBySlot: { 1: 2, 2: 2 }, lastSlot: 2 }), 1);
});

test("alertas: chaves do Número 1 intactas e o Número 2 nunca casa com o LIKE do Número 1", () => {
  assert.equal(alertSubjectKey(USER, 1), USER);
  assert.equal(alertSubjectKey(USER), USER);
  const slot2 = alertSubjectKey(USER, 2);
  assert.notEqual(slot2, USER);
  assert.equal(`wa_disc:${slot2}:2026-10-08`.startsWith(`wa_disc:${USER}:`), false);
  assert.equal(`wa_attn:${slot2}:retry_limit:x`.startsWith(`wa_attn:${USER}:`), false);
});

test("telemetria aceita o id de sessão do Número 2 e grava o número", () => {
  const base = { type: "connected", bootId: "boot-1", occurredAt: new Date().toISOString() };
  const one = sanitizeTelemetryEvent({ ...base, userId: USER });
  assert.equal(one.user_id, USER);
  assert.equal(one.session_slot, 1);
  const two = sanitizeTelemetryEvent({ ...base, userId: `${USER}:2` });
  assert.equal(two.user_id, USER);
  assert.equal(two.session_slot, 2);
  assert.equal(sanitizeTelemetryEvent({ ...base, userId: `${USER}:9` }), null);
});

test("rótulos, apelido e filtros do Chat", () => {
  assert.equal(slotDisplayName(1), "Número 1");
  assert.equal(slotDisplayName(2, "  Trabalho  "), "Número 2 · Trabalho");
  assert.equal(sanitizeSlotLabel("x".repeat(80)).length, 30);
  assert.equal(slotFromChatFilter("slot1"), 1);
  assert.equal(slotFromChatFilter("slot2"), 2);
  assert.equal(slotFromChatFilter("personal"), null);
  const grouped = groupSessionRowsByUser([{ user_id: "a", slot: 2 }, { user_id: "a", slot: 1 }, { user_id: "b", slot: 1 }]);
  assert.deepEqual(grouped.get("a").map((row) => row.slot), [1, 2]);
});

test("roteamento do Chat continua o mesmo por número (conectado envia, configurado e caído bloqueia)", () => {
  assert.equal(pickSendChannel({ assignedUserId: USER, individualSessionStatus: aggregateSessionStatus([{ slot: 1, status: "connected" }]) }), "individual");
  assert.equal(pickSendChannel({ assignedUserId: USER, individualSessionStatus: aggregateSessionStatus([{ slot: 1, status: "error" }]) }), "blocked");
  assert.equal(pickSendChannel({ assignedUserId: USER, individualSessionStatus: aggregateSessionStatus([]) }), "cloud_api");
});

// Travas de código (sem banco): a resposta sai pelo número da conversa e a automação pelo número escolhido.
test("Chat responde pelo número da conversa e a automação envia pelo número escolhido", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /getIndividualSessionStatusForSlot\(owner, sessionSlot\)/);
  assert.match(chat, /sendIndividualMessage\(assignedUserId, \{ to: conversation\.contact_phone, text: body, slot: sessionSlot/);
  assert.match(chat, /media: individualMedia, slot: sessionSlot/);
  const auto = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  assert.match(auto, /sendIndividualMessage\(brokerId, \{ to: contactRow\.phone_normalized, text: item\.message_text, slot: dispatchSlot \}\)/);
  assert.doesNotMatch(auto, /getIndividualSessionStatusForUser/);
  // Rotas do próprio usuário: nunca recebem id de fora, só o número.
  for (const name of ["connect", "disconnect", "settings"]) {
    const route = readFileSync(new URL(`../app/api/admin/whatsapp-individual/${name}/route.js`, import.meta.url), "utf8");
    assert.match(route, /const userId = auth\.profile\?\.id;/);
    assert.doesNotMatch(route, /body\??\.userId/);
  }
});
