import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEW_CONTACT_DAILY_CAP, NEW_CONTACT_BLOCK_REASON, WARMUP_STAGES, BRAKE_CODE, warmupDayNumber, warmupCapFor, isNewContact,
  countNewContactsToday, newContactLimit, newContactBlockReason, isFailedSendRow, countConsecutiveFailures, evaluateReplyRate,
  isSessionNeedsAttention, evaluateBrake, brakeReasonText, isBrakePausedReason, nextBrakeStateOnPause, nextBrakeStateOnRelease,
  brakeAlertDedupeKey, brakeStateKey
} from "../lib/whatsapp-sending-safety-core.mjs";
import { dailyCapFor, applyPolicyV2, v2SendBlockReason, summarizeV2Usage } from "../lib/daily-goal-policy-core.mjs";
import { describeAttention, buildAttentionDeliveries, ATTENTION_STATE } from "../lib/whatsapp-session-attention-core.mjs";

// 2026-10-06 12:00 em São Paulo (15:00Z)
const at = (dateStr) => Date.parse(`${dateStr}T12:00:00-03:00`);
const NOW = at("2026-10-06");

/* ------------------------------ Aquecimento ------------------------------ */
test("aquecimento: escada 5/10/20/30 pela data de início (dia 1 = a própria data)", () => {
  const start = "2026-10-06";
  assert.equal(warmupDayNumber(start, at("2026-10-06")), 1);
  assert.equal(warmupCapFor(start, at("2026-10-06")), 5);
  assert.equal(warmupCapFor(start, at("2026-10-12")), 5); // dia 7
  assert.equal(warmupCapFor(start, at("2026-10-13")), 10); // dia 8
  assert.equal(warmupCapFor(start, at("2026-10-19")), 10); // dia 14
  assert.equal(warmupCapFor(start, at("2026-10-20")), 20); // dia 15
  assert.equal(warmupCapFor(start, at("2026-10-26")), 20); // dia 21
  assert.equal(warmupCapFor(start, at("2026-10-27")), 30); // dia 22
  assert.equal(WARMUP_STAGES.length, 3);
});

test("aquecimento: sem data (ou inválida) = sem limite; data futura = estágio mais restrito; fuso de São Paulo", () => {
  assert.equal(warmupCapFor(null, NOW), 30);
  assert.equal(warmupCapFor("lixo", NOW), 30);
  assert.equal(warmupCapFor("2026-10-20", NOW), 5);
  // 01:00 UTC de 07/10 ainda é 22:00 de 06/10 em São Paulo
  assert.equal(warmupDayNumber("2026-10-06", Date.parse("2026-10-07T01:00:00Z")), 1);
  // Aceita timestamp ISO (corta a data)
  assert.equal(warmupCapFor("2026-10-06T00:00:00+00:00", NOW), 5);
});

test("dailyCapFor: vale o MENOR entre 30, teto manual e estágio; sem warmup nada muda", () => {
  assert.equal(dailyCapFor({}, NOW), 30);
  assert.equal(dailyCapFor({ daily_cap_override: 12 }, NOW), 12);
  assert.equal(dailyCapFor({ warmup_start_date: "2026-10-06" }, NOW), 5);
  assert.equal(dailyCapFor({ warmup_start_date: "2026-10-06", daily_cap_override: 20 }, NOW), 5, "override nunca acima do estágio");
  assert.equal(dailyCapFor({ warmup_start_date: "2026-10-06", daily_cap_override: 3 }, NOW), 3, "override menor que o estágio vale");
  assert.equal(dailyCapFor({ warmup_start_date: "2026-10-06", daily_cap_override: 100 }, NOW + 7 * 86400000), 10);
});

test("aquecimento chega ao envio: applyPolicyV2 e v2SendBlockReason respeitam o teto do estágio", () => {
  const row = { broker_id: "b", enabled: true, warmup_start_date: "2026-10-06" };
  const settings = applyPolicyV2(row);
  assert.equal(settings.daily_cap_override, 5);
  const usage = summarizeV2Usage(Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, status: "sent", source: "meta", attempt_number: 1, sent_at: "2026-10-06T10:00:00Z", send_started_at: "2026-10-06T10:00:00Z" })));
  assert.equal(v2SendBlockReason({ nowMs: NOW, usage, settings }), "teto_diario_politica");
});

/* ------------------------------ Contatos novos ------------------------------ */
test("contatos novos: constante sugerida 12 e bloqueio no limite", () => {
  assert.equal(NEW_CONTACT_DAILY_CAP, 12);
  const dayStart = Date.parse("2026-10-06T00:00:00-03:00");
  assert.equal(newContactBlockReason({ isNew: true, newUsedToday: 11, dailyCap: 30 }), null);
  assert.equal(newContactBlockReason({ isNew: true, newUsedToday: 12, dailyCap: 30 }), NEW_CONTACT_BLOCK_REASON);
  assert.equal(newContactBlockReason({ isNew: false, newUsedToday: 99, dailyCap: 30 }), null, "quem já conversou nunca é barrado por este limite");
  assert.equal(newContactLimit(5), 5, "limite de novos nunca acima do teto do dia (aquecimento)");
  assert.equal(newContactBlockReason({ isNew: true, newUsedToday: 5, dailyCap: 5 }), NEW_CONTACT_BLOCK_REASON);
  assert.ok(dayStart > 0);
});

test("contato novo = sem prova anterior de contato com o chip; prova de dias anteriores = já conversou", () => {
  const dayStart = Date.parse("2026-10-06T00:00:00-03:00");
  assert.equal(isNewContact(null, dayStart), true);
  assert.equal(isNewContact(dayStart + 3600000, dayStart), true, "primeira mensagem foi hoje (ele próprio): ainda novo hoje");
  assert.equal(isNewContact(dayStart - 1, dayStart), false);
  assert.equal(countNewContactsToday([null, dayStart + 1, dayStart - 5, dayStart - 86400000], dayStart), 2);
});

/* ------------------------------ Freio: falhas seguidas ------------------------------ */
const attempt = (minute, over = {}) => ({ send_started_at: `2026-10-06T10:${String(minute).padStart(2, "0")}:00Z`, status: "error", last_error: "falha", wa_message_id: null, ...over });
const ok = (minute) => attempt(minute, { status: "sent", last_error: null, wa_message_id: "w" });

test("freio: 3 falhas seguidas disparam; um envio que saiu no meio zera; menos de 3 não", () => {
  assert.equal(countConsecutiveFailures([attempt(1), attempt(2), attempt(3)]), 3);
  assert.equal(countConsecutiveFailures([attempt(1), attempt(2), ok(3), attempt(4)]), 1);
  assert.equal(countConsecutiveFailures([attempt(1), attempt(2)]), 2);
  assert.equal(evaluateBrake({ consecutiveFailures: 2 }), null);
  assert.equal(evaluateBrake({ consecutiveFailures: 3 }).code, BRAKE_CODE.FAILURES);
});

test("freio: falha interna do sistema, item sem confirmação e linha sem send_started_at NÃO contam", () => {
  assert.equal(isFailedSendRow(attempt(1, { last_error: "Recuperado de 'enviando': ..." })), false);
  assert.equal(isFailedSendRow(attempt(1, { last_error: "Erro inesperado: x" })), false);
  assert.equal(isFailedSendRow(attempt(1, { skip_reason: "enviando_sem_confirmacao" })), false);
  assert.equal(isFailedSendRow(attempt(1, { send_started_at: null })), false);
  assert.equal(isFailedSendRow(attempt(1, { status: "pending" })), true, "falha de infraestrutura volta a pending com last_error");
  // linha ambígua interrompe a sequência (na dúvida não pausa)
  assert.equal(countConsecutiveFailures([attempt(1), attempt(2, { skip_reason: "enviando_sem_confirmacao" }), attempt(3)]), 1);
});

test("freio: só conta tentativas depois da última liberação (sinceMs)", () => {
  const released = Date.parse("2026-10-06T10:02:30Z");
  assert.equal(countConsecutiveFailures([attempt(1), attempt(2), attempt(3), attempt(4)], { sinceMs: released }), 2);
});

/* ------------------------------ Freio: taxa de resposta ------------------------------ */
const sample = (n, replied) => Array.from({ length: n }, (_, i) => ({ sentMs: 1000 + i, replied: i < replied }));

test("freio: taxa de resposta < 3% em 50 entregues pausa; com amostra < 50 nunca avalia", () => {
  assert.deepEqual(evaluateReplyRate(sample(49, 0)).evaluated, false);
  assert.equal(evaluateBrake({ replyStats: evaluateReplyRate(sample(49, 0)) }), null);
  const zero = evaluateReplyRate(sample(50, 0));
  assert.equal(zero.evaluated, true);
  assert.equal(zero.below, true);
  assert.equal(evaluateBrake({ replyStats: zero }).code, BRAKE_CODE.LOW_REPLY);
  assert.equal(evaluateReplyRate(sample(50, 1)).below, true, "1/50 = 2% < 3%");
  assert.equal(evaluateReplyRate(sample(50, 2)).below, false, "2/50 = 4%");
  assert.equal(evaluateBrake({ replyStats: evaluateReplyRate(sample(50, 2)) }), null);
});

test("freio: janela = os 50 mais recentes e só depois da liberação", () => {
  const rows = [...sample(10, 10).map((r, i) => ({ ...r, sentMs: i + 1 })), ...sample(50, 0).map((r, i) => ({ ...r, sentMs: 1000 + i }))];
  assert.equal(evaluateReplyRate(rows).replied, 0, "respostas antigas ficam fora da janela de 50");
  assert.equal(evaluateReplyRate(rows, { sinceMs: 1020 }).evaluated, false, "depois da liberação não há 50 ainda");
});

/* ------------------------------ Freio: sessão ------------------------------ */
test("freio: sessão com needs_attention pausa; reconectada ou outro erro não", () => {
  assert.equal(isSessionNeedsAttention({ status: "error", last_error: "needs_attention:forbidden: 403" }), true);
  assert.equal(isSessionNeedsAttention({ status: "connected", last_error: "needs_attention:forbidden: 403" }), false);
  assert.equal(isSessionNeedsAttention({ status: "error", last_error: "outra coisa" }), false);
  assert.equal(isSessionNeedsAttention(null), false);
  assert.equal(evaluateBrake({ sessionRow: { status: "error", last_error: "needs_attention:x: y" }, consecutiveFailures: 5 }).code, BRAKE_CODE.SESSION, "sessão tem prioridade");
});

/* ------------------------------ Motivo, histórico e alerta ------------------------------ */
test("motivo legível, sem telefone nem código técnico; reconhecível como pausa de freio", () => {
  for (const code of Object.values(BRAKE_CODE)) {
    const text = brakeReasonText(code, { failures: 3, rate: 0.02, total: 50 });
    assert.ok(isBrakePausedReason(text));
    assert.ok(!/\d{10,}|needs_attention|token/i.test(text));
  }
  assert.match(brakeReasonText(BRAKE_CODE.LOW_REPLY, { rate: 0.02, total: 50 }), /2,0%/);
  assert.equal(isBrakePausedReason("Pausado pelo corretor"), false);
});

test("estado do freio: pausa grava histórico, liberação marca o instante e guarda quem liberou; sem pausa nada a liberar", () => {
  const paused = nextBrakeStateOnPause(null, { code: BRAKE_CODE.FAILURES, reason: "r", atIso: "2026-10-06T10:00:00.000Z" });
  assert.equal(paused.status, "paused");
  assert.equal(paused.history.length, 1);
  const released = nextBrakeStateOnRelease(paused, { atIso: "2026-10-06T11:00:00.000Z", byId: "G" });
  assert.equal(released.status, "released");
  assert.equal(released.releasedAt, "2026-10-06T11:00:00.000Z");
  assert.deepEqual(released.history.map((h) => h.event), ["paused", "released"]);
  assert.equal(nextBrakeStateOnRelease(released, { atIso: "x" }), null);
  assert.equal(nextBrakeStateOnRelease(null, { atIso: "x" }), null);
  const again = nextBrakeStateOnPause(released, { code: BRAKE_CODE.LOW_REPLY, reason: "r2", atIso: "2026-10-07T10:00:00.000Z" });
  assert.deepEqual(again.history.map((h) => h.event), ["paused", "released", "paused"]);
  assert.equal(brakeStateKey("abc"), "daily_goal_brake:abc");
});

test("alerta do freio reutiliza a entrega da Central: uma por destinatário, dedupe por pausa, prefixo próprio", () => {
  const definition = { id: "def", enabled: true, kind: "important", title: "WhatsApp precisa de atenção", body_template: "WhatsApp de {corretor}: {estado} ({horario}). {motivo} {acao}" };
  const key = brakeAlertDedupeKey("A", BRAKE_CODE.FAILURES, "2026-10-06T10:00:00.000Z");
  assert.ok(!key.startsWith("wa_attn:"), "não pode ser fechado pela reconexão da sessão");
  const rows = buildAttentionDeliveries({ definition, recipientIds: ["G", "M1", "G"], brokerId: "A", brokerName: "Ana Souza", classification: { state: ATTENTION_STATE.AUTO_BRAKE, reason: BRAKE_CODE.FAILURES }, dedupeKey: key, at: "2026-10-06T10:00:00.000Z" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dedupe_key, key);
  assert.match(rows[0].body, /Ana Souza/);
  assert.match(rows[0].body, /pausados/);
  assert.ok(!/needs_attention|\d{10,}/.test(rows[0].body));
  const text = describeAttention({ classification: { state: ATTENTION_STATE.AUTO_BRAKE, reason: BRAKE_CODE.LOW_REPLY }, brokerName: "Ana", at: NOW });
  assert.match(text, /responderam/);
});

/* ------------------------------ Ligações no código (travas estruturais) ------------------------------ */
test("liberação: endpoint dedicado usa requireBrokerManagementApi; o cron só processa quem está com paused=false", () => {
  const route = readFileSync(new URL("../app/api/admin/daily-goal-auto/brake/route.js", import.meta.url), "utf8");
  assert.match(route, /requireBrokerManagementApi/);
  assert.ok(route.indexOf("requireBrokerManagementApi(request)") < route.indexOf("adminReleaseAutoBrake(auth"));
  const lib = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  assert.match(lib, /\.eq\("enabled", true\)\.eq\("paused", false\)/);
  assert.doesNotMatch(lib, /setDailyGoalAutoPausedByBroker\([^)]*\);?\s*\/\/ chamada/);
  // Excedente de contatos novos é adiado (pending no dia seguinte), nunca cancelado/descartado
  assert.match(lib, /reason === "teto_por_tentativa_politica" \|\| reason === NEW_CONTACT_BLOCK_REASON/);
});
