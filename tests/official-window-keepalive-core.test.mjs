// Rotina das 08:00 (dono, 2026-11-10) e alerta pelo Oficial: elegibilidade, idempotência, janela de 24 h.
import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEPALIVE_MAX_GAP_MS, KEEPALIVE_MIN_GAP_MS, KEEPALIVE_TEXT, isKeepaliveMessage, isKeepaliveTime, keepaliveKey, keepaliveSkipReason, planKeepaliveRun, randomGapMs, saoPauloDay
} from "../lib/official-window-keepalive-core.mjs";
import { buildTransferAlertText, decideAlertChannel, formatPhoneForAlert, isRecipientWindowOpen } from "../lib/official-alert-core.mjs";

const at = (hhmm) => new Date(`2026-11-10T${hhmm}:00-03:00`);
const candidate = (id, extra = {}) => ({ userId: id, user: { status: "active" }, sessionStatus: "connected", claimedToday: false, userPhones: [], ...extra });

test("horário da rotina: 08:00 a 11:59 em São Paulo", () => {
  assert.equal(isKeepaliveTime(at("07:59")), false);
  assert.equal(isKeepaliveTime(at("08:00")), true);
  assert.equal(isKeepaliveTime(at("11:59")), true);
  assert.equal(isKeepaliveTime(at("12:00")), false);
  assert.equal(saoPauloDay(new Date("2026-11-10T02:00:00Z")), "2026-11-09"); // 23h de Brasília ainda é o dia anterior
});

test("elegibilidade: ativo, conectado, sem envio hoje", () => {
  assert.equal(keepaliveSkipReason(candidate("a")), null);
  assert.equal(keepaliveSkipReason(candidate("a", { user: { status: "inactive" } })), "inativo");
  assert.equal(keepaliveSkipReason(candidate("a", { user: null })), "inativo");
  for (const sessionStatus of ["disconnected", "reconnecting", "error", "", "stored"]) {
    assert.equal(keepaliveSkipReason(candidate("a", { sessionStatus })), "whatsapp_nao_conectado"); // nunca envia com sessão não conectada
  }
  assert.equal(keepaliveSkipReason(candidate("a", { claimedToday: true })), "ja_enviado_hoje");
  assert.equal(keepaliveSkipReason(candidate("a", { userPhones: ["+55 (14) 99105-6706"] }), ), null);
  assert.equal(keepaliveSkipReason({ ...candidate("a", { userPhones: ["+55 (14) 99105-6706"] }), officialDigits: "5514991056706" }), "numero_e_o_oficial");
});

test("plano da rodada: idempotente por dia, limite por rodada e intervalo aleatório", () => {
  const candidates = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => candidate(id));
  candidates[1] = candidate("b", { claimedToday: true });
  candidates[2] = candidate("c", { sessionStatus: "disconnected" });
  const plan = planKeepaliveRun({ candidates, now: at("08:02"), max: 3, rng: () => 0.5 });
  assert.deepEqual(plan.send.map((item) => item.userId), ["a", "d", "e"]); // o resto fica para a próxima rodada
  assert.equal(plan.send[0].delayMs, 0);
  for (const item of plan.send.slice(1)) assert.ok(item.delayMs >= KEEPALIVE_MIN_GAP_MS && item.delayMs <= KEEPALIVE_MAX_GAP_MS);
  assert.deepEqual(plan.skipped.map((item) => item.reason), ["ja_enviado_hoje", "whatsapp_nao_conectado"]);
  assert.equal(planKeepaliveRun({ candidates, now: at("07:30") }).reason, "fora_do_horario");
  assert.deepEqual(planKeepaliveRun({ candidates, now: at("13:00") }).send, []);
  assert.equal(randomGapMs(() => 0), KEEPALIVE_MIN_GAP_MS);
  assert.equal(randomGapMs(() => 1), KEEPALIVE_MAX_GAP_MS);
});

test("chave do dia por corretor", () => {
  assert.equal(keepaliveKey("2026-11-10", "u1"), "official_keepalive:2026-11-10:u1");
});

test("mensagem da rotina é reconhecida (webhook tira de toda automação quando vem da equipe)", () => {
  assert.equal(isKeepaliveMessage(KEEPALIVE_TEXT), true);
  assert.equal(isKeepaliveMessage("bom dia, ja estou disponivel para atender!"), true);
  assert.equal(isKeepaliveMessage("Bom dia, quero informações"), false);
  assert.equal(isKeepaliveMessage(""), false);
});

test("alerta pelo Oficial: janela de 24 h do corretor aberta = Oficial; senão push", () => {
  const now = new Date("2026-11-10T15:00:00Z").getTime();
  assert.equal(isRecipientWindowOpen("2026-11-10T11:05:00Z", now), true);
  assert.equal(isRecipientWindowOpen("2026-11-09T14:00:00Z", now), false);
  assert.equal(isRecipientWindowOpen("2026-11-09T15:02:00Z", now), false); // margem de segurança de 5 min
  assert.equal(isRecipientWindowOpen(null, now), false);
  assert.deepEqual(decideAlertChannel({ hasPhone: true, windowOpen: true }), { channel: "official", reason: "janela_aberta" });
  assert.equal(decideAlertChannel({ hasPhone: true, windowOpen: false }).channel, "push");
  assert.equal(decideAlertChannel({ hasPhone: false, windowOpen: true }).reason, "sem_telefone");
  assert.equal(decideAlertChannel({ hasPhone: true, windowOpen: true, officialConfigured: false }).reason, "oficial_sem_credencial");
});

test("texto do aviso ao corretor: cliente, telefone, etapa e link do card", () => {
  assert.equal(formatPhoneForAlert("5514999998888"), "(14) 99999-8888");
  const text = buildTransferAlertText({ clientName: "Ana Souza", phone: "5514999998888", stepLabel: "Viu a localização", reasonLabel: "escreveu uma mensagem", cardUrl: "https://x/admin/simulacoes?query=MM-1" });
  assert.match(text, /Cliente: Ana Souza/);
  assert.match(text, /Telefone: \(14\) 99999-8888/);
  assert.match(text, /Parou em: Viu a localização/);
  assert.match(text, /Card: https:\/\/x\/admin\/simulacoes/);
  assert.match(buildTransferAlertText({}), /Cliente: Cliente WhatsApp/);
});

import { KEEPALIVE_RESEND_TEXT, KEEPALIVE_STATES, decideKeepaliveVerify } from "../lib/official-window-keepalive-core.mjs";

test("conferência do bom dia: confirma, reenvia 👋 até 2 vezes e depois falha", () => {
  const row = (extra = {}) => ({ state: KEEPALIVE_STATES.sent, sentAt: at("08:00").toISOString(), lastAttemptAt: at("08:00").toISOString(), resendCount: 0, ...extra });
  assert.deepEqual(decideKeepaliveVerify({ row: row(), confirmed: true, now: at("08:03") }), { action: "confirm" });
  assert.deepEqual(decideKeepaliveVerify({ row: row(), confirmed: false, now: at("08:05") }), { action: "none" }); // cedo demais
  assert.deepEqual(decideKeepaliveVerify({ row: row(), confirmed: false, now: at("08:10") }), { action: "resend" });
  assert.deepEqual(decideKeepaliveVerify({ row: row({ state: "resent", resendCount: 1, lastAttemptAt: at("08:10").toISOString() }), now: at("08:20") }), { action: "resend" });
  assert.deepEqual(decideKeepaliveVerify({ row: row({ state: "resent", resendCount: 2, lastAttemptAt: at("08:20").toISOString() }), now: at("08:30") }), { action: "fail" });
  assert.deepEqual(decideKeepaliveVerify({ row: row({ state: "confirmed" }), now: at("09:00") }), { action: "none" });
  assert.deepEqual(decideKeepaliveVerify({ row: row({ state: "failed" }), now: at("09:00") }), { action: "none" });
  assert.deepEqual(decideKeepaliveVerify({ row: null }), { action: "none" });
  assert.equal(KEEPALIVE_RESEND_TEXT, "👋");
});

test("reenvio simples (oi / 👋) também é reconhecido como mensagem da rotina", () => {
  assert.equal(isKeepaliveMessage("👋"), true);
  assert.equal(isKeepaliveMessage("Oi"), true);
  assert.equal(isKeepaliveMessage("oi, tudo bem? quero comprar"), false);
});
