import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_DISCONNECT_GRACE_MS, buildDuplicateNumberDelivery, findDuplicateNumberSessions, autoDisconnectKey, brokerDedupeKey, brokerKeyPrefix, buildAutoDisconnectDelivery, businessHoursBetween, buildFalseConnectionDeliveries, shouldAutoDisconnect, classifyFalseConnection, isSessionImpaired, sessionUiState, staffDedupeKey
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

test("conexão falsa: reconexão recente (<1 h útil) e sessão não conectada nunca são suspeitas", () => {
  const now = at("2026-10-12T22:30:00Z");
  assert.equal(classifyFalseConnection({ session: { status: "connected", last_connected_at: "2026-10-12T21:30:00Z" }, inboundCount7d: 40, lastInboundAt: "2026-10-12T11:00:00Z", now }).suspect, false);
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

test("caso Bruna Nº1: reconexão automática (queda recente) não zera o silêncio; pareamento limpo espera 1 h útil", () => {
  // Última recebida seg 11:43 (14:43Z); reconectou sozinha ter 13:56 (16:56Z); agora ter 14:30 (17:30Z).
  const base = { session: { status: "connected", last_connected_at: "2026-10-13T16:56:00Z" }, inboundCount7d: 760, lastInboundAt: "2026-10-12T14:43:00Z", now: at("2026-10-13T17:30:00Z") };
  assert.deepEqual(classifyFalseConnection({ ...base, recentDrops: 2 }), { suspect: true, reason: "silence" });
  assert.equal(classifyFalseConnection({ ...base, recentDrops: 2, now: at("2026-10-13T17:05:00Z") }).suspect, false); // só 9 min conectada
  // Sem queda recente (pareamento novo): 1 h útil conectada -> 34 min ainda não conta.
  assert.equal(classifyFalseConnection({ ...base, recentDrops: 0 }).suspect, false);
});

test("número que recebe pouco tem silêncio natural maior (35/semana pede ~16 h úteis)", () => {
  const session = { status: "connected", last_connected_at: "2026-10-13T11:00:00Z" };
  const base = { session, recentDrops: 1, inboundCount7d: 35, lastInboundAt: "2026-10-12T15:24:00Z" }; // seg 12:24
  assert.equal(classifyFalseConnection({ ...base, now: at("2026-10-13T17:12:00Z") }).suspect, false); // ter 14:12 = ~12,8 h úteis
  assert.equal(classifyFalseConnection({ ...base, now: at("2026-10-13T21:30:00Z") }).suspect, true); // ter 18:30 = ~17 h úteis
});

test("acabou de reconectar: não decide e pede para manter a marca existente (hold)", () => {
  const verdict = classifyFalseConnection({ session: { status: "connected", last_connected_at: "2026-10-13T17:10:00Z" }, recentDrops: 2, inboundCount7d: 760, lastInboundAt: "2026-10-12T14:43:00Z", now: at("2026-10-13T17:15:00Z") });
  assert.equal(verdict.suspect, false);
  assert.equal(verdict.hold, true);
});

test("desconexão automática: só silêncio + queda repetida + 30 min marcado", () => {
  const now = at("2026-10-13T18:00:00Z");
  const since = new Date(now - AUTO_DISCONNECT_GRACE_MS).toISOString();
  const silence = { suspect: true, reason: "silence" };
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 3, silentSince: since, now }), true);
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 2, silentSince: since, now }), false); // linha quieta, quase sem queda
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 5, silentSince: new Date(now - 60 * 1000).toISOString(), now }), false); // acabou de marcar
  assert.equal(shouldAutoDisconnect({ verdict: { suspect: true, reason: "flapping" }, recentDrops: 9, silentSince: since, now }), false); // flapping sozinho só avisa
  assert.equal(shouldAutoDisconnect({ verdict: { suspect: false, reason: null }, recentDrops: 9, silentSince: since, now }), false);
});

test("aviso da desconexão automática: chave própria (não é encerrada pela limpeza da marca) e texto ao corretor", () => {
  const key = autoDisconnectKey("U#2", "2026-10-13T14:32:04.935Z");
  assert.ok(key.startsWith("wa_false_x:U#2:"));
  assert.ok(!key.startsWith(brokerKeyPrefix("U#2")));
  const row = buildAutoDisconnectDelivery({ brokerId: "U", slot: 2, dedupeKey: key });
  assert.match(row.body, /^Seu WhatsApp \(Número 2\) aparecia como conectado/);
  assert.equal(row.context.push_kind, "whatsapp_connection");
  assert.equal(buildAutoDisconnectDelivery({ definition: { enabled: false }, brokerId: "U", dedupeKey: key }), null);
});

test("mesma conta nos dois números do corretor: fica o de menor ordem, só entre conectados e do MESMO corretor", () => {
  const rows = [
    { user_id: "K", slot: 1, status: "connected", phone_number: "5514998822934" },
    { user_id: "K", slot: 2, status: "connected", phone_number: "5514998822934" },
    { user_id: "B", slot: 1, status: "connected", phone_number: "5514998822934" },
    { user_id: "C", slot: 1, status: "connected", phone_number: "5514911111111" },
    { user_id: "C", slot: 2, status: "connected", phone_number: "5514922222222" },
    { user_id: "D", slot: 1, status: "connected", phone_number: "5514933333333" },
    { user_id: "D", slot: 2, status: "disconnected", phone_number: "5514933333333" },
    { user_id: "E", slot: 1, status: "connected", phone_number: null },
    { user_id: "E", slot: 2, status: "connected", phone_number: "" }
  ];
  const extra = findDuplicateNumberSessions(rows);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].user_id, "K");
  assert.equal(extra[0].slot, 2);
  assert.deepEqual(findDuplicateNumberSessions([]), []);
  const notice = buildDuplicateNumberDelivery({ brokerId: "K", keepSlot: 1, slot: 2, dedupeKey: "wa_dup:K#2:x" });
  assert.match(notice.body, /Número 2 é o mesmo do Número 1/);
  assert.equal(notice.context.push_kind, "whatsapp_connection");
  assert.equal(buildDuplicateNumberDelivery({ slot: 2, dedupeKey: "k" }), null);
});
