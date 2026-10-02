import test from "node:test";
import assert from "node:assert/strict";
import { buildCompensationNotice, formatCredit, formatClock, RESTRICTED_MANUAL_MESSAGE, IMPACTED_MESSAGE } from "../lib/daily-goal-compensation-view-core.mjs";

const base = { baseStartMinutes: 390, baseEndMinutes: 1140 };
const texts = (n) => n.items.map((i) => i.text);

test("formatos de tempo", () => {
  assert.equal(formatClock(1260), "21:00");
  assert.equal(formatCredit(120), "2h");
  assert.equal(formatCredit(90), "1h30");
  assert.equal(formatCredit(45), "45 min");
});

test("conectado normal, desconectado e informada: nada novo", () => {
  assert.equal(buildCompensationNotice({ ...base, sessionConnected: true }), null);
  assert.equal(buildCompensationNotice({ ...base, sessionConnected: false, restrictionStatus: null }), null);
  assert.equal(buildCompensationNotice({ ...base, sessionConnected: false, restrictionStatus: "informed", goalComplete: true }), null);
});

test("validada sem compensação: modo manual, sem prazo estendido", () => {
  const n = buildCompensationNotice({ ...base, restrictionStatus: "validated", creditMinutes: 0, effectiveEndMinutes: 1140 });
  assert.equal(n.restrictedManual, true);
  assert.equal(n.extended, null);
  assert.ok(texts(n).includes(RESTRICTED_MANUAL_MESSAGE));
  assert.ok(!texts(n).some((t) => t.includes("Prazo estendido")));
  assert.ok(!texts(n).includes("Prospecção manual liberada"));
});

test("validada com compensação: +2h e até 21:00", () => {
  const n = buildCompensationNotice({ ...base, restrictionStatus: "validated", creditMinutes: 120, effectiveEndMinutes: 1260 });
  assert.ok(texts(n).includes("+2h por restrição validada"));
  assert.ok(texts(n).includes("Prazo estendido até 21:00"));
  assert.ok(texts(n).includes("Horário normal: 06:30 às 19:00"));
});

test("crédito já gerado e restrição encerrada: mostra compensação, sem aviso de modo manual", () => {
  const n = buildCompensationNotice({ ...base, sessionConnected: true, restrictionStatus: null, creditMinutes: 60, effectiveEndMinutes: 1200 });
  assert.equal(n.restrictedManual, false);
  assert.ok(texts(n).includes("Prazo estendido até 20:00"));
});

test("teto 21:00 sem ganho de prazo: só o crédito, sem 'prazo estendido'", () => {
  const n = buildCompensationNotice({ baseStartMinutes: 390, baseEndMinutes: 1260, restrictionStatus: "validated", creditMinutes: 60, effectiveEndMinutes: 1260 });
  assert.equal(n.extended, null);
});

test("dia impactado: sem penalidade", () => {
  const n = buildCompensationNotice({ ...base, restrictionStatus: "validated", creditMinutes: 120, effectiveEndMinutes: 1260, impacted: true });
  assert.equal(n.impacted, true);
  assert.ok(texts(n).includes(IMPACTED_MESSAGE));
  assert.match(IMPACTED_MESSAGE, /Sem penalidade/);
});

test("100% da Meta com restrição validada: Prospecção manual liberada", () => {
  const n = buildCompensationNotice({ ...base, restrictionStatus: "validated", goalComplete: true });
  assert.equal(n.manualProspecting, true);
  assert.ok(texts(n).includes("Prospecção manual liberada"));
});

test("100% da Meta conectado normal: não mostra nada", () => {
  assert.equal(buildCompensationNotice({ ...base, sessionConnected: true, goalComplete: true }), null);
});
