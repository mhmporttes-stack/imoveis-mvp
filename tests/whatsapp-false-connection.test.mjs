import test from "node:test";
import assert from "node:assert/strict";
import {
  brokerDedupeKey, businessHoursBetween, buildFalseConnectionDeliveries, classifyFalseConnection, isSessionImpaired, sessionUiState, staffDedupeKey
} from "../lib/whatsapp-false-connection-core.mjs";

// Marília = UTC-3. 2026-10-12 é segunda-feira.
const at = (iso) => new Date(iso).getTime();

test("horas úteis: seg 12h -> ter 10h = 7 + 2", () => {
  assert.equal(businessHoursBetween("2026-10-12T15:00:00Z", "2026-10-13T13:00:00Z"), 9);
});

test("horas úteis: fim de semana e noite não contam", () => {
  assert.equal(businessHoursBetween("2026-10-10T15:00:00Z", "2026-10-11T22:00:00Z"), 0); // sáb 12h -> dom 19h
  assert.equal(businessHoursBetween("2026-10-12T23:00:00Z", "2026-10-13T10:00:00Z"), 0); // seg 20h -> ter 07h
});

test("conexão falsa: queda 500/428 em loop (3 na última hora) marca flapping", () => {
  const session = { status: "connected", last_connected_at: "2026-10-13T16:39:00Z" };
  assert.deepEqual(classifyFalseConnection({ session, flapDrops: 3, now: at("2026-10-13T16:50:00Z") }), { suspect: true, reason: "flapping" });
  assert.equal(classifyFalseConnection({ session, flapDrops: 2, now: at("2026-10-13T16:50:00Z") }).suspect, false);
});

test("conexão falsa: silêncio de 6 h úteis em número que costuma receber", () => {
  const session = { status: "connected", last_connected_at: "2026-10-12T11:00:00Z" }; // seg 08h
  const base = { session, inboundCount7d: 40, lastInboundAt: "2026-10-12T12:00:00Z", now: at("2026-10-12T22:30:00Z") }; // seg 19h30: 7 h úteis
  assert.deepEqual(classifyFalseConnection(base), { suspect: true, reason: "silence" });
  assert.equal(classifyFalseConnection({ ...base, now: at("2026-10-12T16:00:00Z") }).suspect, false); // só 4 h úteis
  assert.equal(classifyFalseConnection({ ...base, inboundCount7d: 2 }).suspect, false); // número que quase não recebe
  assert.equal(classifyFalseConnection({ ...base, lastInboundAt: "2026-10-12T22:00:00Z" }).suspect, false); // recebeu há pouco
});

test("conexão falsa: reconexão recente (<2 h) e sessão não conectada nunca são suspeitas", () => {
  const now = at("2026-10-12T22:30:00Z");
  assert.equal(classifyFalseConnection({ session: { status: "connected", last_connected_at: "2026-10-12T21:00:00Z" }, inboundCount7d: 40, lastInboundAt: "2026-10-12T11:00:00Z", now }).suspect, false);
  assert.equal(classifyFalseConnection({ session: { status: "disconnected", last_connected_at: "2026-10-01T00:00:00Z" }, flapDrops: 9, now }).suspect, false);
});

test("estado da tela: desconectado = down, conectado marcado = silent, reconectando não pinta", () => {
  assert.equal(sessionUiState({ status: "disconnected" }), "down");
  assert.equal(sessionUiState({ status: "error" }), "down");
  assert.equal(sessionUiState({ status: "qr_required" }), "down");
  assert.equal(sessionUiState({ status: "connected", silent_since: "2026-10-13T10:00:00Z" }), "silent");
  assert.equal(sessionUiState({ status: "connected" }), "ok");
  assert.equal(sessionUiState({ status: "reconnecting" }), "ok");
  assert.equal(isSessionImpaired("down"), true);
  assert.equal(isSessionImpaired("silent"), true);
  assert.equal(isSessionImpaired("ok"), false);
});

test("chaves: corretor repete a cada 2 h; equipe uma vez por suspeita", () => {
  const t = at("2026-10-13T16:00:00Z");
  assert.equal(brokerDedupeKey("U", t), brokerDedupeKey("U", t + 60 * 1000));
  assert.notEqual(brokerDedupeKey("U", t), brokerDedupeKey("U", t + 2 * 60 * 60 * 1000));
  assert.equal(staffDedupeKey("U", "2026-10-13T16:00:00Z"), staffDedupeKey("U", "2026-10-13T16:00:00.000Z"));
});

test("entregas: corretor em 2ª pessoa, equipe com nome; sem duplicar nem se avisar de novo; definição desligada = nada", () => {
  const rows = buildFalseConnectionDeliveries({ brokerId: "B", brokerName: "Bruna", slot: 2, staffIds: ["M", "G", "M", "B"], brokerKey: "bk", staffKey: "sk" });
  assert.equal(rows.length, 3);
  const own = rows.find((row) => row.recipient_id === "B");
  assert.match(own.body, /^Seu WhatsApp \(Número 2\)/);
  assert.equal(own.context.push_kind, "whatsapp_connection");
  const staff = rows.find((row) => row.recipient_id === "M");
  assert.match(staff.body, /de Bruna/);
  assert.equal(staff.kind, "important");
  assert.deepEqual(buildFalseConnectionDeliveries({ definition: { enabled: false }, brokerId: "B", staffIds: ["M"], brokerKey: "bk", staffKey: "sk" }), []);
});
