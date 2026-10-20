import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_PAUSE_MS,
  DAILY_LIMIT,
  MIN_INTERVAL_MS,
  buildResultBody,
  DAILY_ATTEMPT_LIMIT,
  decideTick,
  finishJob,
  initialState,
  isWithinWindow,
  nextIntervalMs,
  recomputeFromHistory,
  retryDelayMs,
  saoPauloParts,
  setManualPause,
  startJob,
  todayAttempts,
  todayCount
} from "../lib/agenda.js";

// 2026-10-20 é terça; São Paulo = UTC-3.
const at = (hhmm) => new Date(`2026-10-20T${hhmm}:00-03:00`);
const listing = { id: "a1", title: "Casa no Centro" };

test("janela 08:00–20:00 no horário de São Paulo", () => {
  assert.equal(isWithinWindow(at("07:59")), false);
  assert.equal(isWithinWindow(at("08:00")), true);
  assert.equal(isWithinWindow(at("19:59")), true);
  assert.equal(isWithinWindow(at("20:00")), false);
  assert.equal(saoPauloParts(new Date("2026-10-21T02:30:00Z")).dateKey, "2026-10-20");
});

test("intervalo entre publicações nunca é menor que 1 h", () => {
  assert.equal(nextIntervalMs(() => 0), MIN_INTERVAL_MS);
  assert.ok(nextIntervalMs(() => 0.999) > MIN_INTERVAL_MS);
  assert.ok(nextIntervalMs(() => 0.999) <= MIN_INTERVAL_MS + 20 * 60000);
});

test("tique: fora do horário, pausa manual, pausa de verificação, em andamento", () => {
  assert.equal(decideTick(initialState(), at("06:00")).reason, "fora_do_horario");
  assert.equal(decideTick(initialState(), at("10:00")).action, "check");
  assert.equal(decideTick(setManualPause(initialState(), true), at("10:00")).reason, "pausado");
  assert.equal(decideTick({ ...initialState(), pausedUntil: at("11:00").toISOString() }, at("10:00")).reason, "pausa_verificacao");
  assert.equal(decideTick({ ...initialState(), pausedUntil: at("09:00").toISOString() }, at("10:00")).action, "check");
  const running = startJob(initialState(), listing, at("10:00"));
  assert.equal(decideTick(running, at("10:05")).reason, "em_andamento");
  // Publicação travada há mais de 20 min (Chrome fechado no meio) não bloqueia para sempre.
  assert.equal(decideTick(running, at("10:30")).action, "check");
});

test("máximo de 3 por dia, zera no dia seguinte", () => {
  let state = initialState();
  let now = at("08:10");
  for (let i = 0; i < DAILY_LIMIT; i += 1) {
    assert.equal(decideTick(state, now).action, "check", `publicação ${i + 1}`);
    state = finishJob(startJob(state, listing, now), { ok: true, url: "u" }, now, () => 0);
    now = new Date(now.getTime() + MIN_INTERVAL_MS + 60000);
  }
  assert.equal(todayCount(state, now), DAILY_LIMIT);
  assert.equal(decideTick(state, now).reason, "limite_diario");
  assert.equal(decideTick(state, new Date("2026-10-21T08:30:00-03:00")).action, "check");
});

test("depois de publicar, espera o intervalo antes da próxima", () => {
  const state = finishJob(startJob(initialState(), listing, at("09:00")), { ok: true }, at("09:05"), () => 0);
  assert.equal(decideTick(state, at("09:45")).reason, "intervalo");
  assert.equal(decideTick(state, at("10:06")).action, "check");
});

test("falha NÃO conta no limite do dia e tenta de novo em 15–20 min (não 1 h)", () => {
  const state = finishJob(startJob(initialState(), listing, at("08:53")), { ok: false, step: "abrir formulário", error: "x" }, at("08:56"), () => 0);
  assert.equal(todayCount(state, at("09:00")), 0);
  assert.equal(todayAttempts(state, at("09:00")), 1);
  assert.equal(decideTick(state, at("09:05")).reason, "intervalo");
  assert.equal(decideTick(state, at("09:12")).action, "check");
  assert.equal(state.history[0].status, "failed");
  assert.ok(retryDelayMs(() => 0) >= 15 * 60000 && retryDelayMs(() => 0.999) <= 20 * 60000);
});

test("freio contra rajada: no máximo 6 tentativas no dia", () => {
  let state = initialState();
  let now = at("08:00");
  for (let i = 0; i < DAILY_ATTEMPT_LIMIT; i += 1) {
    state = finishJob(startJob(state, listing, now), { ok: false, error: "x" }, now, () => 0);
    now = new Date(now.getTime() + 21 * 60000);
  }
  assert.equal(decideTick(state, now).reason, "limite_tentativas");
});

test("atualização da extensão refaz o dia pelo histórico (falha da 1.1.0 deixa de contar)", () => {
  const old = { ...initialState(), daily: { date: "2026-10-20", count: 1 }, nextAllowedAt: at("10:04").toISOString(), history: [{ at: at("08:53").toISOString(), status: "failed" }] };
  const fixed = recomputeFromHistory(old, at("09:10"));
  assert.equal(todayCount(fixed, at("09:10")), 0);
  assert.equal(fixed.nextAllowedAt, null);
  assert.equal(decideTick(fixed, at("09:10")).action, "check");
  const withSuccess = recomputeFromHistory({ ...old, history: [{ at: at("09:00").toISOString(), status: "published" }] }, at("09:10"));
  assert.equal(todayCount(withSuccess, at("09:10")), 1);
  assert.equal(withSuccess.nextAllowedAt, at("10:00").toISOString());
});

test("checkpoint/limite do Facebook pausa por 24 h", () => {
  const state = finishJob(startJob(initialState(), listing, at("09:00")), { ok: false, checkpoint: true, step: "publicar", error: "verificação" }, at("09:01"));
  assert.equal(new Date(state.pausedUntil).getTime(), at("09:01").getTime() + CHECKPOINT_PAUSE_MS);
  assert.equal(decideTick(state, at("15:00")).reason, "pausa_verificacao");
  assert.equal(decideTick(state, new Date("2026-10-21T10:00:00-03:00")).action, "check");
  // "Retomar" no popup tira a pausa (o dono resolveu a verificação no Facebook).
  assert.equal(decideTick(setManualPause(state, false), at("15:00")).action, "check");
});

test("resultado para o CRM: nova tentativa só se nada foi enviado ao Facebook", () => {
  assert.deepEqual(buildResultBody({ ok: true, url: "https://www.facebook.com/marketplace/item/1/" }), { status: "published", url: "https://www.facebook.com/marketplace/item/1/" });
  const before = buildResultBody({ ok: false, clickedPublish: false, step: "campo price", error: "não achei" });
  assert.equal(before.status, "failed");
  assert.equal(before.retry, true);
  assert.match(before.error, /Passo: campo price/);
  assert.equal(buildResultBody({ ok: false, clickedPublish: true, error: "sem confirmação" }).retry, false);
  assert.match(buildResultBody({ ok: false, checkpoint: true, error: "x" }).error, /pausada 24 h/);
});

test("histórico guarda no máximo 30 itens e print só nos 5 mais recentes", () => {
  let state = initialState();
  for (let i = 0; i < 35; i += 1) state = finishJob(startJob(state, { id: String(i), title: `T${i}` }, at("09:00")), { ok: false, error: "x", screenshot: "data:image/jpeg;base64,AA" }, at("09:00"));
  assert.equal(state.history.length, 30);
  assert.equal(state.history.filter((item) => item.screenshot).length, 5);
  assert.equal(state.history[0].title, "T34");
});
