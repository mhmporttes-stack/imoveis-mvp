import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as policyCore from "../lib/daily-goal-policy-core.mjs";
import {
  DAILY_CAP, CAP_BY_ATTEMPT, WINDOW_START_MINUTES, WINDOW_END_MINUTES, MIN_GAP_SECONDS, DEFAULT_OSCILLATE_PERCENT, PAUSES_OFF_FROM_AVERAGE_GAP_MINUTES,
  PAUSE_EVERY_MIN, PAUSE_EVERY_MAX, PAUSE_MIN_MINUTES, PAUSE_MAX_MINUTES, RECONNECT_SETTLE_MINUTES, v2OscillatePercent, dayAverageGapMinutes,
  reconnectReadyAtMs, slotsPastReconnectWait, brokerReconnectReferenceMs, reconnectHoldUntilMs, formatReconnectHoldLine,
  isPolicyV2Enabled, applyPolicyV2, planV2Trim, TRIM_SKIP_REASON, effectiveGapSeconds, dailyCapFor, planV2Schedule, sendsSinceLastPause,
  summarizeV2Usage, v2SendBlockReason, findStaleV2Items, rescheduleV2Items, v2EnqueueAllowance,
  pickV2EnqueueCandidates, nextSendingDate, saoPauloInstantMs, extraGapSecondsV2
} from "../lib/daily-goal-policy-core.mjs";
import { V2_AUTO_MESSAGES, pickV2Variant, v2VariantLength } from "../lib/daily-goal-policy-messages.mjs";
import { renderAutoMessage, hasUnresolvedVariable, isOptOutMessage, saoPauloDateMinutes, sendBlockReason } from "../lib/daily-goal-auto-core.mjs";
import { isClearOptOut } from "../lib/prospecting-reply-core.mjs";
import { extraSendBlockReason } from "../lib/prospecting-extra-core.mjs";

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60 * 1000;
const at = (iso) => Date.parse(iso);
// 2026-10-05 é segunda-feira; 2026-10-03 sábado; 2026-10-04 domingo.
const MONDAY = "2026-10-05";
const settingsBase = { enabled: true, paused: false, window_start_minutes: 390, window_end_minutes: 1140, min_gap_minutes: 5, max_gap_minutes: 10, oscillate_enabled: true, business_days_only: true };
const v2 = (extra = {}) => applyPolicyV2({ ...settingsBase, policy_v2_enabled: true, ...extra });
// A janela e o intervalo gravados no banco (aqui 06:30–15:30, 0–0) não prevalecem: a v2 usa sempre as constantes (06:30–18:00).
const wide = (extra = {}) => applyPolicyV2({ ...settingsBase, window_start_minutes: 390, window_end_minutes: 930, min_gap_minutes: 0, max_gap_minutes: 0, ...extra });
// Com as pausas programadas LIGADAS (só acontecem quando o intervalo médio do dia é menor que 15 min): força o interruptor.
const paused = (extra = {}) => ({ ...wide(extra), policy_no_pauses: false });
const emptyUsage = () => summarizeV2Usage([]);

test("constantes da política v2 (REGRA OFICIAL 2026-10-04; janela e intervalo: dono, 2026-10-13)", () => {
  assert.equal(DAILY_CAP, 30);
  assert.deepEqual({ ...CAP_BY_ATTEMPT }, { 1: 10, 2: 10, 3: 0 }, "3ª tentativa removida (dono, 2026-10-16): teto 0");
  assert.equal(WINDOW_START_MINUTES, 6 * 60 + 30);
  assert.equal(WINDOW_END_MINUTES, 18 * 60, "janela até 18:00 (era 15:30)");
  assert.equal(MIN_GAP_SECONDS, 300, "mínimo 5 min (inegociável)");
  assert.equal("MAX_GAP_SECONDS" in policyCore, false, "o 'máximo de 8 min' deixou de ser regra");
  assert.equal(DEFAULT_OSCILLATE_PERCENT, 40);
  assert.equal(PAUSES_OFF_FROM_AVERAGE_GAP_MINUTES, 15);
  assert.equal(PAUSE_EVERY_MIN, 8);
  assert.equal(PAUSE_EVERY_MAX, 12);
  assert.equal(PAUSE_MIN_MINUTES, 15);
  assert.equal(PAUSE_MAX_MINUTES, 30);
  assert.equal(RECONNECT_SETTLE_MINUTES, 30, "espera de 30 min depois de (re)conexão que exige cautela (dono, 2026-10-16; era 2 h desde 2026-10-13, antes 5 min)");
});

test("v2 VIGENTE por padrão: coluna ausente/NULL = ligada; só false explícito desliga; sem linha de configuração não regula", () => {
  assert.equal(isPolicyV2Enabled(null), false, "corretor sem configuração: nada a regular");
  assert.equal(isPolicyV2Enabled({}), true, "coluna ausente (migration não aplicada) = v2 vigente");
  assert.equal(isPolicyV2Enabled({ policy_v2_enabled: null }), true, "NULL = vigente");
  assert.equal(isPolicyV2Enabled({ policy_v2_enabled: true }), true);
  assert.equal(isPolicyV2Enabled({ policy_v2_enabled: false }), false, "opt-out explícito respeitado");
});

test("v2: o código usa a política nova por padrão e mantém o opt-out; a ativação não liga automação de ninguém", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /isPolicyV2Enabled\(rawSettingsRow\)\) return enqueueTodayItemsV2/);
  assert.match(code, /const policyV2 = isPolicyV2Enabled\(rawSettingsRow\);/);
  assert.match(code, /if \(!policyV2\) \{\s*\n\s*const repaired = await repairInvalidPendingQueue/, "política antiga (opt-out) mantém o recálculo da fila");
  assert.match(code, /policyV2Enabled: policyV2/);
  assert.match(code, /if \(!\("policy_v2_enabled" in current\)\) throw/, "sem a migration o interruptor dá erro claro, nunca finge");
  const activationRaw = readFileSync("supabase/migrations/20261004150000_daily_goal_policy_v2_activation.sql", "utf8");
  const activation = activationRaw.replace(/--.*$/gm, "").replace(/comment on [\s\S]*?';/gi, "").replace(/on delete cascade/gi, "");
  assert.match(activation, /add column if not exists policy_v2_enabled boolean not null default true/);
  assert.match(activation, /alter column policy_v2_enabled set default true/);
  assert.match(activation, /create table if not exists public\.daily_goal_policy_trim_log/);
  assert.doesNotMatch(activation, /\b(drop|delete|truncate)\b/i);
  assert.doesNotMatch(activation, /set\s+enabled\s*=/i, "nunca liga a automação de ninguém");
  assert.doesNotMatch(activation, /(simulation_registrations|client_status_history|whatsapp_messages|daily_goal_auto_queue)/, "migration não toca clientes, histórico, mensagens nem a fila");
});

test("janela: v2 usa SEMPRE 06:30–18:00; os valores antigos do banco (07–14, 06:30–15:30) não prevalecem", () => {
  for (const extra of [{}, { window_start_minutes: 420, window_end_minutes: 840 }, { window_start_minutes: 300, window_end_minutes: 1260 }, { window_end_minutes: 930 }]) {
    const r = v2(extra);
    assert.deepEqual([r.window_start_minutes, r.window_end_minutes], [390, 1080]);
    assert.deepEqual([r.min_gap_minutes, r.max_gap_minutes], [5, null], "só o mínimo de 5 min é regra; não há máximo");
  }
  assert.equal(v2().oscillate_enabled, true, "intervalo = média automática ± oscilação (espalhado ao longo da janela)");
  assert.equal(v2({ oscillate_enabled: false }).oscillate_enabled, true, "o banco desligado não prevalece na v2");
  assert.equal(v2({ max_avg_gap_minutes: 10 }).max_avg_gap_minutes, null, "sem o teto 'média máx. 10 min' na v2");
  assert.equal(v2({ business_days_only: false }).business_days_only, true, "domingo sempre bloqueado na v2");
});

test("oscilação na v2: percentual do corretor (padrão 40 quando ausente)", () => {
  assert.equal(v2OscillatePercent({}), 40);
  assert.equal(v2OscillatePercent(null), 40);
  assert.equal(v2OscillatePercent({ oscillate_percent: null }), 40);
  assert.equal(v2OscillatePercent({ oscillate_percent: "" }), 40);
  assert.equal(v2OscillatePercent({ oscillate_percent: 40 }), 40);
  assert.equal(v2OscillatePercent({ oscillate_percent: 25 }), 25, "usa o valor do banco do corretor");
  assert.equal(v2OscillatePercent({ oscillate_percent: 250 }), 100);
  assert.equal(v2({ oscillate_percent: 25 }).oscillate_percent, 25);
  assert.equal(v2().oscillate_percent, 40);
});

test("janela 06:30–18:00 seg–sáb: domingo e fora de horário não tentam (fuso São Paulo)", () => {
  const s = wide();
  const reason = (iso) => sendBlockReason({ scheduledFor: iso, now: new Date(iso), settings: s });
  assert.equal(reason(`${MONDAY}T06:29:00-03:00`), "fora_da_janela");
  assert.equal(reason(`${MONDAY}T06:30:00-03:00`), null);
  assert.equal(reason(`${MONDAY}T15:31:00-03:00`), null, "15:31 agora está dentro (a janela vai até 18:00)");
  assert.equal(reason(`${MONDAY}T18:00:00-03:00`), null);
  assert.equal(reason(`${MONDAY}T18:01:00-03:00`), "fora_da_janela");
  assert.equal(reason("2026-10-03T10:00:00-03:00"), null, "sábado envia");
  assert.equal(reason("2026-10-04T10:00:00-03:00"), "fim_de_semana", "domingo bloqueado");
  // Fuso: 09:35 UTC de segunda = 06:35 em São Paulo (dentro); 09:25 UTC = 06:25 (fora).
  assert.equal(reason(`${MONDAY}T09:35:00Z`), null);
  assert.equal(reason(`${MONDAY}T09:25:00Z`), "fora_da_janela");
});

test("intervalo: na v2 só o MÍNIMO de 5 min é fixo, independente do banco (antigo 5–10, zerado, frouxo ou restrito)", () => {
  for (const row of [{ min_gap_minutes: 0, max_gap_minutes: 0 }, {}, { min_gap_minutes: 1, max_gap_minutes: 1 }, { min_gap_minutes: 5, max_gap_minutes: 10 }, { min_gap_minutes: 20, max_gap_minutes: 40 }]) {
    assert.deepEqual(effectiveGapSeconds(row), { minSeconds: 300 });
    assert.deepEqual(applyPolicyV2(row).policy_gap_seconds, { minSeconds: 300 });
  }
  const plan = planV2Schedule({ count: 25, nowMs: 0, dateStr: MONDAY, settings: wide({ oscillate_enabled: true, oscillate_percent: 90 }), random: seeded(5) });
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i] - plan[i - 1] >= 300 * 1000, `intervalo ${i} >= 5 min`);
});

const gapsMin = (plan) => plan.slice(1).map((ms, i) => (ms - plan[i]) / MIN);
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
const WINDOW_OPEN = saoPauloInstantMs(MONDAY, 390);
const WINDOW_CLOSE = saoPauloInstantMs(MONDAY, 1080);

test("espalhamento (dono, 2026-10-13): 15 mensagens ≈ 46 min de média (28–64 com 40%), 30 ≈ 23 min (14–32), tudo entre 06:30 e 18:00", () => {
  for (const [count, nominal] of [[15, 46], [30, 23]]) {
    const settings = v2({ daily_cap_override: count, oscillate_percent: 40 });
    assert.equal(settings.policy_day_gap_minutes, nominal, "intervalo médio do dia = janela (690 min) ÷ teto");
    const all = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const plan = planV2Schedule({ count, nowMs: 0, dateStr: MONDAY, settings, random: seeded(seed) });
      assert.equal(plan.length, count, `${count} mensagens cabem na janela`);
      assert.ok(plan[0] >= WINDOW_OPEN && plan.at(-1) <= WINDOW_CLOSE, "tudo dentro de 06:30–18:00");
      all.push(...gapsMin(plan));
    }
    assert.ok(Math.abs(mean(all) - nominal) <= nominal * 0.08, `média ${mean(all).toFixed(1)} min perto de ${nominal}`);
    assert.ok(Math.min(...all) >= nominal * 0.6 * 0.85, `menor intervalo ${Math.min(...all).toFixed(1)} min (~${(nominal * 0.6).toFixed(1)} com 40%)`);
    assert.ok(Math.max(...all) <= nominal * 1.4 + 0.1, `maior intervalo ${Math.max(...all).toFixed(1)} min (~${(nominal * 1.4).toFixed(1)} com 40%)`);
  }
});

test("a oscilação segue o percentual do corretor: 0% = intervalos iguais; 20% = faixa mais estreita que 40%", () => {
  const spread = (percent) => {
    const all = [];
    for (let seed = 1; seed <= 60; seed += 1) all.push(...gapsMin(planV2Schedule({ count: 15, nowMs: 0, dateStr: MONDAY, settings: v2({ daily_cap_override: 15, oscillate_percent: percent }), random: seeded(seed) })));
    return Math.max(...all) - Math.min(...all);
  };
  const flat = gapsMin(planV2Schedule({ count: 15, nowMs: 0, dateStr: MONDAY, settings: v2({ daily_cap_override: 15, oscillate_percent: 0 }), random: seeded(1) }));
  assert.ok(Math.max(...flat) - Math.min(...flat) < 0.05, "0% de oscilação: todos os intervalos iguais");
  assert.ok(spread(20) < spread(40), "20% oscila menos que 40%");
});

test("aleatoriedade: sorteios diferentes dão horários diferentes; nunca repetidos nem no início exato da janela", () => {
  const settings = v2({ daily_cap_override: 15 });
  const plans = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => planV2Schedule({ count: 15, nowMs: 0, dateStr: MONDAY, settings, random: seeded(seed) }));
  assert.equal(new Set(plans.map((plan) => plan.join(","))).size, plans.length, "cada sorteio gera um dia diferente");
  assert.ok(new Set(plans.map((plan) => plan[0])).size >= 7, "o 1º horário do dia muda de um sorteio para o outro");
  for (const plan of plans) {
    assert.equal(new Set(plan).size, plan.length, "nenhum horário repetido");
    assert.notEqual(plan[0], WINDOW_OPEN, "não bate o ponto às 06:30:00");
    assert.ok(plan.every((ms) => ms % (5 * MIN) !== 0), "nenhum horário 'redondo' (múltiplo de 5 min exatos)");
  }
  // O mesmo sorteio (semente) reproduz o mesmo dia: o teste é determinístico, a produção usa Math.random.
  assert.deepEqual(planV2Schedule({ count: 15, nowMs: 0, dateStr: MONDAY, settings, random: seeded(3) }), plans[2]);
});

test("mínimo de 5 min entre dois envios sempre respeitado; apertado no fim do dia, o que não cabe até 18:00 sai da lista", () => {
  for (const seed of [1, 2, 3, 7, 11, 42]) {
    const now = at(`${MONDAY}T16:00:00-03:00`); // 120 min até as 18:00: cabem no máximo 25 envios a cada 5 min
    const plan = planV2Schedule({ count: 30, nowMs: now, dateStr: MONDAY, settings: v2(), random: seeded(seed) });
    assert.ok(plan.length > 0 && plan.length < 30, `fim do dia: só parte cabe (${plan.length})`);
    assert.ok(plan[0] >= now && plan.at(-1) <= WINDOW_CLOSE);
    for (const gap of gapsMin(plan)) assert.ok(gap >= 5 - 1e-9, `intervalo ${gap} >= 5 min`);
  }
  assert.deepEqual(planV2Schedule({ count: 3, nowMs: at(`${MONDAY}T18:01:00-03:00`), dateStr: MONDAY, settings: v2(), random: seeded(1) }), [], "depois das 18:00 nada para hoje");
  const nearEnd = planV2Schedule({ count: 5, nowMs: at(`${MONDAY}T17:56:00-03:00`), dateStr: MONDAY, settings: v2(), random: seeded(1) });
  assert.ok(nearEnd.length <= 1, "às 17:56 só cabe um");
});

test("pausas de 15–30 min: desligadas com intervalo médio do dia >= 15 min; só ligadas abaixo disso", () => {
  assert.equal(dayAverageGapMinutes({ windowStartMinutes: 390, windowEndMinutes: 1080, dailyCap: 30 }), 23);
  assert.equal(v2().policy_no_pauses, true, "teto 30: média de 23 min");
  assert.equal(v2({ daily_cap_override: 15 }).policy_no_pauses, true, "teto 15 (o do banco hoje): média de 46 min");
  assert.equal(v2({ slot_controls: { 1: { dispatch: true, warmupStart: "2026-10-05" } } }).policy_no_pauses, true, "aquecimento (teto 10): média de 69 min");
  assert.equal(policyCore.pausesOffForAverageGap(15), true, "exatamente 15 min já desliga");
  assert.equal(policyCore.pausesOffForAverageGap(14.9), false, "abaixo de 15 min as pausas valem");
  // Sem pausas, o envio NÃO é segurado por "12 seguidos": só vale o mínimo de 5 min.
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const twelve = summarizeV2Usage(Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - (10 + (11 - i) * 3) * MIN).toISOString() })));
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve, settings: v2() }), null);
  // Com pausas ligadas (intervalo curto): pausa de 15–30 min a cada 8–12 envios e nunca menos de 5 min entre dois.
  for (const seed of [1, 2, 3, 7, 11, 42]) {
    const settings = { ...paused(), window_end_minutes: 11 * 60 }; // 06:30–11:00: média de ~9 min para 30 mensagens
    const plan = planV2Schedule({ count: 30, nowMs: 0, dateStr: MONDAY, settings, random: seeded(seed) });
    assert.ok(plan.length >= 20, `a maior parte cabe (${plan.length})`);
    assert.ok(plan.at(-1) <= saoPauloInstantMs(MONDAY, 11 * 60));
    let run = 1;
    const runs = [];
    for (const gap of gapsMin(plan)) {
      assert.ok(gap >= 5 - 1e-9, "mínimo 5 min");
      if (gap >= PAUSE_MIN_MINUTES) {
        assert.ok(gap <= PAUSE_MAX_MINUTES + 0.1, "pausa de até 30 min");
        runs.push(run);
        run = 1;
      } else run += 1;
    }
    for (const r of runs) assert.ok(r >= PAUSE_EVERY_MIN && r <= PAUSE_EVERY_MAX, `pausa a cada ${PAUSE_EVERY_MIN}–${PAUSE_EVERY_MAX} envios (viu ${r})`);
    assert.ok(runs.length >= 1, "30 envios curtos têm pelo menos 1 pausa");
  }
});

test("planejamento respeita o último envio e a reconexão; nunca antes de agora; o que não cabe sai da lista", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const plan = planV2Schedule({ count: 5, nowMs: now, dateStr: MONDAY, settings: wide(), lastSendMs: now - 30 * 1000, random: seeded(3) });
  assert.ok(plan[0] >= now + 270 * 1000 - 1000, "último envio há 30 s: espera até completar 5 min");
  const afterConnect = planV2Schedule({ count: 3, nowMs: now, dateStr: MONDAY, settings: wide(), connectedAtMs: now - MIN, random: seeded(3) });
  assert.ok(afterConnect[0] >= now - MIN + 120 * MIN, "1º envio só 2 h depois de conectar");
  assert.equal(afterConnect.length, 3);
  const late = planV2Schedule({ count: 60, nowMs: at(`${MONDAY}T15:00:00-03:00`), dateStr: MONDAY, settings: wide(), random: seeded(3) });
  assert.ok(late.length > 0 && late.length < 60, "perto do fim da janela só cabe parte");
  assert.ok(late.every((ms) => ms <= saoPauloInstantMs(MONDAY, 1080)), "nunca depois das 18:00");
  assert.deepEqual(planV2Schedule({ count: 0, nowMs: 0, dateStr: MONDAY, settings: wide() }), []);
});

test("contagem de envios desde a última pausa", () => {
  const t = (m) => m * MIN;
  assert.equal(sendsSinceLastPause([]), 0);
  assert.equal(sendsSinceLastPause([t(0), t(5), t(10)]), 3);
  assert.equal(sendsSinceLastPause([t(0), t(5), t(30), t(35), t(40)]), 3, "intervalo de 15 min ou mais é uma pausa");
});

test("teto de 30/dia e 10/10/10: Meta Diária por tentativa, fila extra soma só no total", () => {
  const rows = [];
  for (let i = 0; i < 10; i += 1) rows.push({ id: `a${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: `${MONDAY}T07:${10 + i}:00-03:00` });
  for (let i = 0; i < 5; i += 1) rows.push({ id: `e${i}`, attempt_number: 1, source: "extra", status: "sent", send_started_at: `${MONDAY}T08:${10 + i}:00-03:00` });
  const usage = summarizeV2Usage(rows);
  assert.equal(usage.total, 15);
  assert.deepEqual(usage.metaByAttempt, { 1: 10, 2: 0, 3: 0 }, "extra não consome a cota da 1ª tentativa da Meta Diária");
  const now = at(`${MONDAY}T12:00:00-03:00`);
  assert.equal(v2SendBlockReason({ nowMs: now, usage, settings: v2(), attemptNumber: 1, source: "meta" }), "teto_por_tentativa_politica");
  assert.equal(v2SendBlockReason({ nowMs: now, usage, settings: v2(), attemptNumber: 2, source: "meta" }), null);
  assert.equal(v2SendBlockReason({ nowMs: now, usage, settings: v2(), source: "extra" }), null, "extra não tem teto por tentativa");
  const full = summarizeV2Usage(Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, attempt_number: (i % 3) + 1, source: i < 25 ? "meta" : "extra", status: "sent", send_started_at: `${MONDAY}T0${7 + Math.floor(i / 10)}:${String(i % 10).padStart(2, "0")}:00-03:00` })));
  assert.equal(v2SendBlockReason({ nowMs: now, usage: full, settings: v2(), attemptNumber: 2 }), "teto_diario_politica");
  assert.equal(dailyCapFor({ daily_cap_override: 100 }), 30, "teto manual nunca passa de 30");
  assert.equal(dailyCapFor({ daily_cap_override: 12 }), 12, "teto manual menor vale");
});

test("fila do dia: 10 na 1ª, 10 na 2ª e nenhuma na 3ª (removida em 2026-10-16) a partir de qualquer volume", () => {
  const cands = [];
  for (let i = 0; i < 50; i += 1) for (const attempt of [1, 2, 3]) cands.push({ attempt, id: `${attempt}-${i}` });
  const allowance = v2EnqueueAllowance({ usage: emptyUsage(), pendingTodayByAttempt: {}, settings: v2() });
  const picked = pickV2EnqueueCandidates(cands, allowance);
  assert.equal(picked.length, 20);
  for (const a of [1, 2]) assert.equal(picked.filter((c) => c.attempt === a).length, 10);
  assert.equal(picked.filter((c) => c.attempt === 3).length, 0, "3ª tentativa nunca entra na fila");
  // Já saiu 4 da 1ª e há 3 pendentes da 2ª hoje: sobram 6/7/0, total 30-7=23 mas só 13 cabem nas tentativas.
  const usage = summarizeV2Usage(Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: `${MONDAY}T07:0${i}:00-03:00` })));
  const al2 = v2EnqueueAllowance({ usage, pendingTodayByAttempt: { 2: 3 }, settings: v2() });
  assert.deepEqual(al2.byAttempt, { 1: 6, 2: 7, 3: 0 });
  assert.equal(al2.totalLeft, 23);
  const picked2 = pickV2EnqueueCandidates(cands, al2);
  assert.equal(picked2.length, 13);
  // Menos candidatos que a cota: não inventa (e a 3ª nunca entra).
  assert.equal(pickV2EnqueueCandidates([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }], allowance).length, 2);
  assert.equal(v2EnqueueAllowance({ usage: emptyUsage(), pendingTodayByAttempt: { 1: 10, 2: 10, 3: 10 }, settings: v2() }).totalLeft, 0);
});

test("nunca 2 mensagens no mesmo momento: intervalo mínimo e pausa contados do último envio real (qualquer fila)", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const usageAt = (secondsAgo) => summarizeV2Usage([{ id: "u", attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - secondsAgo * 1000).toISOString() }]);
  assert.equal(v2SendBlockReason({ nowMs: now, usage: usageAt(60), settings: v2() }), "intervalo_minimo_politica");
  assert.equal(v2SendBlockReason({ nowMs: now, usage: usageAt(299), settings: v2() }), "intervalo_minimo_politica", "299 s ainda bloqueia");
  assert.equal(v2SendBlockReason({ nowMs: now, usage: usageAt(301), settings: v2() }), null);
  // Tentativa que falhou (send_started_at gravado, nunca saiu) conta para o intervalo, não para o teto.
  const failed = summarizeV2Usage([{ id: "f", attempt_number: 1, source: "meta", status: "pending", send_started_at: new Date(now - 30 * 1000).toISOString() }]);
  assert.equal(failed.total, 0);
  assert.equal(v2SendBlockReason({ nowMs: now, usage: failed, settings: v2() }), "intervalo_minimo_politica");
  // Pausa: 12 envios seguidos e o último há 10 min = pausa obrigatória; 16 min depois = liberado.
  const twelve = (lastAgoMin) => summarizeV2Usage(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - (lastAgoMin + (11 - i) * 3) * MIN).toISOString() })));
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve(10), settings: paused() }), "pausa_programada_politica", "pausas ligadas (intervalo médio < 15 min)");
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve(16), settings: paused() }), null);
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve(10), settings: wide() }), null, "com o intervalo médio >= 15 min não há pausa programada");
  // Duas execuções do cron "ao mesmo tempo": a segunda enxerga o envio da primeira (exclui só o próprio item).
  const first = [{ id: "A", attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - 2000).toISOString() }, { id: "B", attempt_number: 2, source: "meta", status: "sending", send_started_at: null }];
  assert.equal(v2SendBlockReason({ nowMs: now, usage: summarizeV2Usage(first, { excludeItemId: "B" }), settings: wide() }), "intervalo_minimo_politica");
});

test("reconexão: nada de rajada — espera 30 min depois de conectar (Meta Diária e fila extra; eram 2 h até 2026-10-16)", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const block = (connectedAtMs, source) => v2SendBlockReason({ nowMs: now, usage: emptyUsage(), settings: wide(), connectedAtMs, source });
  assert.equal(block(now - 3 * MIN), "aguardando_apos_reconexao");
  assert.equal(block(now - 6 * MIN), "aguardando_apos_reconexao", "os 5 min antigos não bastam mais");
  assert.equal(block(now - 29 * MIN), "aguardando_apos_reconexao");
  assert.equal(block(now - 30 * MIN), null, "exatamente 30 min já libera");
  assert.equal(block(now - 31 * MIN), null);
  assert.equal(block(now - 119 * MIN), null, "as 2 h antigas não valem mais");
  assert.equal(block(null), null, "sem dado de conexão nunca segura");
  assert.equal(block(now - 3 * MIN, "extra"), "aguardando_apos_reconexao", "a fila 'Disparar' espera igual");
  assert.equal(block(now - 31 * MIN, "extra"), null);
});

test("espera pós-conexão é POR NÚMERO: o número que acabou de conectar espera, o outro segue", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const iso = (ms) => new Date(ms).toISOString();
  const rows = [
    { slot: 1, status: "connected", last_connected_at: iso(now - 5 * 3600 * 1000) },
    { slot: 2, status: "connected", last_connected_at: iso(now - 10 * MIN) }
  ];
  assert.deepEqual(slotsPastReconnectWait({ rows, slots: [1, 2], nowMs: now }), [1], "o número 2 ainda espera");
  assert.deepEqual(slotsPastReconnectWait({ rows, slots: [2], nowMs: now }), []);
  assert.deepEqual(slotsPastReconnectWait({ rows, slots: [1, 2], nowMs: now + 21 * MIN }), [1, 2], "10 min + 20 min = 30 min");
  assert.deepEqual(slotsPastReconnectWait({ rows: [{ slot: 1, status: "connected", last_connected_at: null }], slots: [1], nowMs: now }), [1], "sem last_connected_at não segura");
  // Corretor: vale a conexão MAIS ANTIGA entre os números aptos (basta um liberado para poder enviar).
  assert.equal(brokerReconnectReferenceMs({ rows, slots: [1, 2] }), now - 5 * 3600 * 1000);
  assert.equal(reconnectHoldUntilMs({ rows, slots: [1, 2], nowMs: now }), null, "o número 1 está liberado: o corretor não fica parado");
  assert.equal(reconnectHoldUntilMs({ rows, slots: [2], nowMs: now }), now - 10 * MIN + 30 * MIN, "só o número 2 apto: espera até conexão + 30 min");
  assert.equal(reconnectHoldUntilMs({ rows, slots: [2], nowMs: now + 21 * MIN }), null, "passou a espera");
  assert.equal(reconnectHoldUntilMs({ rows, slots: [], nowMs: now }), null, "nenhum número apto: o motivo é outro (sessão), não a espera");
  assert.equal(brokerReconnectReferenceMs({ rows: [{ slot: 1, last_connected_at: iso(now - MIN) }, { slot: 2, status: "connected", last_connected_at: null }], slots: [1, 2] }), null, "um número sem dado = sem espera");
  assert.equal(brokerReconnectReferenceMs({ rows, slots: [] }), now - 5 * 3600 * 1000, "sem número apto cai no Número 1");
  assert.equal(reconnectReadyAtMs(now), now + 30 * MIN);
  assert.equal(reconnectReadyAtMs(null), null);
});

test("cartão da Automação: 'aguardando 30 min após reconectar (envia a partir de HH:MM)'", () => {
  const line = formatReconnectHoldLine(at(`${MONDAY}T11:58:00-03:00`));
  assert.equal(line, "aguardando 30 min após reconectar (envia a partir de 11:58)");
  assert.equal(formatReconnectHoldLine(NaN), "");
});

test("reconexão: atrasados são REPROGRAMADOS (não saem de uma vez): espaçados, sem passado, nunca 2 no mesmo minuto, depois de conectar + 30 min", () => {
  const settings = wide();
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const connectedAtMs = now - 2 * MIN; // reconectou há 2 min, depois de horas fora
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, attempt_number: (i % 2) + 1, scheduled_for: new Date(now - (180 - i * 10) * MIN).toISOString() }));
  const stale = findStaleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, connectedAtMs });
  assert.equal(stale.length, 12, "todos estão atrasados além da tolerância");
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: emptyUsage(), connectedAtMs, random: seeded(9) });
  assert.equal(updates.length, 12, "ninguém é cancelado nem perdido");
  assert.equal(new Set(updates.map((u) => u.id)).size, 12, "sem duplicar");
  const times = updates.map((u) => u.scheduledMs);
  assert.ok(times.every((ms) => ms >= connectedAtMs + 30 * MIN && ms >= now), "nenhum no passado nem antes de conectar + 30 min");
  assert.equal(new Set(times.map((ms) => Math.floor(ms / MIN))).size, 12, "nunca 2 no mesmo minuto");
  const sorted = [...times].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 300 * 1000 - 1000, "espaçados (>= 5 min)");
  // Ordem original preservada.
  assert.deepEqual(updates.map((u) => u.id), items.map((i) => i.id));
});

test("itens velhos, atrasados ou segurados pela reconexão são detectados; item no horário e item de dia futuro não", () => {
  const settings = wide();
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const mk = (id, iso) => ({ id, scheduled_for: iso });
  const stale = findStaleV2Items([
    mk("ontem", "2026-10-03T10:00:00-03:00"),
    mk("fora_da_janela", `${MONDAY}T18:30:00-03:00`),
    mk("ainda_dentro_ate_18h", `${MONDAY}T17:30:00-03:00`),
    mk("atrasado", `${MONDAY}T09:40:00-03:00`),
    mk("no_horario", `${MONDAY}T09:58:00-03:00`),
    mk("futuro", `${MONDAY}T10:20:00-03:00`),
    mk("amanha", "2026-10-06T07:00:00-03:00"),
    mk("invalido", "nao-e-data")
  ], { nowMs: now, dateStr: MONDAY, settings });
  assert.deepEqual(stale.sort(), ["atrasado", "fora_da_janela", "invalido", "ontem"].sort());
  const gate = findStaleV2Items([mk("segurado", `${MONDAY}T09:58:00-03:00`)], { nowMs: now, dateStr: MONDAY, settings, connectedAtMs: now - 2 * MIN });
  assert.deepEqual(gate, ["segurado"], "venceu enquanto a sessão reconectava: reprograma");
  // Espera de 30 min: o que cairia DENTRO da espera (mesmo no futuro, ainda não vencido) é reprogramado agora; o que cai depois
  // da espera, ou em dia futuro, fica como está. Conexão antiga (passou a espera) não segura nada.
  const hold = findStaleV2Items([mk("dentro_da_espera", `${MONDAY}T10:20:00-03:00`), mk("depois_da_espera", `${MONDAY}T12:30:00-03:00`), mk("amanha", "2026-10-06T07:00:00-03:00")], { nowMs: now, dateStr: MONDAY, settings, connectedAtMs: now - 2 * MIN });
  assert.deepEqual(hold, ["dentro_da_espera"]);
  assert.deepEqual(findStaleV2Items([mk("dentro", `${MONDAY}T10:30:00-03:00`)], { nowMs: now, dateStr: MONDAY, settings, connectedAtMs: now - 3 * 3600 * 1000 }), [], "espera já cumprida");
});

test("reconexão tarde (a espera passa do fim da janela): nada é cancelado, tudo vai para o próximo dia de disparo", () => {
  const settings = wide();
  const now = at(`${MONDAY}T17:45:00-03:00`);
  const connectedAtMs = now - 5 * MIN; // pronto às 18:10 (espera de 30 min), depois das 18:00
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, attempt_number: (i % 2) + 1, scheduled_for: `${MONDAY}T14:${String(10 + i * 5).padStart(2, "0")}:00-03:00` }));
  assert.equal(findStaleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, connectedAtMs }).length, 8);
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: emptyUsage(), connectedAtMs, random: seeded(5) });
  assert.equal(updates.length, 8, "ninguém perdido nem cancelado");
  assert.equal(new Set(updates.map((u) => u.id)).size, 8, "sem duplicar");
  assert.ok(updates.every((u) => u.scheduledMs >= saoPauloInstantMs("2026-10-06", settings.window_start_minutes)), "todos no dia seguinte (terça)");
  // Sábado tarde: o próximo dia de disparo pula o domingo.
  const saturdayNow = at("2026-10-03T17:45:00-03:00");
  const sat = rescheduleV2Items(items, { nowMs: saturdayNow, dateStr: "2026-10-03", settings, usage: emptyUsage(), connectedAtMs: saturdayNow - 5 * MIN, random: seeded(5) });
  assert.ok(sat.every((u) => saoPauloDateMinutes(u.scheduledMs).weekday === 1), "sábado → segunda");
});

test("fila passa ao dia seguinte sem duplicar, respeitando 30/dia e 10/10 (sem 3ª); domingo vai para segunda", () => {
  const settings = wide();
  const now = at(`${MONDAY}T14:30:00-03:00`);
  const items = Array.from({ length: 45 }, (_, i) => ({ id: `q${i}`, attempt_number: (i % 2) + 1, scheduled_for: `${MONDAY}T07:${String(i).padStart(2, "0")}:00-03:00` }));
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: emptyUsage(), random: seeded(4) });
  assert.equal(updates.length, 45);
  assert.equal(new Set(updates.map((u) => u.id)).size, 45, "sem duplicar");
  const byDay = new Map();
  for (const u of updates) {
    const day = saoPauloDateMinutes(u.scheduledMs);
    assert.notEqual(day.weekday, 0, "nunca domingo");
    assert.ok(day.minutes >= 390 && day.minutes <= 1080, "sempre dentro da janela (até 18:00)");
    const bucket = byDay.get(day.date) || { total: 0, 1: 0, 2: 0, 3: 0 };
    bucket.total += 1;
    bucket[items.find((i) => i.id === u.id).attempt_number] += 1;
    byDay.set(day.date, bucket);
  }
  for (const [, bucket] of byDay) {
    assert.ok(bucket.total <= 30);
    for (const a of [1, 2, 3]) assert.ok(bucket[a] <= 10);
  }
  assert.ok(byDay.has(MONDAY) && byDay.has("2026-10-06"), "parte hoje, o resto amanhã");
  assert.equal(nextSendingDate("2026-10-03"), "2026-10-05", "sábado -> segunda");
  assert.equal(nextSendingDate("2026-10-02"), "2026-10-03", "sexta -> sábado");
  const sunday = rescheduleV2Items(items.slice(0, 5), { nowMs: at("2026-10-04T10:00:00-03:00"), dateStr: "2026-10-04", settings, usage: emptyUsage(), todayAllowed: false, random: seeded(4) });
  assert.ok(sunday.every((u) => saoPauloDateMinutes(u.scheduledMs).date === "2026-10-05"), "domingo: tudo para segunda");
  // Hoje já tem 28 enviadas: só 2 cabem hoje, o resto vai para amanhã.
  const usage28 = summarizeV2Usage(Array.from({ length: 28 }, (_, i) => ({ id: `d${i}`, attempt_number: (i % 3) + 1, source: "meta", status: "sent", send_started_at: `${MONDAY}T0${6 + Math.floor(i / 12)}:${String(30 + (i % 12)).padStart(2, "0")}:00-03:00` })));
  const rest = rescheduleV2Items(items.slice(0, 6), { nowMs: at(`${MONDAY}T11:00:00-03:00`), dateStr: MONDAY, settings, usage: usage28, random: seeded(4) });
  assert.ok(rest.filter((u) => saoPauloDateMinutes(u.scheduledMs).date === MONDAY).length <= 2);
  assert.equal(new Set(rest.map((u) => u.id)).size, 6);
});

test("elegibilidade preservada (MD-13, Não contactar, tentativa de hoje) na fila e no envio da v2", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  const helper = code.slice(code.indexOf("async function loadEligibleEnqueueRounds"), code.indexOf("const V2_USAGE_COLUMNS"));
  assert.match(helper, /round\.contact\?\.status !== "do_not_contact"/);
  assert.match(helper, /listPhonesBlockedByHumanConversation/, "MD-13 na montagem da fila");
  assert.match(helper, /\.eq\("goal_date", today\)/, "quem já teve tentativa hoje não entra");
  assert.match(helper, /round\.origin === "extra_dispatch" && round\.attempt_count === 0/);
  assert.match(helper, /attemptedTodaySet/);
  assert.match(helper, /alreadyQueuedByRound/, "sem item duplicado");
  const send = code.slice(code.indexOf("async function processClaimedItem"), code.indexOf("async function handleSendFailure"));
  assert.match(send, /isContactBlockedFromOutreach/, "do_not_contact revalidado no envio");
  assert.match(send, /humanConversationBlockFor/, "MD-13 revalidado no envio");
  assert.match(send, /ja_teve_tentativa_hoje/);
  const v2Enqueue = code.slice(code.indexOf("async function enqueueTodayItemsV2"), code.indexOf("async function v2GuardAfterClaim"));
  assert.match(v2Enqueue, /loadEligibleEnqueueRounds/, "a v2 usa o MESMO filtro de elegibilidade");
  assert.doesNotMatch(v2Enqueue, /status: "canceled"/, "a v2 não cancela item ao completar a fila");
});

test("fila extra na v2: mesma janela 06:30–18:00, nunca domingo; sem a v2 segue 07:00–21:00", () => {
  const settings = { enabled: true, paused: false, business_days_only: true };
  const window = { startMinutes: 390, endMinutes: 1080 };
  const r = (iso, policyWindow) => extraSendBlockReason({ now: new Date(iso), settings, policyWindow });
  assert.equal(r(`${MONDAY}T06:40:00-03:00`, window), null);
  assert.equal(r(`${MONDAY}T06:40:00-03:00`, null), "fora_do_horario_extra", "regra antiga intacta");
  assert.equal(r(`${MONDAY}T15:40:00-03:00`, window), null, "15:40 agora está dentro da janela");
  assert.equal(r(`${MONDAY}T18:10:00-03:00`, window), "fora_do_horario_extra");
  assert.equal(r(`${MONDAY}T18:10:00-03:00`, null), null, "regra antiga intacta (até 21h)");
  assert.equal(r("2026-10-04T10:00:00-03:00", window), "fim_de_semana");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-04T10:00:00-03:00"), settings: { ...settings, business_days_only: false }, policyWindow: window }), "fim_de_semana", "v2 nunca envia no domingo");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-04T10:00:00-03:00"), settings: { ...settings, business_days_only: false } }), null, "regra antiga intacta");
  // Intervalo da fila extra (2026-10-13): o MESMO ritmo devagar do dia (janela ÷ teto) ± oscilação, estável por item, nunca < 5 min.
  for (const [cap, nominal] of [[30, 23], [15, 46]]) {
    const s = v2({ daily_cap_override: cap, oscillate_percent: 40 });
    const seen = new Set();
    for (const seed of ["a", "b", "item-123", "zzz", "x".repeat(40), "k1", "k2", "k3"]) {
      const gap = extraGapSecondsV2(seed, s);
      assert.ok(gap >= nominal * 0.6 * 60 - 1 && gap <= nominal * 1.4 * 60 + 1, `${cap}/dia: ${gap} s dentro de ±40% de ${nominal} min`);
      assert.ok(gap >= s.policy_gap_seconds.minSeconds, "nunca abaixo de 5 min");
      assert.equal(gap, extraGapSecondsV2(seed, s), "estável entre ciclos do cron");
      seen.add(gap);
    }
    assert.ok(seen.size >= 5, "itens diferentes sorteiam intervalos diferentes");
  }
  assert.ok(extraGapSecondsV2("abc", applyPolicyV2({ min_gap_minutes: 0, max_gap_minutes: 0 })) >= 300);
  assert.equal(extraGapSecondsV2("abc", { policy_gap_seconds: { minSeconds: 300 } }), 300, "sem média do dia cai no mínimo");
  // Exceção por data (faixa fixa 17–21 min de 05/10): continua uniforme dentro da faixa.
  const range = { policy_gap_seconds: { minSeconds: 17 * 60, maxSeconds: 21 * 60 } };
  for (const seed of ["a", "b", "c"]) assert.ok(extraGapSecondsV2(seed, range) >= 17 * 60 && extraGapSecondsV2(seed, range) <= 21 * 60);
});

test("teto de 30 é por número somando Meta Diária + fila extra (a extra entra no total)", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, attempt_number: 1, source: i < 20 ? "meta" : "extra", status: "sent", send_started_at: `${MONDAY}T0${7 + Math.floor(i / 10)}:${String((i % 10) * 5).padStart(2, "0")}:00-03:00` }));
  const usage = summarizeV2Usage(rows);
  assert.equal(usage.total, 30);
  assert.equal(v2SendBlockReason({ nowMs: at(`${MONDAY}T14:00:00-03:00`), usage, settings: v2(), source: "extra" }), "teto_diario_politica");
});

test("o código da v2 trava a corrida do cron: claim atômico + rechecagem pós-claim com o uso do dia sem o próprio item", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /loadV2Usage\(brokerId, \{ excludeItemId: item\.id \}\)/);
  assert.match(code, /const guardReason = await v2GuardAfterClaim\(\{ item, brokerId, settings: settingsRow, source: "meta" \}\)/);
  assert.match(code, /const guardReason = await v2GuardAfterClaim\(\{ item, brokerId, settings: policySettings, source: "extra" \}\)/);
  const sql = readFileSync("supabase/migrations/20261002240000_prospecting_extra_dispatch_queue.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('dispatch_send:'/, "claim serializado por corretor");
  assert.match(sql, /status = 'sending'\)\s*then|where broker_id = p_broker_id and status = 'sending'/, "recusa enquanto há item enviando");
});

// ---------------------------------------------------------------- mensagens v2
const ATTEMPTS = [1, 2, 3];
const FORBIDDEN = [/https?:/i, /www\./i, /\.com/i, /\.br\b/i, /sem entrada/i, /aprov/i, /R\$/, /parcela/i, /\brenda\b/i, /garant/i, /subs[ií]dio/i, /desconto/i, /prazo/i, /gr[aá]tis|gratuit/i, /100%/];

test("modelos v2: no mínimo 8 por tentativa, 5 curtos + 5 longos, todos com SAIR em linha própria no fim", () => {
  for (const attempt of ATTEMPTS) {
    const list = V2_AUTO_MESSAGES[`message${attempt}`];
    assert.ok(list.length >= 8, `tentativa ${attempt}: ${list.length} modelos`);
    assert.equal(list.filter((m) => m.length === "short").length, 5);
    assert.equal(list.filter((m) => m.length === "long").length, 5);
    for (const model of list) {
      const lines = model.text.split("\n");
      const last = lines.at(-1);
      assert.match(last, /\*SAIR\*/, "SAIR destacado");
      assert.equal(lines.at(-2), "", "linha de saída separada por linha em branco");
      assert.match(last, /SAIR/);
      assert.ok(/(responda|responder)/i.test(last), "pede para responder SAIR");
    }
  }
});

test("modelos v2: 1ª/2ª/3ª sem promessa e sem link; só as variáveis permitidas; renderizam sem sobra", () => {
  for (const attempt of ATTEMPTS) {
    for (const model of V2_AUTO_MESSAGES[`message${attempt}`]) {
      for (const pattern of FORBIDDEN) assert.doesNotMatch(model.text, pattern, `tentativa ${attempt}: ${pattern} em "${model.text.slice(0, 40)}"`);
      const vars = [...model.text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      for (const v of vars) assert.ok(["saudacao", "primeiro_nome", "nome_corretor"].includes(v), `variável ${v} não permitida`);
      const text = renderAutoMessage(model.text, { saudacao: "Bom dia", primeiroNome: "Ana", nomeCorretor: "Bruna", corretorGender: "female" });
      assert.equal(hasUnresolvedVariable(text), false);
      assert.match(text, /^Bom dia Ana/);
    }
  }
});

test("modelos v2: curtos são mesmo curtos e longos são mesmo longos (variação real de tamanho)", () => {
  for (const attempt of ATTEMPTS) {
    for (const model of V2_AUTO_MESSAGES[`message${attempt}`]) {
      const rendered = renderAutoMessage(model.text, { saudacao: "Bom dia", primeiroNome: "Ana", nomeCorretor: "Bruna" });
      if (model.length === "short") assert.ok(rendered.length <= 200, `curto demais? ${rendered.length}`);
      else assert.ok(rendered.length >= 300, `longo curto demais: ${rendered.length}`);
    }
  }
  assert.equal(v2VariantLength(1, 0), "short");
  assert.equal(v2VariantLength(1, 1), "long");
});

test("escolha do modelo v2: alterna curto/longo, nunca repete o último nem o penúltimo da tentativa", () => {
  for (const seed of [1, 2, 3, 99]) {
    const random = seeded(seed);
    const sends = [];
    for (let i = 0; i < 300; i += 1) {
      const attempt = ATTEMPTS[Math.floor(random() * 3)];
      const index = pickV2Variant({ attemptNumber: attempt, recentSends: sends, random });
      assert.ok(index >= 0 && index < V2_AUTO_MESSAGES[`message${attempt}`].length);
      const length = v2VariantLength(attempt, index);
      if (sends.length) {
        const last = sends.at(-1);
        assert.notEqual(length, v2VariantLength(last.attempt_number, last.variant_index), "tamanho nunca repete em sequência");
      }
      const same = sends.filter((s) => s.attempt_number === attempt).slice(-2);
      assert.ok(!same.some((s) => s.variant_index === index), "não repete o último nem o penúltimo modelo da tentativa");
      sends.push({ attempt_number: attempt, variant_index: index });
    }
  }
  assert.equal(pickV2Variant({ attemptNumber: 9, recentSends: [] }), -1);
});

test("SAIR vira opt-out: 'SAIR', 'sair', 'Sair.', 'SAIR!' reconhecidos; frases comuns não", () => {
  for (const text of ["SAIR", "sair", "Sair.", "SAIR!", "  sair  ", "Sair!!!"]) {
    assert.equal(isOptOutMessage(text), true, `palavra-chave: ${text}`);
    assert.equal(isClearOptOut(text), true, `opt-out claro: ${text}`);
  }
  for (const text of ["não quero sair de casa", "vou sair de férias", "quero sair mais cedo hoje?", "pode sair daí", "Oi, tudo bem?"]) {
    assert.equal(isOptOutMessage(text), false, `falso positivo: ${text}`);
    assert.equal(isClearOptOut(text), false, `falso positivo: ${text}`);
  }
});

test("limpeza do excesso: no máximo 10 por tentativa, mantém os 10 PRIORITÁRIOS (ordem da fila), idempotente", () => {
  const mk = (attempt, n) => Array.from({ length: n }, (_, i) => ({ id: `a${attempt}-${String(i).padStart(3, "0")}`, attempt_number: attempt, scheduled_for: new Date(Date.UTC(2026, 9, 3, 10, i)).toISOString(), created_at: new Date(Date.UTC(2026, 9, 3, 9, 0, i)).toISOString() }));
  const items = [...mk(1, 20), ...mk(2, 19), ...mk(3, 44)];
  const shuffled = items.slice().sort((a, b) => (a.id < b.id ? 1 : -1));
  const plan = planV2Trim(shuffled);
  // 3ª tentativa removida (dono, 2026-10-16): teto 0 — todo pendente de 3ª sai da fila.
  assert.deepEqual(plan.byAttempt, { 1: { kept: 10, trimmed: 10 }, 2: { kept: 10, trimmed: 9 }, 3: { kept: 0, trimmed: 44 } });
  assert.equal(plan.trimIds.length, 63);
  const kept = items.filter((i) => !plan.trimIds.includes(i.id));
  assert.equal(kept.length, 20, "20 por corretor no máximo (10+10, sem 3ª)");
  for (const attempt of [1, 2]) {
    const keptIds = kept.filter((i) => i.attempt_number === attempt).map((i) => i.id).sort();
    assert.deepEqual(keptIds, items.filter((i) => i.attempt_number === attempt).slice(0, 10).map((i) => i.id), "ficam os 10 mais prioritários (horário mais cedo)");
  }
  assert.deepEqual(planV2Trim(kept).trimIds, [], "idempotente: rodar de novo não retira nada");
});

test("limpeza do excesso: sem empréstimo entre tentativas (10 + 6 = 16, nunca 20) e desempate por created_at", () => {
  const same = "2026-10-03T10:00:00.000Z";
  const mk = (attempt, n) => Array.from({ length: n }, (_, i) => ({ id: `b${attempt}-${i}`, attempt_number: attempt, scheduled_for: same, created_at: new Date(Date.UTC(2026, 9, 3, 9, i)).toISOString() }));
  const plan = planV2Trim([...mk(1, 10), ...mk(2, 6)]);
  assert.deepEqual(plan.trimIds, []);
  assert.deepEqual(plan.byAttempt, { 1: { kept: 10, trimmed: 0 }, 2: { kept: 6, trimmed: 0 }, 3: { kept: 0, trimmed: 0 } });
  const trimmed = planV2Trim(mk(1, 14).reverse());
  assert.deepEqual(trimmed.trimIds.sort(), ["b1-10", "b1-11", "b1-12", "b1-13"].sort(), "empate de horário: fica quem foi criado primeiro");
  assert.deepEqual(planV2Trim([]).trimIds, []);
  assert.deepEqual(planV2Trim([{ id: "x", attempt_number: 4, scheduled_for: same }]).trimIds, [], "tentativa fora de 1–3 nunca é mexida");
  // O envio também não empresta: 10 já enviados na tentativa 1 bloqueiam a 11ª mesmo com o total abaixo de 30.
  const sent = summarizeV2Usage(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(Date.UTC(2026, 9, 5, 12, i * 10)).toISOString() })));
  assert.equal(v2SendBlockReason({ nowMs: Date.UTC(2026, 9, 5, 18, 0), usage: sent, settings: wide(), attemptNumber: 1 }), "teto_por_tentativa_politica");
});

test("limpeza do excesso: ligada ao cron, à reconexão e à geração da fila; nunca ressuscita; só mexe na fila", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /await trimV2QueueExcess\(brokerId, row\);\s*\n\s*\/\/ Prospecção SÓ/, "cron: antes da checagem de sessão");
  assert.match(code, /const settingsForTrim = await getSettingsRow\(brokerId\);\s*\n\s*await trimV2QueueExcess\(brokerId, settingsForTrim\)/, "reconexão");
  assert.match(code, /async function rescheduleV2Queue[\s\S]{0,200}await trimV2QueueExcess\(brokerId, rawSettingsRow\)/, "geração/reprogramação da fila");
  assert.match(code, /if \(!rawSettingsRow\?\.enabled \|\| !isPolicyV2Enabled\(rawSettingsRow\)\) return \{ trimmed: 0 \}/, "só automação ligada + v2 vigente");
  assert.match(code, /\.eq\("status", "canceled"\)\.eq\("skip_reason", TRIM_SKIP_REASON\)/, "itens retirados nunca são recriados");
  const start = code.indexOf("async function trimV2QueueExcess");
  const body = code.slice(start, code.indexOf("// Reprograma (UPDATE do scheduled_for", start));
  assert.doesNotMatch(body, /simulation_registrations|client_status_history|daily_goal_rounds|daily_goal_attempts|\.delete\(|sendIndividualMessage/, "só cancela item da fila: não toca cliente, funil, rodada, histórico nem envia");
  assert.match(body, /\.update\(\{ status: "canceled", skip_reason: TRIM_SKIP_REASON/);
  assert.match(body, /\.in\("id", plan\.trimIds\)\.eq\("status", "pending"\)/, "só itens ainda pendentes");
  assert.equal(TRIM_SKIP_REASON, "policy_v2_trim_excess");
});

test("espera pós-conexão (30 min): constante única, usada por número no envio e mostrada no cartão; envio manual fora disso", () => {
  const core = readFileSync("lib/daily-goal-policy-core.mjs", "utf8");
  assert.doesNotMatch(core, /RECONNECT_DELAY_MINUTES/, "o atraso de 5 min foi substituído");
  assert.equal((core.match(/RECONNECT_SETTLE_MINUTES \* MINUTE_MS/g) || []).length, 1, "o cálculo da espera existe num lugar só (reconnectReadyAtMs)");
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /slotsPastReconnectWait\(\{ rows: state\.rows, slots: notPaused/, "o número ainda em espera não é escolhido para o envio");
  assert.match(code, /brokerReconnectReferenceMs\(/);
  assert.match(code, /reconnectHoldUntil,/, "o cartão recebe até quando o corretor espera");
  assert.doesNotMatch(code, /RECONNECT_DELAY_MINUTES/);
  // O envio manual do corretor (botão do WhatsApp/Chat) não passa pela política de automação.
  for (const manual of ["lib/whatsapp-chat.js", "lib/prospecting.js"]) assert.doesNotMatch(readFileSync(manual, "utf8"), /RECONNECT_SETTLE_MINUTES|aguardando_apos_reconexao/, `${manual} não pode herdar a espera`);
});

/* ------------- Publicação do espalhamento (dono, 2026-10-13): pendentes de hoje com horário antigo ------------- */

test("publicação: pendentes de HOJE gravados antes do espalhamento são reprogramados uma única vez, sem cancelar nem duplicar, sem enviar nada 'para recuperar'", () => {
  const settings = v2({ daily_cap_override: 15 });
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const rolloutMs = now - MIN; // 09:59: 1ª rodada do cron com o código novo (marca gravada em crm_settings)
  const oldWrite = new Date(at(`${MONDAY}T06:31:00-03:00`)).toISOString();
  // Fila montada pelo esquema antigo: 8 pendentes de 5 a 8 min entre si, o 1º já vencendo (10:01) — sairiam em ~1 h.
  const offsets = [1, 7, 13, 20, 26, 31, 38, 44];
  const items = offsets.map((m, i) => ({ id: `old${i}`, attempt_number: (i % 2) + 1, scheduled_for: new Date(now + m * MIN).toISOString(), updated_at: oldWrite }));
  assert.deepEqual(findStaleV2Items(items, { nowMs: now, dateStr: MONDAY, settings }), [], "sem a marca nada seria reprogramado: era o buraco");
  assert.equal(findStaleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, legacyBeforeMs: rolloutMs }).length, 8, "com a marca todos são do esquema antigo");

  const usage = summarizeV2Usage([{ id: "s1", attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - 20 * MIN).toISOString() }]);
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage, random: seeded(21) });
  assert.equal(updates.length, 8, "ninguém cancelado nem perdido");
  assert.equal(new Set(updates.map((u) => u.id)).size, 8, "ninguém duplicado");
  const times = updates.map((u) => u.scheduledMs).sort((a, b) => a - b);
  assert.ok(times[0] >= now && times[0] >= usage.lastSendMs + 5 * MIN, "nada antes de agora nem a menos de 5 min do último envio");
  assert.ok(times.at(-1) <= WINDOW_CLOSE, "tudo até 18:00");
  for (const gap of gapsMin(times)) assert.ok(gap >= 5, "mínimo de 5 min entre dois");
  assert.ok(times.at(-1) - now > 4 * 60 * MIN, "espalhado pelo resto do dia (8 pendentes em 8 h ≈ 1 h entre eles), não em ~1 h como antes");
  assert.ok(mean(gapsMin(times)) > 30, "intervalo médio bem maior que os 5–8 min antigos");

  // Idempotente: o item reprogramado (updated_at = agora) deixa de ser "antigo"; item sem updated_at nunca é tratado como antigo.
  const redone = items.map((item) => ({ ...item, updated_at: new Date(now).toISOString() }));
  assert.deepEqual(findStaleV2Items(redone, { nowMs: now, dateStr: MONDAY, settings, legacyBeforeMs: rolloutMs }), []);
  assert.deepEqual(findStaleV2Items([{ id: "x", scheduled_for: items[0].scheduled_for }], { nowMs: now, dateStr: MONDAY, settings, legacyBeforeMs: rolloutMs }), []);
  // Item de outro dia segue a regra de sempre (dia futuro não é tocado; dia anterior já era reprogramado).
  assert.deepEqual(findStaleV2Items([{ id: "amanha", scheduled_for: "2026-10-06T08:00:00-03:00", updated_at: oldWrite }], { nowMs: now, dateStr: MONDAY, settings, legacyBeforeMs: rolloutMs }), []);
});

test("publicação: o que não cabe hoje (teto do dia e 10/10/10 já descontado o que saiu) passa ao dia seguinte pelos mesmos itens", () => {
  const settings = v2({ daily_cap_override: 15 });
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const oldWrite = new Date(at(`${MONDAY}T06:31:00-03:00`)).toISOString();
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, attempt_number: (i % 2) + 1, scheduled_for: new Date(now + (i + 1) * 6 * MIN).toISOString(), updated_at: oldWrite }));
  const sent = summarizeV2Usage(Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, attempt_number: (i % 2) + 1, source: "meta", status: "sent", send_started_at: new Date(at(`${MONDAY}T06:40:00-03:00`) + i * 6 * MIN).toISOString() })));
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: sent, random: seeded(8) });
  assert.equal(updates.length, 10);
  assert.equal(new Set(updates.map((u) => u.id)).size, 10, "sem duplicar");
  const today = updates.filter((u) => saoPauloDateMinutes(u.scheduledMs).date === MONDAY);
  assert.equal(today.length, 6, "teto 15 com 9 já enviados: só 6 cabem hoje");
  assert.equal(updates.filter((u) => saoPauloDateMinutes(u.scheduledMs).date === "2026-10-06").length, 4, "os outros 4 vão para terça, não são cancelados");
});

test("código: marca da publicação em crm_settings (gravada uma vez), reprogramação usa o caminho existente e nunca força sem a marca", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /const SPREAD_ROLLOUT_SETTING_ID = "daily_goal_spread_rollout"/);
  assert.match(code, /insert\(\{ id: SPREAD_ROLLOUT_SETTING_ID, setting_value: \{ activatedAt \}/);
  assert.match(code, /error\.code !== "23505"/, "se outra rodada gravou antes, vale a dela");
  const resched = code.slice(code.indexOf("async function rescheduleV2Queue"), code.indexOf("// Fila de HOJE pela política v2"));
  assert.match(resched, /\.select\("id, attempt_number, scheduled_for, updated_at"\)/);
  assert.match(resched, /legacyBeforeMs = await loadSpreadRolloutMs\(\)/);
  assert.match(resched, /findStaleV2Items\(pending, \{[^}]*legacyBeforeMs \}\)/);
  assert.match(resched, /\.update\(\{ scheduled_for: new Date\(update\.scheduledMs\)\.toISOString\(\), updated_at: nowIso \}\)\s*\.eq\("id", update\.id\)\.eq\("status", "pending"\)/, "só UPDATE do horário, só de item ainda pendente");
  assert.doesNotMatch(resched, /status: "canceled"|\.delete\(|\.insert\(/, "reprogramar nunca cancela, apaga nem cria item");
  assert.match(resched, /catch \(rolloutError\)[\s\S]{0,400}console\.error/, "falha na marca é registrada, não engolida");
  // A marca é lida ANTES de qualquer item novo ser criado por este código (enqueueTodayItemsV2 chama rescheduleV2Queue primeiro).
  const enqueue = code.slice(code.indexOf("async function enqueueTodayItemsV2"), code.indexOf("async function v2GuardAfterClaim"));
  assert.ok(enqueue.indexOf("await rescheduleV2Queue(brokerId, rawSettingsRow)") < enqueue.indexOf("insert_daily_goal_auto_queue_items"));
});

test("cartão e fila extra: v2 mostra 'média automática ± oscilação' sem 'média máx.' e sem máximo; extra só cede à Meta no mínimo de 5 min", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.doesNotMatch(code, /MAX_GAP_SECONDS/);
  assert.match(code, /maxGapMinutes: policyV2 \? null : row\.max_gap_minutes/);
  assert.match(code, /oscillateEnabled: policyV2 \? true : Boolean\(row\.oscillate_enabled\)/);
  assert.match(code, /oscillatePercent: policyV2 \? v2OscillatePercent\(row\) : \(row\.oscillate_percent \?\? 50\)/);
  assert.match(code, /maxAvgGapMinutes: policyV2 \? null : \(row\.max_avg_gap_minutes \?\? null\)/);
  assert.match(code, /\(policyV2 \? MIN_GAP_SECONDS \/ 60 : gapMinutes\) \* 60000/, "prioridade da Meta só dentro do mínimo de 5 min na v2");
  const admin = readFileSync("components/DailyGoalAdmin.jsx", "utf8");
  assert.doesNotMatch(admin, /15h30|15:30/);
  assert.match(admin, /6h30 às 18h/);
  assert.match(admin, /das 06:30 às 18:00/);
});
