import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attendanceReferenceAt, marketplaceReplyTimes } from "../lib/client-attendance-core.mjs";
import { evaluateDailyGoalPending } from "../lib/daily-goal-progress.mjs";

// [REGRA OFICIAL — dono, 2026-10-22, MKT-2h] Saída do Marketplace (inclusive escrita fora do CRM) conta no relógio de
// 3 dias: depois do assigned_at da conversa e respondendo a uma mensagem do cliente. Só leitura; a baixa do dia não muda.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const conversation = { assigned_at: "2026-10-22T12:00:00.000Z" };
const inbound = (at) => ({ direction: "inbound", status: "received", message_at: at, created_at: at });
const outbound = (at, status = "sent") => ({ direction: "outbound", status, message_at: at, created_at: at });

test("conta: saída depois da entrega respondendo ao cliente (mesmo com a mensagem dele antes da entrega)", () => {
  const messages = [inbound("2026-10-22T11:50:00.000Z"), outbound("2026-10-22T12:10:00.000Z"), inbound("2026-10-22T13:00:00.000Z"), outbound("2026-10-22T13:05:00.000Z")];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), ["2026-10-22T12:10:00.000Z", "2026-10-22T13:05:00.000Z"]);
  // Ordem de chegada não importa: ordena pelo horário.
  assert.deepEqual(marketplaceReplyTimes(conversation, [...messages].reverse()), ["2026-10-22T12:10:00.000Z", "2026-10-22T13:05:00.000Z"]);
});

test("não conta antes do assigned_at (nem sem entrega)", () => {
  const messages = [inbound("2026-10-22T11:00:00.000Z"), outbound("2026-10-22T11:30:00.000Z")];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), []);
  assert.deepEqual(marketplaceReplyTimes({ assigned_at: null }, [inbound("2026-10-22T13:00:00.000Z"), outbound("2026-10-22T13:05:00.000Z")]), []);
  // A saída antes da entrega consumiu a mensagem do cliente: a seguinte, sem mensagem nova dele, também não conta.
  assert.deepEqual(marketplaceReplyTimes(conversation, [...messages, outbound("2026-10-22T12:30:00.000Z")]), []);
});

test("não conta saída seguida sem mensagem do cliente no meio", () => {
  const messages = [inbound("2026-10-22T12:30:00.000Z"), outbound("2026-10-22T12:40:00.000Z"), outbound("2026-10-23T12:40:00.000Z"), outbound("2026-10-24T12:40:00.000Z")];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), ["2026-10-22T12:40:00.000Z"]);
  assert.deepEqual(marketplaceReplyTimes(conversation, [outbound("2026-10-22T12:40:00.000Z")]), []);
});

test("só saída efetivamente enviada (fila, envio em andamento ou falha não contam nem consomem a mensagem do cliente)", () => {
  const messages = [inbound("2026-10-22T12:30:00.000Z"), outbound("2026-10-22T12:31:00.000Z", "failed"), outbound("2026-10-22T12:32:00.000Z", "queued"), outbound("2026-10-22T12:35:00.000Z")];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), ["2026-10-22T12:35:00.000Z"]);
});

test("o sinal entra no relógio dos 3 dias (maior entre contato gravado/cadastro e último atendimento)", () => {
  const reference = attendanceReferenceAt({ lastWhatsappContactAt: null, createdAt: "2026-10-21T22:59:00.000Z", lastAttendanceAt: "2026-10-22T12:40:00.000Z" });
  assert.equal(reference, Date.parse("2026-10-22T12:40:00.000Z"));
});

test("baixa da pendência do dia inalterada: o último atendimento não resolve a pendência", () => {
  const dayStart = Date.parse("2026-10-22T03:00:00.000Z");
  const client = { responsibleUserId: "b1", status: "in_service", lastWhatsappContactAt: "2026-10-15T12:00:00.000Z", lastAttendanceAt: "2026-10-22T12:40:00.000Z" };
  const result = evaluateDailyGoalPending({ brokerId: "b1", frozenIds: ["c"], clientsById: new Map([["c", client]]), dayStartMs: dayStart, nowMs: dayStart + 12 * 3600_000 });
  assert.deepEqual(result, { total: 1, done: 0, remaining: 1, remainingIds: ["c"] });
  // A baixa carrega só a mudança de etapa por pessoa (loadClientsByIds), nunca loadRecentAttendanceByClient.
  const source = read("lib/daily-goal-pending.js");
  const loadClients = source.slice(source.indexOf("async function loadClientsByIds"), source.indexOf("async function readFreeze"));
  assert.ok(loadClients.includes("loadPersonStatusChangeByClient"));
  assert.ok(!loadClients.includes("loadRecentAttendanceByClient"));
  const progress = read("lib/daily-goal-progress.mjs");
  const evaluateBody = progress.slice(progress.indexOf("export function evaluateDailyGoalPending"), progress.indexOf("export function walletDayTarget"));
  assert.ok(evaluateBody.length > 0 && !evaluateBody.includes("lastAttendanceAt"));
});

test("servidor: fonte 8 do último atendimento lê só marketplace_messages e não grava nada", () => {
  const source = read("lib/client-attendance.js");
  assert.match(source, /loadMarketplaceReplies\(db, \{ sinceIso, untilIso, ids \}\)/);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(source));
});
