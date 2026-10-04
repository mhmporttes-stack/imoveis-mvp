import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeDailyAutoCap,
  isScheduleOutsideCurrentConfig,
  sendBlockReason,
  spreadScheduleMinutes
} from "../lib/daily-goal-auto-core.mjs";

// Bug crítico de 2026-10-02 (janela 07:00–14:00 + oscilação): fila nunca pode
// disparar fora da janela, e reagendar/salvar a configuração recalcula a fila
// pendente. Sem envio real — só regras puras e travas no código-fonte.
const W_START = 7 * 60;   // 07:00
const W_END = 14 * 60;    // 14:00
const AT_0210 = 2 * 60 + 10;
const brt = (hhmm, day = "2026-10-02") => new Date(`${day}T${hhmm}:00-03:00`); // sexta-feira
const settings = { enabled: true, paused: false, window_start_minutes: W_START, window_end_minutes: W_END, business_days_only: true };
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

for (const oscillateEnabled of [true, false]) {
  test(`reagendar às 02:10 (janela 07:00–14:00, oscilação ${oscillateEnabled ? "ligada" : "desligada"}) -> nada antes das 07:00`, () => {
    const minutes = spreadScheduleMinutes({ count: 30, windowStartMinutes: W_START, windowEndMinutes: W_END, minGapMinutes: 5, maxGapMinutes: 10, oscillateEnabled, oscillatePercent: 40, nowMinutes: AT_0210, random: seeded(7) });
    assert.ok(minutes.length > 0);
    assert.equal(minutes.filter((value) => Math.round(value) === AT_0210).length, 0, "zero às 02:10");
    assert.ok(minutes[0] >= W_START, "primeira >= 07:00");
    assert.ok(minutes.every((value) => value >= W_START && value <= W_END));
  });
}

test("100 mensagens com oscilação (vários sorteios, até 100%) -> todas dentro da janela, nenhuma perdida", () => {
  for (const seed of [1, 2, 3, 42, 999, 123456]) {
    for (const oscillatePercent of [0, 40, 100]) {
      for (const nowMinutes of [AT_0210, W_START, 10 * 60 + 17]) {
        const minutes = spreadScheduleMinutes({ count: 100, windowStartMinutes: W_START, windowEndMinutes: W_END, oscillateEnabled: true, oscillatePercent, nowMinutes, random: seeded(seed) });
        assert.equal(minutes.length, 100, `seed ${seed} ${oscillatePercent}% ${nowMinutes}`);
        assert.ok(minutes.every((value) => Math.round(value) >= Math.max(W_START, nowMinutes) && Math.round(value) <= W_END), `seed ${seed} ${oscillatePercent}% ${nowMinutes}`);
        for (let i = 1; i < minutes.length; i += 1) assert.ok(minutes[i] >= minutes[i - 1], "ordem crescente");
      }
    }
  }
});

test("100 mensagens sem oscilação -> nenhuma fora da janela (as que não cabem ficam de fora)", () => {
  const minutes = spreadScheduleMinutes({ count: 100, windowStartMinutes: W_START, windowEndMinutes: W_END, minGapMinutes: 20, maxGapMinutes: 40, nowMinutes: AT_0210, random: seeded(5) });
  assert.ok(minutes.every((value) => value >= W_START && value <= W_END));
});

test("baixo volume sem oscilação não é esticado até o fim da janela", () => {
  const minutes = spreadScheduleMinutes({ count: 3, windowStartMinutes: W_START, windowEndMinutes: W_END, minGapMinutes: 20, maxGapMinutes: 40, nowMinutes: AT_0210, random: seeded(9) });
  assert.equal(minutes.length, 3);
  assert.ok(minutes[2] <= W_START + 80, "termina perto do início (2 intervalos de no máx. 40 min)");
});

test("depois do fim da janela, reagendar não agenda nada para hoje", () => {
  assert.deepEqual(spreadScheduleMinutes({ count: 10, windowStartMinutes: W_START, windowEndMinutes: W_END, oscillateEnabled: true, oscillatePercent: 40, nowMinutes: 15 * 60 }), []);
});

test("executor às 02:10 com item marcado 02:10 -> NÃO envia", () => {
  assert.equal(sendBlockReason({ scheduledFor: brt("02:10").toISOString(), now: brt("02:10"), settings }), "fora_da_janela");
});

test("executor dentro da janela com item antigo de 02:10 ou de outro dia -> NÃO envia (fila recalculada)", () => {
  assert.equal(sendBlockReason({ scheduledFor: brt("02:10").toISOString(), now: brt("07:05"), settings }), "agendado_fora_da_configuracao");
  assert.equal(sendBlockReason({ scheduledFor: brt("09:00", "2026-10-01").toISOString(), now: brt("09:30"), settings }), "agendado_fora_da_configuracao");
  assert.equal(sendBlockReason({ scheduledFor: brt("06:30").toISOString(), now: brt("07:00"), settings }), "agendado_fora_da_configuracao");
});

test("depois das 14:00 -> NÃO envia; item agendado depois das 14:00 é inválido", () => {
  assert.equal(sendBlockReason({ scheduledFor: brt("13:50").toISOString(), now: brt("14:01"), settings }), "fora_da_janela");
  assert.equal(isScheduleOutsideCurrentConfig(brt("18:30").toISOString(), { now: brt("10:00"), windowStartMinutes: W_START, windowEndMinutes: W_END }), true);
});

test("item válido dentro da janela -> pode enviar; pausa/desligada/fim de semana bloqueiam", () => {
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12").toISOString(), now: brt("09:15"), settings }), null);
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12").toISOString(), now: brt("09:15"), settings: { ...settings, paused: true } }), "automacao_pausada");
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12").toISOString(), now: brt("09:15"), settings: { ...settings, enabled: false } }), "automacao_desligada");
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12", "2026-10-04").toISOString(), now: brt("09:15", "2026-10-04"), settings }), "fim_de_semana", "domingo");
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12", "2026-10-03").toISOString(), now: brt("09:15", "2026-10-03"), settings }), null, "sabado dispara");
  assert.equal(sendBlockReason({ scheduledFor: brt("09:12").toISOString(), now: brt("09:15"), settings: null }), "automacao_desligada");
});

test("alterar a janela torna inválidos os itens calculados com a janela antiga (06:30–19:00 -> 07:00–14:00)", () => {
  const config = { now: brt("02:15"), windowStartMinutes: W_START, windowEndMinutes: W_END };
  assert.equal(isScheduleOutsideCurrentConfig(brt("06:30").toISOString(), config), true);
  assert.equal(isScheduleOutsideCurrentConfig(brt("18:53").toISOString(), config), true);
  assert.equal(isScheduleOutsideCurrentConfig(brt("10:00").toISOString(), config), false);
});

test("teto: override menor manda; nunca acima de 100", () => {
  assert.equal(computeDailyAutoCap({ totalActivities: 80, dailyCapOverride: 30 }), 30);
  assert.equal(computeDailyAutoCap({ totalActivities: 250 }), 100);
});

// Travas no código-fonte (o servidor não roda em teste unitário).
test("salvar configuração/teto recalcula a fila automaticamente; reagendar só mexe em pendentes", () => {
  const code = source("lib/daily-goal-auto.js");
  const globalConfig = code.slice(code.indexOf("export async function adminUpdateDailyGoalAutoGlobalConfig"), code.indexOf("async function requeueBrokerQueueCore"));
  assert.match(globalConfig, /requeueAllEnabledBrokers\(/, "janela/oscilação/intervalo/dias/teto global");
  const capOverride = code.slice(code.indexOf("export async function adminSetBrokerDailyCapOverride"), code.indexOf("export async function adminSetDailyGoalAutoPaused"));
  assert.match(capOverride, /requeueBrokerQueueCore\(/, "teto individual");
  const requeue = code.slice(code.indexOf("async function requeueBrokerQueueCore"), code.indexOf("async function requeueAllEnabledBrokers"));
  assert.match(requeue, /\.eq\("status", "pending"\)/, "enviados/histórico nunca reagendados");
});

test("trava final relê a configuração antes do envio e roda antes de sendIndividualMessage", () => {
  const code = source("lib/daily-goal-auto.js");
  const guard = code.indexOf("sendBlockReason({ scheduledFor: item.scheduled_for");
  const send = code.indexOf("sendIndividualMessage(brokerId, { to: contactRow.phone_normalized");
  assert.ok(guard > 0 && send > guard, "trava antes do envio");
  assert.match(code.slice(guard - 400, guard), /getSettingsRow\(brokerId\)/, "configuração vigente relida");
  const dispatch = code.slice(code.indexOf("async function dispatchOneForBroker"), code.indexOf("async function processClaimedItem"));
  assert.ok(dispatch.indexOf("repairInvalidPendingQueue") < dispatch.indexOf("isWithinWindow"), "fila inválida é recalculada antes de qualquer envio");
});

test("opt-out/Não contactar/cliente que respondeu nunca voltam para a fila; cron duplicado não envia duas vezes", () => {
  const code = source("lib/daily-goal-auto.js");
  // A busca/filtro de rodadas elegíveis foi extraída para loadEligibleEnqueueRounds (2026-10-04, compartilhada com a política v2).
  const enqueue = code.slice(code.indexOf("async function loadEligibleEnqueueRounds"), code.indexOf("function minutesTodayToIso"));
  assert.match(enqueue, /\.eq\("status", "active"\)/, "rodada convertida (respondeu) ou encerrada (opt-out) não entra");
  assert.match(enqueue, /round\.contact\?\.status !== "do_not_contact"/);
  const claim = source("supabase/migrations/20260929190000_daily_goal_auto_dispatch.sql");
  assert.match(claim, /for update skip locked/, "reivindicação atômica");
  assert.match(claim, /set status = 'sending'/);
});

// ---- Intervalo médio máximo (2026-10-02, ajuste final) ----
const span = (list) => Math.round(list[list.length - 1] - list[0]);
const spread = (count, extra = {}) => spreadScheduleMinutes({ count, windowStartMinutes: W_START, windowEndMinutes: W_END, oscillateEnabled: true, oscillatePercent: 30, maxAverageGapMinutes: 4, nowMinutes: AT_0210, random: seeded(11), ...extra });

test("100 mensagens / janela 07–14 / máx. 4 min / ±30% -> todas dentro da janela", () => {
  for (const seed of [1, 7, 11, 99, 2024]) {
    const minutes = spread(100, { random: seeded(seed) });
    assert.equal(minutes.length, 100);
    assert.ok(minutes.every((value) => Math.round(value) >= W_START && Math.round(value) <= W_END), `seed ${seed}`);
    assert.ok(span(minutes) <= 4 * 99 * 1.31, "média respeita o máximo de 4 min (± oscilação)");
  }
});

test("20 mensagens / máx. 4 min / ±30% -> termina em pouco mais de 1 hora, não às 14:00", () => {
  const minutes = spread(20);
  assert.equal(minutes[0], W_START);
  assert.ok(span(minutes) >= 19 * 4 * 0.7 && span(minutes) <= 19 * 4 * 1.3, `duração ${span(minutes)} min`);
  assert.ok(minutes[minutes.length - 1] < 9 * 60, "termina antes das 09:00");
});

test("5 mensagens -> não espalha durante 7 horas", () => {
  const minutes = spread(5);
  assert.ok(span(minutes) <= 4 * 4 * 1.3, `duração ${span(minutes)} min`);
});

test("sem intervalo médio máximo (vazio) -> comportamento anterior: usa a janela", () => {
  const minutes = spread(5, { maxAverageGapMinutes: null });
  assert.ok(span(minutes) > 4 * 60, "espalha pela janela como antes");
});

test("muito volume: o necessário para caber vence o máximo (intervalo menor)", () => {
  const minutes = spread(100, { maxAverageGapMinutes: 30 });
  assert.equal(minutes.length, 100);
  assert.ok(minutes.every((value) => Math.round(value) <= W_END));
});

test("oscilação desligada continua usando o intervalo mín./máx. (ignora o máximo médio)", () => {
  const minutes = spreadScheduleMinutes({ count: 3, windowStartMinutes: W_START, windowEndMinutes: W_END, minGapMinutes: 20, maxGapMinutes: 20, maxAverageGapMinutes: 4, nowMinutes: AT_0210, random: seeded(3) });
  assert.deepEqual(minutes, [W_START, W_START + 20, W_START + 40]);
});

test("alterar o intervalo médio máximo recalcula só pendentes (salvar configuração -> requeue de pending)", () => {
  const code = source("lib/daily-goal-auto.js");
  const globalConfig = code.slice(code.indexOf("export async function adminUpdateDailyGoalAutoGlobalConfig"), code.indexOf("async function requeueBrokerQueueCore"));
  assert.match(globalConfig, /max_avg_gap_minutes: maxAvgGapMinutes/);
  assert.match(globalConfig, /requeueAllEnabledBrokers\(/);
  assert.match(code, /maxAverageGapMinutes: settingsRow\.max_avg_gap_minutes/);
});

// ---- Itens presos em "enviando" ----
import { decideStuckSendingItem } from "../lib/daily-goal-auto-core.mjs";
const NOW = new Date("2026-10-02T12:00:00Z").getTime();
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const activeRound = { status: "active", attempt_count: 0 };

test("preso em 'enviando': dentro do tempo normal -> espera", () => {
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(5), attempt_number: 1 }, round: activeRound, now: NOW }), "wait");
});

test("preso com prova de envio -> marcado como enviado, sem reenviar", () => {
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1, wa_message_id: "WA1" }, round: activeRound, now: NOW }), "mark_sent");
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1, delivered_at: ago(29) }, round: activeRound, now: NOW }), "mark_sent");
});

test("preso com envio iniciado e sem confirmação -> revisão, NUNCA reenvia", () => {
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1, send_started_at: ago(30) }, round: activeRound, now: NOW }), "review");
});

test("preso antes da marca existir (itens de 30/09) -> revisão, NUNCA reenvia", () => {
  const old = new Date("2026-09-30T15:00:00Z").getTime();
  assert.equal(decideStuckSendingItem({ item: { updated_at: "2026-09-30T15:00:00Z", attempt_number: 1 }, round: activeRound, now: old + 3600000 }), "review");
});

test("preso que provadamente não começou o envio -> volta para a fila só se a tentativa ainda é devida", () => {
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1 }, round: activeRound, now: NOW }), "return_pending");
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1 }, round: activeRound, slotAlreadyAttempted: true, now: NOW }), "skip_obsolete");
  assert.equal(decideStuckSendingItem({ item: { updated_at: ago(30), attempt_number: 1 }, round: { status: "converted", attempt_count: 0 }, now: NOW }), "skip_obsolete");
});

test("marca de início do envio é gravada antes de chamar o WhatsApp; varredura roda no cron", () => {
  const code = source("lib/daily-goal-auto.js");
  const marker = code.indexOf("send_started_at: new Date().toISOString()");
  const send = code.indexOf("sendIndividualMessage(brokerId, { to: contactRow.phone_normalized");
  assert.ok(marker > 0 && marker < send);
  const run = code.slice(code.indexOf("export async function runDailyGoalAutoDispatch"));
  assert.match(run.slice(0, 400), /recoverStuckSendingItems\(\)/);
});
