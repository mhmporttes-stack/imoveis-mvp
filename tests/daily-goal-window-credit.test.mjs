import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeDayWindowCredit, effectiveWindowEndMinutes, resolveEffectiveWindow, evaluateDayImpact, safeGapMinutes
} from "../lib/daily-goal-window-core.mjs";
import { decideProspectingGate, gateNeedsGoalStatus } from "../lib/prospecting-eligibility-core.mjs";
import { spreadScheduleMinutes, sendBlockReason } from "../lib/daily-goal-auto-core.mjs";

// CompensaÃ§Ã£o da janela por restriÃ§Ã£o VALIDADA (REGRA OFICIAL â€” dono, 2026-10-02). SÃ³ funÃ§Ãµes puras:
// nenhum cliente, mensagem ou dado real Ã© tocado.
const W_START = 7 * 60;
const W_END = 14 * 60;
const FRI = "2026-10-02"; // sexta
const SAT = "2026-10-03";
const SUN = "2026-10-04";
const at = (hhmm, day = FRI) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
const validated = (from, to, day = FRI, toDay = day) => ({ validation_status: "validated", validated_at: at(from, day), ended_at: to ? at(to, toDay) : null });
const credit = (restrictions, extra = {}) => computeDayWindowCredit({
  date: FRI, restrictions, windowStartMinutes: W_START, windowEndMinutes: W_END, businessDaysOnly: true, nowMs: new Date(at("23:00")).getTime(), ...extra
});
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/* ------------------------------- gate (PRO-11) ------------------------------- */
const gate = (o) => decideProspectingGate({ role: "broker", ...o });
test("conectado: tudo normal, em qualquer tipo de gate", () => {
  for (const kind of ["participate", "access", "daily_goal"]) assert.equal(gate({ kind, sessionStatus: "connected" }).allowed, true);
});
test("simplesmente desconectado: sem ProspecÃ§Ã£o e sem Meta DiÃ¡ria", () => {
  for (const kind of ["participate", "access", "daily_goal"]) assert.equal(gate({ kind, sessionStatus: "disconnected", restriction: null }).allowed, false);
});
test("restriÃ§Ã£o sÃ³ INFORMADA: nenhum benefÃ­cio", () => {
  for (const kind of ["participate", "access", "daily_goal"]) assert.equal(gate({ kind, sessionStatus: "disconnected", restriction: "informed", goalComplete: true }).allowed, false);
});
test("restriÃ§Ã£o VALIDADA: Meta DiÃ¡ria manual liberada; ProspecÃ§Ã£o sÃ³ com 100%", () => {
  assert.equal(gate({ kind: "daily_goal", sessionStatus: "disconnected", restriction: "validated" }).allowed, true);
  for (const kind of ["participate", "access"]) {
    assert.equal(gate({ kind, sessionStatus: "disconnected", restriction: "validated", goalComplete: false }).allowed, false);
    assert.equal(gate({ kind, sessionStatus: "disconnected", restriction: "validated", goalComplete: true }).allowed, true);
  }
});
test("restriÃ§Ã£o VALIDADA nunca libera o automÃ¡tico (strict); a Meta sÃ³ Ã© consultada quando importa", () => {
  for (const kind of ["participate", "access", "daily_goal"]) assert.equal(gate({ kind, sessionStatus: "disconnected", restriction: "validated", goalComplete: true, strict: true }).allowed, false);
  assert.equal(gateNeedsGoalStatus({ kind: "daily_goal", role: "broker", sessionStatus: "disconnected", restriction: "validated" }), false);
  assert.equal(gateNeedsGoalStatus({ kind: "participate", role: "broker", sessionStatus: "disconnected", restriction: "validated" }), true);
  assert.equal(gateNeedsGoalStatus({ kind: "participate", role: "broker", sessionStatus: "connected", restriction: "validated" }), false);
});
test("admin geral segue isento", () => {
  assert.equal(gate({ kind: "participate", isGeneralAdmin: true, sessionStatus: "disconnected" }).allowed, true);
});
test("o dispatcher segue exigindo sessÃ£o conectada e o disparo extra Ã© strict (cÃ³digo-fonte)", () => {
  const auto = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  assert.match(auto, /isSessionOperational\(await getIndividualSessionStatusForUser\(brokerId\)\)\) return \{ brokerId, skipped: "sessao_nao_conectada" \}/);
  assert.match(auto, /channel !== "individual"/);
  const extra = readFileSync(new URL("../lib/prospecting-extra-dispatch.js", import.meta.url), "utf8");
  assert.ok(extra.includes("assertProspectingAccess(auth, { strict: true })") && extra.includes("assertProspectingParticipation(auth, { strict: true })"));
});

/* ------------------------------- crÃ©dito de tempo ------------------------------- */
test("exemplo do dono: fim 14:00 + restriÃ§Ã£o de 2 h dentro da janela -> 16:00 naquele dia", () => {
  const c = credit([validated("10:00", "12:00")]);
  assert.equal(c.creditMinutes, 120);
  assert.equal(effectiveWindowEndMinutes(W_END, c.creditMinutes), 16 * 60);
});
test("teto: a janela efetiva nunca passa de 21:00", () => {
  assert.equal(effectiveWindowEndMinutes(W_END, 600), 21 * 60);
  assert.equal(effectiveWindowEndMinutes(19 * 60, 120), 21 * 60);
  assert.equal(effectiveWindowEndMinutes(21 * 60 + 30, 120), 21 * 60 + 30, "fim base jÃ¡ depois do teto: nada muda");
});
test("uniÃ£o: restriÃ§Ãµes sobrepostas nÃ£o contam duas vezes", () => {
  const c = credit([validated("09:00", "11:00"), validated("10:00", "12:00"), validated("13:00", "13:30")]);
  assert.equal(c.creditMinutes, 180 + 30);
});
test("sÃ³ VALIDADA credita: informada, rejeitada e sem validated_at nÃ£o creditam", () => {
  const informed = { validation_status: "informed", validated_at: null, ended_at: null };
  const rejected = { validation_status: "rejected", validated_at: at("09:00"), ended_at: at("09:00") };
  assert.equal(credit([informed, rejected]).creditMinutes, 0);
});
test("crÃ©dito conta sÃ³ a partir da VALIDAÃ‡ÃƒO (nÃ£o do informe)", () => {
  const row = { validation_status: "validated", reported_at: at("08:00"), validated_at: at("10:00"), ended_at: at("11:00") };
  assert.equal(credit([row]).creditMinutes, 60);
});
test("restriÃ§Ã£o em andamento conta atÃ© agora", () => {
  const c = credit([validated("10:00", null)], { nowMs: new Date(at("10:45")).getTime() });
  assert.equal(c.creditMinutes, 45);
});
test("encerrada manualmente ('RestriÃ§Ã£o resolvida') sÃ³ conta atÃ© o encerramento", () => {
  const c = credit([validated("10:00", "10:20")], { nowMs: new Date(at("18:00")).getTime() });
  assert.equal(c.creditMinutes, 20);
});
test("sÃ³ o tempo dentro da janela base conta (fora dela nÃ£o gera crÃ©dito)", () => {
  assert.equal(credit([validated("05:00", "08:00")]).creditMinutes, 60, "06:00-07:00 fica fora");
  assert.equal(credit([validated("13:00", "17:00")]).creditMinutes, 60, "depois do fim base nÃ£o credita");
  assert.equal(credit([validated("15:00", "17:00")]).creditMinutes, 0);
});
test("restriÃ§Ã£o que atravessa a meia-noite: cada dia sÃ³ recebe a sua parte; nada passa para o dia seguinte", () => {
  const row = validated("13:00", "08:00", FRI, SAT);
  const nowMs = new Date(at("12:00", SAT)).getTime();
  const base = { restrictions: [row], windowStartMinutes: W_START, windowEndMinutes: W_END, businessDaysOnly: false, nowMs };
  assert.equal(computeDayWindowCredit({ ...base, date: FRI }).creditMinutes, 60, "sexta: 13:00-14:00");
  assert.equal(computeDayWindowCredit({ ...base, date: SAT }).creditMinutes, 60, "sÃ¡bado: 07:00-08:00 (janela do prÃ³prio dia)");
});
test("dia nÃ£o Ãºtil (business_days_only) nÃ£o gera crÃ©dito", () => {
  const row = validated("09:00", "11:00", SUN);
  const base = { date: SUN, restrictions: [row], windowStartMinutes: W_START, windowEndMinutes: W_END, nowMs: new Date(at("20:00", SUN)).getTime() };
  assert.equal(computeDayWindowCredit({ ...base, businessDaysOnly: true }).creditMinutes, 0);
  assert.equal(computeDayWindowCredit({ ...base, businessDaysOnly: false }).creditMinutes, 120);
});
test("sem restriÃ§Ã£o: janela efetiva = janela base", () => {
  const r = resolveEffectiveWindow({ date: FRI, restrictions: [], windowStartMinutes: W_START, windowEndMinutes: W_END });
  assert.equal(r.effectiveEndMinutes, W_END);
  assert.equal(r.cadence, null);
});

/* ------------------------- cadÃªncia congelada / trava de envio ------------------------- */
test("cadÃªncia: com a pausa o intervalo mÃ©dio Ã© IDÃŠNTICO ao do mesmo dia sem restriÃ§Ã£o (congelado)", () => {
  const count = 30;
  const resolved = resolveEffectiveWindow({ date: FRI, restrictions: [validated("10:00", "12:00")], windowStartMinutes: W_START, windowEndMinutes: W_END, nowMs: new Date(at("12:00")).getTime() });
  const sem = spreadScheduleMinutes({ count, windowStartMinutes: W_START, windowEndMinutes: W_END, oscillateEnabled: true, oscillatePercent: 0, nowMinutes: 10 * 60, random: seeded(3) });
  const com = spreadScheduleMinutes({
    count, windowStartMinutes: W_START, windowEndMinutes: resolved.effectiveEndMinutes, oscillateEnabled: true, oscillatePercent: 0,
    cadenceCursorMinutes: resolved.cadence.cursorMinutes, cadenceWindowEndMinutes: resolved.cadence.endMinutes, nowMinutes: 12 * 60, random: seeded(3)
  });
  const gap = (list) => (list[list.length - 1] - list[0]) / (list.length - 1);
  assert.ok(Math.abs(gap(sem) - gap(com)) < 1e-9, `gap sem=${gap(sem)} com=${gap(com)}`);
  assert.ok(com[0] >= 12 * 60 && com.every((m) => m <= resolved.effectiveEndMinutes), "recomeÃ§a Ã s 12:00 e termina atÃ© o fim efetivo");
});
test("sem a referÃªncia congelada, estender a janela mudaria o ritmo (a referÃªncia existe para evitar isso)", () => {
  const args = { count: 30, windowStartMinutes: W_START, oscillateEnabled: true, oscillatePercent: 0, nowMinutes: 12 * 60, random: seeded(3) };
  const estendida = spreadScheduleMinutes({ ...args, windowEndMinutes: 16 * 60 });
  const base = spreadScheduleMinutes({ ...args, windowEndMinutes: 14 * 60 });
  assert.notEqual(Math.round(estendida[1] - estendida[0]), Math.round(base[1] - base[0]));
});
test("trava final aceita envio na parte compensada e continua negando fora do fim efetivo", () => {
  const eff = { enabled: true, paused: false, window_start_minutes: W_START, window_end_minutes: 16 * 60, business_days_only: true };
  assert.equal(sendBlockReason({ scheduledFor: at("15:00"), now: new Date(at("15:00")), settings: eff }), null);
  assert.equal(sendBlockReason({ scheduledFor: at("15:00"), now: new Date(at("16:30")), settings: eff }), "fora_da_janela");
  const base = { ...eff, window_end_minutes: W_END };
  assert.equal(sendBlockReason({ scheduledFor: at("15:00"), now: new Date(at("15:00")), settings: base }), "fora_da_janela");
});

/* ---------------------------- impossibilidade / impacto ---------------------------- */
const impact = (restrictions, remaining, extra = {}) => {
  const c = credit(restrictions);
  return evaluateDayImpact({ goalMet: false, remaining, windowStartMinutes: W_START, baseEndMinutes: W_END, credit: c, safeGapMin: 10, ...extra });
};
test("impossÃ­vel mesmo com a extensÃ£o -> dia impactado (com os minutos perdidos)", () => {
  // restriÃ§Ã£o 12:00-14:00 (120 min perdidos) -> fim efetivo 16:00; sobram 120 min => 13 envios com gap 10
  assert.deepEqual(impact([validated("12:00", "14:00")], 50), { impacted: true, impactMinutes: 120 });
});
test("possÃ­vel com a cadÃªncia segura -> NÃƒO Ã© impactado (penalidade vale)", () => {
  assert.equal(impact([validated("10:00", "11:00")], 5).impacted, false);
});
test("restriÃ§Ã£o ainda em andamento no fechamento (sem tempo Ãºtil depois) -> impactado", () => {
  const c = computeDayWindowCredit({ date: FRI, restrictions: [validated("10:00", null)], windowStartMinutes: W_START, windowEndMinutes: W_END, businessDaysOnly: true, nowMs: new Date(at("23:59")).getTime() });
  assert.equal(evaluateDayImpact({ goalMet: false, remaining: 3, windowStartMinutes: W_START, baseEndMinutes: W_END, credit: c, safeGapMin: 10 }).impacted, true);
});
test("meta cumprida, nada faltando ou sem crÃ©dito -> nunca impactado", () => {
  assert.equal(evaluateDayImpact({ goalMet: true, remaining: 10, windowStartMinutes: W_START, baseEndMinutes: W_END, credit: credit([validated("10:00", "12:00")]), safeGapMin: 10 }).impacted, false);
  assert.equal(impact([validated("10:00", "12:00")], 0).impacted, false);
  assert.equal(impact([], 99).impacted, false);
  assert.equal(impact([{ validation_status: "informed", validated_at: null, ended_at: null }], 99).impacted, false);
});
test("intervalo seguro vem do mÃ­nimo configurado (nunca menos de 1 min)", () => {
  assert.equal(safeGapMinutes({ min_gap_minutes: 20 }), 20);
  assert.equal(safeGapMinutes({}), 1);
});

/* ------------------------------- ligaÃ§Ãµes no cÃ³digo ------------------------------- */
test("penalidade ignora dia impactado; fechamento grava a marca sÃ³ quando impactado (idempotente pelo closed_at)", () => {
  const perf = readFileSync(new URL("../lib/performance-overview.js", import.meta.url), "utf8");
  assert.match(perf, /goal\.goal_met \|\| goal\.impacted_by_restriction\) continue/);
  const goal = readFileSync(new URL("../lib/daily-goal.js", import.meta.url), "utf8");
  assert.match(goal, /impact\.impacted \? \{ impacted_by_restriction: true, impact_minutes: impact\.impactMinutes \}/);
  assert.match(goal, /\.is\("closed_at", null\)/);
});
test("os pontos de uso da janela efetiva Ãºnica (envio, reparo, trava final, agendamento)", () => {
  const auto = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  assert.ok((auto.match(/withEffectiveWindow\(/g) || []).length >= 5);
  assert.match(auto, /async function repairInvalidPendingQueue\(brokerId, rawSettingsRow/);
  assert.match(auto, /async function dispatchOneForBroker\(brokerId, brokerName, rawSettingsRow\)/);
  assert.match(auto, /currentSettings = await withEffectiveWindow\(await getSettingsRow\(brokerId\)\)/);
  assert.match(auto, /cadenceCursorMinutes: settingsRow\.window_cadence/);
});

