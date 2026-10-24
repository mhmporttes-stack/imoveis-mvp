// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Marketplace, mensagem não entregue (MKT-2e): "se a mensagem não foi
// enviada, você espera 30 segundos e tenta enviar de novo, até ela ser concluída." + "O cliente que a mensagem não foi
// entregue não deve ser transferido e o corretor deve receber um alerta."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_RESEND_MAX_MS,
  ASSIGNMENT_SOURCE,
  SEND_RETRY_INTERVAL_MS,
  UNDELIVERED_LABEL,
  evaluateOutboxGate,
  isUndeliveredRetrying,
  needsVerify,
  outboundStatusView,
  pickOutboxCandidate,
  planStaleSending,
  recentOutboxAttempts,
  resendBlockReason,
  resendStopReason,
  sameOutboundCount,
  shouldRedistribute,
  supportsAutoResend,
  toOutboxPayload
} from "../lib/marketplace-chat-core.mjs";

const now = new Date("2026-10-24T15:00:00Z");
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();

test("reenvio a cada 30 s, 24 h de teto, só a extensão 1.9.6+ confere antes", () => {
  assert.equal(SEND_RETRY_INTERVAL_MS, 30 * 1000);
  assert.equal(AUTO_RESEND_MAX_MS, 24 * 60 * 60 * 1000);
  assert.equal(supportsAutoResend("1.9.6"), true);
  assert.equal(supportsAutoResend("1.10.0"), true);
  assert.equal(supportsAutoResend("1.9.5"), false);
  assert.equal(supportsAutoResend(""), false);
  // Na fila esperando os 30 s: segura a conversa; depois dos 30 s volta a sair.
  const row = { id: "m1", conversation_id: "c1", claimed_at: new Date(now.getTime() - 10_000).toISOString() };
  assert.equal(pickOutboxCandidate([row], { retryBefore: new Date(now.getTime() - SEND_RETRY_INTERVAL_MS).toISOString() }), null);
  assert.equal(pickOutboxCandidate([{ ...row, claimed_at: new Date(now.getTime() - 31_000).toISOString() }], { retryBefore: new Date(now.getTime() - SEND_RETRY_INTERVAL_MS).toISOString() })?.id, "m1");
});

test("envio sem retorno: extensão que confere volta à fila; antiga ou passado o teto = Não enviada", () => {
  const row = { created_at: ago(30) };
  assert.equal(planStaleSending(row, now, { extensionVersion: "1.9.6" }).status, "queued");
  assert.equal(planStaleSending(row, now, { extensionVersion: "1.9.5" }).status, "failed");
  assert.equal(resendStopReason(planStaleSending({ created_at: ago(24 * 60) }, now, { extensionVersion: "1.9.6" }).error), "prazo_24h");
});

test("limite por hora: cada reenvio conta (vale o maior entre enviadas e tentativas)", () => {
  assert.equal(evaluateOutboxGate({ sentLastHour: 2, attemptsLastHour: 20, maxSendsPerHour: 20 }).reason, "limite_por_hora");
  assert.equal(evaluateOutboxGate({ sentLastHour: 20, attemptsLastHour: 0, maxSendsPerHour: 20 }).reason, "limite_por_hora");
  assert.equal(evaluateOutboxGate({ sentLastHour: 5, attemptsLastHour: 19, maxSendsPerHour: 20 }).allowed, true);
  const log = [ago(61), ago(59), ago(1), "lixo"];
  assert.deepEqual(recentOutboxAttempts(log, now), [ago(59), ago(1)]);
  assert.equal(recentOutboxAttempts(log, now, { add: true }).length, 3);
  assert.equal(recentOutboxAttempts(Array.from({ length: 300 }, () => ago(1)), now).length, 200);
});

test("nunca reenvia para Não contactar/telefone bloqueado nem depois de 24 h; o 1º envio (clique do corretor) não passa aqui", () => {
  assert.equal(resendBlockReason({ attempts: 0, created_at: ago(5) }, { doNotContactReason: "cliente_nao_contactar", now }), null);
  assert.equal(resendBlockReason({ attempts: 1, created_at: ago(5) }, { doNotContactReason: "cliente_nao_contactar", now }), "nao_contactar");
  assert.equal(resendBlockReason({ attempts: 1, created_at: ago(5) }, { doNotContactReason: "telefone_nao_contactar", now }), "nao_contactar");
  assert.equal(resendBlockReason({ attempts: 3, created_at: ago(24 * 60) }, { now }), "prazo_24h");
  assert.equal(resendBlockReason({ attempts: 3, created_at: ago(60) }, { now }), null);
});

test("conferência: pedido leva verify + knownSame a partir da 2ª tentativa", () => {
  const conversation = { thread_key: "t", thread_url: "u" };
  assert.equal(needsVerify({ attempts: 1 }), false);
  assert.deepEqual(toOutboxPayload({ id: "m", body: "Oi", attempts: 1 }, conversation, { knownSame: 2 }), { id: "m", threadKey: "t", threadUrl: "u", body: "Oi", attempt: 1 });
  assert.deepEqual(toOutboxPayload({ id: "m", body: "Oi", attempts: 2 }, conversation, { knownSame: 2 }), { id: "m", threadKey: "t", threadUrl: "u", body: "Oi", attempt: 2, verify: true, knownSame: 2 });
  const recent = [
    { id: "a", direction: "outbound", status: "sent", body: "Oi", message_at: ago(10) },
    { id: "b", direction: "outbound", status: "sent", body: " oi ", message_at: ago(9) },
    { id: "c", direction: "outbound", status: "failed", body: "Oi", message_at: ago(8) },
    { id: "m", direction: "outbound", status: "sending", body: "Oi", message_at: ago(1) },
    { id: "d", direction: "outbound", status: "sent", body: "Outra", message_at: ago(7) }
  ];
  assert.equal(sameOutboundCount({ id: "m", body: "Oi" }, recent), 2, "só as já enviadas iguais, sem ela mesma");
});

test("alerta no chat do corretor: Mensagem não entregue — reenviando automaticamente; parada com motivo", () => {
  const base = { direction: "outbound", sender_user_id: "u1" };
  assert.equal(isUndeliveredRetrying({ ...base, status: "queued", attempts: 2, error: "x" }), true);
  assert.equal(isUndeliveredRetrying({ ...base, status: "sending", attempts: 2 }), true);
  assert.equal(isUndeliveredRetrying({ ...base, status: "queued", attempts: 0 }), false, "1º envio na fila não é falha");
  assert.equal(isUndeliveredRetrying({ ...base, status: "sending", attempts: 1 }), false);
  assert.equal(outboundStatusView({ ...base, status: "queued", attempts: 3, error: "x" }).statusLabel, UNDELIVERED_LABEL);
  assert.equal(outboundStatusView({ ...base, status: "failed", error: "[reenvio parado: conversa_bloqueada] x" }).statusLabel, "Não enviada — o Facebook bloqueou ou encerrou esta conversa");
  assert.equal(outboundStatusView({ ...base, status: "failed", error: "[reenvio parado: nao_contactar]" }).statusLabel, "Não enviada — cliente em Não contactar");
  assert.equal(outboundStatusView({ ...base, status: "failed", error: "outra coisa" }).statusLabel, "Não enviada");
  const chat = readFileSync(new URL("../components/marketplace/MarketplaceChat.jsx", import.meta.url), "utf8");
  assert.match(chat, /data-undelivered-notice/);
  assert.match(chat, /message\.undelivered/);
});

test("cliente com mensagem do corretor pendente/em reenvio NÃO é transferido pela roleta (já contava; mantido)", () => {
  const conversation = { assigned_user_id: "u1", assigned_at: ago(30), assignment_source: ASSIGNMENT_SOURCE.ROULETTE };
  const deadlineMs = 10 * 60 * 1000;
  assert.equal(shouldRedistribute(conversation, now, { deadlineMs }), true, "sem resposta: transfere");
  // humanReplySince = created_at da resposta do corretor, em QUALQUER status (na fila, reenviando, falhou).
  assert.equal(shouldRedistribute(conversation, now, { deadlineMs, humanReplySince: ago(25) }), false);
  const source = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const replies = source.slice(source.indexOf("async function humanRepliesByConversation"), source.indexOf("async function redistributeOverdue"));
  assert.doesNotMatch(replies, /\.eq\("status"/, "a consulta não filtra status: pendente/em reenvio também segura o cliente");
});

test("fila do CRM: Não contactar conferido ANTES de reservar o reenvio; tentativa registrada no limite por hora", () => {
  const source = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const claim = source.slice(source.indexOf("export async function claimNextMarketplaceOutbound"), source.indexOf("export async function reportMarketplaceOutboundResult"));
  assert.ok(claim.indexOf("resendBlockReason(") > 0 && claim.indexOf("resendBlockReason(") < claim.indexOf('.update({ status: "sending"'), "trava antes da reserva");
  assert.match(claim, /findDoNotContactInboundBlock|conversationDoNotContactReason/);
  assert.match(claim, /writeSetting\(OUTBOX_ATTEMPTS_ID/);
  assert.match(claim, /planStaleSending\(/);
  const route = readFileSync(new URL("../app/api/marketplace/chat/outbox/[id]/result/route.js", import.meta.url), "utf8");
  assert.match(route, /extensionVersion: request\.headers\.get\("x-extension-version"\)/);
});
