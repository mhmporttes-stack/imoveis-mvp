import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_DISCONNECT_GRACE_MS, LEGACY_DEFAULT_BODY, buildDuplicateNumberDelivery, findDuplicateNumberSessions, autoDisconnectKey, brokerDedupeKey, brokerKeyPrefix, buildAutoDisconnectDelivery, businessHoursBetween, buildFalseConnectionDeliveries, shouldAutoDisconnect, canAlertBrokerAgain, decideFalseConnectionStep, detectFailureEvidence, isSessionImpaired, sessionUiState, staffDedupeKey
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

test("desconexão automática: só evidência de falha + queda repetida + 30 min marcado", () => {
  const now = at("2026-10-13T18:00:00Z");
  const since = new Date(now - AUTO_DISCONNECT_GRACE_MS).toISOString();
  const silence = { suspect: true, reason: "unconfirmed_sends" };
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 3, silentSince: since, now }), true);
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 2, silentSince: since, now }), false); // linha quieta, quase sem queda
  assert.equal(shouldAutoDisconnect({ verdict: silence, recentDrops: 5, silentSince: new Date(now - 60 * 1000).toISOString(), now }), false); // acabou de marcar
  assert.equal(shouldAutoDisconnect({ verdict: { suspect: true, reason: "flapping" }, recentDrops: 9, silentSince: since, now }), false); // marca antiga nunca desconecta
  assert.equal(shouldAutoDisconnect({ verdict: { suspect: true, reason: "silence" }, recentDrops: 9, silentSince: since, now }), false); // silêncio sozinho nunca desconecta (Eduardo, 23/10)
  assert.equal(shouldAutoDisconnect({ verdict: { suspect: true, reason: "pipeline_stuck" }, recentDrops: 3, silentSince: since, now }), true);
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

// ---- Só com evidência de falha (dono, 2026-10-23) ----
const MIN = 60 * 1000;
const NOW = at("2026-10-23T15:00:00Z"); // qui 12:00 em Marília
const ago = (minutes) => new Date(NOW - minutes * MIN).toISOString();
const sendsTo = (...pairs) => pairs.map(([minutes, conversationId]) => ({ createdAt: ago(minutes), conversationId }));

test("sem mensagem nenhuma (corretor sem conversa) nunca é evidência, por mais longo que seja o silêncio", () => {
  assert.equal(detectFailureEvidence({ sends: [], lifeAt: ago(3 * 24 * 60), since: ago(5 * 24 * 60), now: NOW }), null);
  assert.equal(detectFailureEvidence({ sends: [], lifeAt: null, since: ago(600), now: NOW }), null);
});

test("envios sem confirmação: 3 envios para 3 conversas, o mais antigo há ≥ 20 min, sem nada voltar desde então", () => {
  const sends = sendsTo([60, "a"], [45, "b"], [30, "c"]);
  assert.equal(detectFailureEvidence({ sends, lifeAt: ago(120), since: ago(300), now: NOW }), "unconfirmed_sends");
  // Qualquer sinal de vida depois do 1º envio (recebida, entregue, lida) desfaz: casos Bruna/Eduardo/Gabriel de 23/10.
  assert.equal(detectFailureEvidence({ sends, lifeAt: ago(50), since: ago(300), now: NOW }), null);
  // Poucos envios ou poucas conversas: cliente com o celular desligado não prova nada.
  assert.equal(detectFailureEvidence({ sends: sendsTo([60, "a"], [45, "b"]), lifeAt: null, since: ago(300), now: NOW }), null);
  assert.equal(detectFailureEvidence({ sends: sendsTo([60, "a"], [45, "a"], [30, "b"]), lifeAt: null, since: ago(300), now: NOW }), null);
  // Envios recentes demais (< 20 min) ainda esperam o "entregue".
  assert.equal(detectFailureEvidence({ sends: sendsTo([19, "a"], [10, "b"], [5, "c"]), lifeAt: null, since: ago(300), now: NOW }), null);
  // Envios de antes da última (re)conexão não contam.
  assert.equal(detectFailureEvidence({ sends, lifeAt: null, since: ago(40), now: NOW }), null);
});

test("fila travada: 2 `pipeline_stuck` do vigia em 1 h e nada voltou desde o último", () => {
  assert.equal(detectFailureEvidence({ stuckAts: [ago(50), ago(20)], lifeAt: ago(60), since: ago(300), now: NOW }), "pipeline_stuck");
  assert.equal(detectFailureEvidence({ stuckAts: [ago(20)], lifeAt: null, since: ago(300), now: NOW }), null, "1 travamento: o reinício do vigia resolve");
  assert.equal(detectFailureEvidence({ stuckAts: [ago(50), ago(20)], lifeAt: ago(10), since: ago(300), now: NOW }), null, "voltou a receber");
  assert.equal(detectFailureEvidence({ stuckAts: [ago(50), ago(5)], lifeAt: null, since: ago(300), now: NOW }), null, "espera 10 min depois do último");
});

test("ordem: evidência -> reinício sem QR (sem marcar nem avisar); persistiu depois do reinício -> aviso", () => {
  const row = { status: "connected", last_connected_at: ago(120), silent_since: null, silent_reason: null };
  assert.deepEqual(decideFalseConnectionStep({ row, evidence: "unconfirmed_sends", now: NOW }), { action: "restart", reason: "unconfirmed_sends" });
  assert.deepEqual(decideFalseConnectionStep({ row, evidence: "unconfirmed_sends", lastRestartAt: ago(60), now: NOW }), { action: "alert", reason: "unconfirmed_sends" });
  // Reinício antigo (> 3 h): tenta de novo antes de avisar.
  assert.equal(decideFalseConnectionStep({ row, evidence: "unconfirmed_sends", lastRestartAt: ago(200), now: NOW }).action, "restart");
  // Fila travada repetida: o vigia do serviço já reiniciou e não resolveu.
  assert.equal(decideFalseConnectionStep({ row, evidence: "pipeline_stuck", now: NOW }).action, "alert");
  assert.equal(decideFalseConnectionStep({ row, evidence: null, now: NOW }).action, "none");
});

test("marca: acabou de conectar segura; sai com sinal de vida ou reconexão; marca antiga (silêncio/queda) sai na hora", () => {
  const marked = { status: "connected", last_connected_at: ago(120), silent_since: ago(60), silent_reason: "unconfirmed_sends" };
  assert.equal(decideFalseConnectionStep({ row: { ...marked, last_connected_at: ago(5) }, evidence: null, now: NOW }).action, "hold");
  assert.equal(decideFalseConnectionStep({ row: marked, evidence: null, lifeAt: ago(90), now: NOW }).action, "hold", "evidência envelheceu, mas nada voltou");
  assert.equal(decideFalseConnectionStep({ row: marked, evidence: null, lifeAt: ago(10), now: NOW }).action, "clear");
  assert.equal(decideFalseConnectionStep({ row: { ...marked, last_connected_at: ago(30) }, evidence: null, now: NOW }).action, "clear");
  assert.equal(decideFalseConnectionStep({ row: { ...marked, silent_reason: "silence" }, evidence: null, now: NOW }).action, "clear");
  assert.equal(decideFalseConnectionStep({ row: { ...marked, silent_reason: "flapping" }, evidence: null, now: NOW }).action, "clear");
  assert.equal(decideFalseConnectionStep({ row: { ...marked, status: "disconnected" }, evidence: null, now: NOW }).action, "clear");
  assert.equal(decideFalseConnectionStep({ row: marked, evidence: "unconfirmed_sends", now: NOW }).action, "alert");
});

test("teto do aviso ao corretor: uma chave por episódio e no máximo 1 a cada 12 h por número", () => {
  assert.equal(brokerDedupeKey("U", "2026-10-23T15:00:00Z"), brokerDedupeKey("U", "2026-10-23T15:00:00.000Z"));
  assert.notEqual(brokerDedupeKey("U", "2026-10-23T15:00:00Z"), brokerDedupeKey("U", "2026-10-23T15:02:00Z"));
  assert.ok(brokerDedupeKey("U#2", NOW).startsWith(brokerKeyPrefix("U#2")));
  assert.equal(staffDedupeKey("U", "2026-10-13T16:00:00Z"), staffDedupeKey("U", "2026-10-13T16:00:00.000Z"));
  assert.equal(canAlertBrokerAgain(null, NOW), true);
  assert.equal(canAlertBrokerAgain(ago(11 * 60), NOW), false);
  assert.equal(canAlertBrokerAgain(ago(12 * 60), NOW), true);
});

test("textos: o corretor não é mandado direto para o QR; texto antigo da definição dá lugar ao novo, personalizado fica", () => {
  const rows = buildFalseConnectionDeliveries({ definition: { body_template: LEGACY_DEFAULT_BODY }, brokerId: "B", brokerName: "Bruna", staffIds: ["M"], brokerKey: "bk", staffKey: "sk", reason: "pipeline_stuck" });
  const own = rows.find((row) => row.recipient_id === "B");
  const staff = rows.find((row) => row.recipient_id === "M");
  assert.match(own.body, /tentou reconectar sozinho/);
  assert.doesNotMatch(own.body, /desconect|QR/i);
  assert.doesNotMatch(staff.body, /desconect|pelo QR/i);
  assert.match(staff.body, /de Bruna/);
  const custom = buildFalseConnectionDeliveries({ definition: { body_template: "Atenção {corretor}{numero}" }, brokerId: "B", brokerName: "Bruna", slot: 2, staffIds: ["M"], staffKey: "sk" });
  assert.equal(custom[0].body, "Atenção Bruna (Número 2)");
});
