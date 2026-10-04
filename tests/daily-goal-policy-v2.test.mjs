import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAILY_CAP, CAP_BY_ATTEMPT, WINDOW_START_MINUTES, WINDOW_END_MINUTES, MIN_GAP_SECONDS, MAX_GAP_SECONDS,
  PAUSE_EVERY_MIN, PAUSE_EVERY_MAX, PAUSE_MIN_MINUTES, PAUSE_MAX_MINUTES, RECONNECT_DELAY_MINUTES,
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
const wide = (extra = {}) => applyPolicyV2({ ...settingsBase, window_start_minutes: 390, window_end_minutes: 930, min_gap_minutes: 0, max_gap_minutes: 0, ...extra });
const emptyUsage = () => summarizeV2Usage([]);

test("constantes da política v2 (REGRA OFICIAL 2026-10-04)", () => {
  assert.equal(DAILY_CAP, 30);
  assert.deepEqual({ ...CAP_BY_ATTEMPT }, { 1: 10, 2: 10, 3: 10 });
  assert.equal(WINDOW_START_MINUTES, 6 * 60 + 30);
  assert.equal(WINDOW_END_MINUTES, 15 * 60 + 30);
  assert.equal(MIN_GAP_SECONDS, 300, "mínimo 5 min");
  assert.equal(MAX_GAP_SECONDS, 480);
  assert.equal(PAUSE_EVERY_MIN, 8);
  assert.equal(PAUSE_EVERY_MAX, 12);
  assert.equal(PAUSE_MIN_MINUTES, 15);
  assert.equal(PAUSE_MAX_MINUTES, 30);
  assert.equal(RECONNECT_DELAY_MINUTES, 5);
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

test("janela: v2 usa SEMPRE 06:30–15:30; os valores antigos do banco (07–14) não prevalecem", () => {
  for (const extra of [{}, { window_start_minutes: 420, window_end_minutes: 840 }, { window_start_minutes: 300, window_end_minutes: 1260 }]) {
    const r = v2(extra);
    assert.deepEqual([r.window_start_minutes, r.window_end_minutes], [390, 930]);
    assert.deepEqual([r.min_gap_minutes, r.max_gap_minutes], [5, 8]);
  }
  assert.equal(v2().oscillate_enabled, false, "oscilação antiga é ignorada na v2");
  assert.equal(v2({ business_days_only: false }).business_days_only, true, "domingo sempre bloqueado na v2");
});

test("janela 06:30–15:30 seg–sáb: domingo e fora de horário não tentam (fuso São Paulo)", () => {
  const s = wide();
  const reason = (iso) => sendBlockReason({ scheduledFor: iso, now: new Date(iso), settings: s });
  assert.equal(reason(`${MONDAY}T06:29:00-03:00`), "fora_da_janela");
  assert.equal(reason(`${MONDAY}T06:30:00-03:00`), null);
  assert.equal(reason(`${MONDAY}T15:30:00-03:00`), null);
  assert.equal(reason(`${MONDAY}T15:31:00-03:00`), "fora_da_janela");
  assert.equal(reason("2026-10-03T10:00:00-03:00"), null, "sábado envia");
  assert.equal(reason("2026-10-04T10:00:00-03:00"), "fim_de_semana", "domingo bloqueado");
  // Fuso: 09:35 UTC de segunda = 06:35 em São Paulo (dentro); 09:25 UTC = 06:25 (fora).
  assert.equal(reason(`${MONDAY}T09:35:00Z`), null);
  assert.equal(reason(`${MONDAY}T09:25:00Z`), "fora_da_janela");
});

test("intervalo: SEMPRE 5 a 8 min na v2, independente do banco (antigo 5–10, zerado, frouxo ou restrito)", () => {
  for (const row of [{ min_gap_minutes: 0, max_gap_minutes: 0 }, {}, { min_gap_minutes: 1, max_gap_minutes: 1 }, { min_gap_minutes: 5, max_gap_minutes: 10 }, { min_gap_minutes: 20, max_gap_minutes: 40 }]) {
    assert.deepEqual(effectiveGapSeconds(row), { minSeconds: 300, maxSeconds: 480 });
    assert.deepEqual(applyPolicyV2(row).policy_gap_seconds, { minSeconds: 300, maxSeconds: 480 });
  }
  const plan = planV2Schedule({ count: 25, nowMs: 0, dateStr: MONDAY, settings: wide({ oscillate_enabled: true, oscillate_percent: 90 }), random: seeded(5) });
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i] - plan[i - 1] >= 300 * 1000, `intervalo ${i} >= 5 min`);
});

test("planejamento: dentro da janela, espaçado (<=8 min fora das pausas), pausa de 15–30 min a cada 8–12 envios, nunca 2 no mesmo minuto", () => {
  for (const seed of [1, 2, 3, 7, 11, 42]) {
    const settings = wide();
    const plan = planV2Schedule({ count: 30, nowMs: 0, dateStr: MONDAY, settings, random: seeded(seed) });
    assert.equal(plan.length, 30, "30 mensagens cabem na janela de 9 h");
    const start = saoPauloInstantMs(MONDAY, 390);
    const end = saoPauloInstantMs(MONDAY, 930);
    assert.ok(plan[0] >= start && plan.at(-1) <= end, "tudo dentro de 06:30–15:30");
    const minutes = new Set(plan.map((ms) => Math.floor(ms / MIN)));
    assert.equal(minutes.size, plan.length, "nunca dois no mesmo minuto");
    let run = 1;
    const runs = [];
    for (let i = 1; i < plan.length; i += 1) {
      const gap = plan[i] - plan[i - 1];
      assert.ok(gap >= 300 * 1000 - 1000, "mínimo 5 min");
      if (gap >= PAUSE_MIN_MINUTES * MIN) {
        assert.ok(gap <= PAUSE_MAX_MINUTES * MIN + 1000, "pausa de até 30 min");
        runs.push(run);
        run = 1;
      } else {
        assert.ok(gap <= 8 * 60 * 1000 + 1000, "fora da pausa, no máximo 8 min");
        run += 1;
      }
    }
    for (const r of runs) assert.ok(r >= PAUSE_EVERY_MIN && r <= PAUSE_EVERY_MAX, `pausa a cada ${PAUSE_EVERY_MIN}–${PAUSE_EVERY_MAX} envios (viu ${r})`);
    assert.ok(runs.length >= 2, "30 envios têm pelo menos 2 pausas");
  }
});

test("planejamento respeita o último envio e a reconexão; nunca antes de agora; o que não cabe sai da lista", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const plan = planV2Schedule({ count: 5, nowMs: now, dateStr: MONDAY, settings: wide(), lastSendMs: now - 30 * 1000, random: seeded(3) });
  assert.ok(plan[0] >= now + 270 * 1000 - 1000, "último envio há 30 s: espera até completar 5 min");
  const afterConnect = planV2Schedule({ count: 3, nowMs: now, dateStr: MONDAY, settings: wide(), connectedAtMs: now - MIN, random: seeded(3) });
  assert.ok(afterConnect[0] >= now - MIN + 5 * MIN, "1º envio só 5 min depois de conectar");
  const late = planV2Schedule({ count: 40, nowMs: at(`${MONDAY}T15:00:00-03:00`), dateStr: MONDAY, settings: wide(), random: seeded(3) });
  assert.ok(late.length > 0 && late.length < 40, "perto do fim da janela só cabe parte");
  assert.ok(late.every((ms) => ms <= saoPauloInstantMs(MONDAY, 930)));
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

test("fila do dia: 10 na 1ª, 10 na 2ª, 10 na 3ª (30 no total) a partir de qualquer volume", () => {
  const cands = [];
  for (let i = 0; i < 50; i += 1) for (const attempt of [1, 2, 3]) cands.push({ attempt, id: `${attempt}-${i}` });
  const allowance = v2EnqueueAllowance({ usage: emptyUsage(), pendingTodayByAttempt: {}, settings: v2() });
  const picked = pickV2EnqueueCandidates(cands, allowance);
  assert.equal(picked.length, 30);
  for (const a of [1, 2, 3]) assert.equal(picked.filter((c) => c.attempt === a).length, 10);
  // Já saiu 4 da 1ª e há 3 pendentes da 2ª hoje: sobram 6/7/10, total 30-7=23 -> 6+7+10.
  const usage = summarizeV2Usage(Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, attempt_number: 1, source: "meta", status: "sent", send_started_at: `${MONDAY}T07:0${i}:00-03:00` })));
  const al2 = v2EnqueueAllowance({ usage, pendingTodayByAttempt: { 2: 3 }, settings: v2() });
  assert.deepEqual(al2.byAttempt, { 1: 6, 2: 7, 3: 10 });
  assert.equal(al2.totalLeft, 23);
  const picked2 = pickV2EnqueueCandidates(cands, al2);
  assert.equal(picked2.length, 23);
  // Menos candidatos que a cota: não inventa.
  assert.equal(pickV2EnqueueCandidates([{ attempt: 1 }, { attempt: 3 }], allowance).length, 2);
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
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve(10), settings: wide() }), "pausa_programada_politica");
  assert.equal(v2SendBlockReason({ nowMs: now, usage: twelve(16), settings: wide() }), null);
  // Duas execuções do cron "ao mesmo tempo": a segunda enxerga o envio da primeira (exclui só o próprio item).
  const first = [{ id: "A", attempt_number: 1, source: "meta", status: "sent", send_started_at: new Date(now - 2000).toISOString() }, { id: "B", attempt_number: 2, source: "meta", status: "sending", send_started_at: null }];
  assert.equal(v2SendBlockReason({ nowMs: now, usage: summarizeV2Usage(first, { excludeItemId: "B" }), settings: wide() }), "intervalo_minimo_politica");
});

test("reconexão: nada de rajada — espera 5 min depois de conectar", () => {
  const now = at(`${MONDAY}T10:00:00-03:00`);
  assert.equal(v2SendBlockReason({ nowMs: now, usage: emptyUsage(), settings: wide(), connectedAtMs: now - 3 * MIN }), "aguardando_apos_reconexao");
  assert.equal(v2SendBlockReason({ nowMs: now, usage: emptyUsage(), settings: wide(), connectedAtMs: now - 6 * MIN }), null);
  assert.equal(v2SendBlockReason({ nowMs: now, usage: emptyUsage(), settings: wide(), connectedAtMs: null }), null);
});

test("reconexão: atrasados são REPROGRAMADOS (não saem de uma vez): espaçados, sem passado, nunca 2 no mesmo minuto, depois de conectar + 5 min", () => {
  const settings = wide();
  const now = at(`${MONDAY}T10:00:00-03:00`);
  const connectedAtMs = now - 2 * MIN; // reconectou há 2 min, depois de horas fora
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, attempt_number: (i % 3) + 1, scheduled_for: new Date(now - (180 - i * 10) * MIN).toISOString() }));
  const stale = findStaleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, connectedAtMs });
  assert.equal(stale.length, 12, "todos estão atrasados além da tolerância");
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: emptyUsage(), connectedAtMs, random: seeded(9) });
  assert.equal(updates.length, 12, "ninguém é cancelado nem perdido");
  assert.equal(new Set(updates.map((u) => u.id)).size, 12, "sem duplicar");
  const times = updates.map((u) => u.scheduledMs);
  assert.ok(times.every((ms) => ms >= connectedAtMs + 5 * MIN && ms >= now), "nenhum no passado nem antes de conectar + 5 min");
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
    mk("fora_da_janela", `${MONDAY}T16:30:00-03:00`),
    mk("atrasado", `${MONDAY}T09:40:00-03:00`),
    mk("no_horario", `${MONDAY}T09:58:00-03:00`),
    mk("futuro", `${MONDAY}T10:20:00-03:00`),
    mk("amanha", "2026-10-06T07:00:00-03:00"),
    mk("invalido", "nao-e-data")
  ], { nowMs: now, dateStr: MONDAY, settings });
  assert.deepEqual(stale.sort(), ["atrasado", "fora_da_janela", "invalido", "ontem"].sort());
  const gate = findStaleV2Items([mk("segurado", `${MONDAY}T09:58:00-03:00`)], { nowMs: now, dateStr: MONDAY, settings, connectedAtMs: now - 2 * MIN });
  assert.deepEqual(gate, ["segurado"], "venceu enquanto a sessão reconectava: reprograma");
});

test("fila passa ao dia seguinte sem duplicar, respeitando 30/dia e 10/10/10; domingo vai para segunda", () => {
  const settings = wide();
  const now = at(`${MONDAY}T14:30:00-03:00`);
  const items = Array.from({ length: 45 }, (_, i) => ({ id: `q${i}`, attempt_number: (i % 3) + 1, scheduled_for: `${MONDAY}T07:${String(i).padStart(2, "0")}:00-03:00` }));
  const updates = rescheduleV2Items(items, { nowMs: now, dateStr: MONDAY, settings, usage: emptyUsage(), random: seeded(4) });
  assert.equal(updates.length, 45);
  assert.equal(new Set(updates.map((u) => u.id)).size, 45, "sem duplicar");
  const byDay = new Map();
  for (const u of updates) {
    const day = saoPauloDateMinutes(u.scheduledMs);
    assert.notEqual(day.weekday, 0, "nunca domingo");
    assert.ok(day.minutes >= 390 && day.minutes <= 930, "sempre dentro da janela");
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

test("fila extra na v2: mesma janela 06:30–15:30, nunca domingo; sem a v2 segue 07:00–21:00", () => {
  const settings = { enabled: true, paused: false, business_days_only: true };
  const window = { startMinutes: 390, endMinutes: 930 };
  const r = (iso, policyWindow) => extraSendBlockReason({ now: new Date(iso), settings, policyWindow });
  assert.equal(r(`${MONDAY}T06:40:00-03:00`, window), null);
  assert.equal(r(`${MONDAY}T06:40:00-03:00`, null), "fora_do_horario_extra", "regra antiga intacta");
  assert.equal(r(`${MONDAY}T15:40:00-03:00`, window), "fora_do_horario_extra");
  assert.equal(r(`${MONDAY}T15:40:00-03:00`, null), null, "regra antiga intacta (até 21h)");
  assert.equal(r("2026-10-04T10:00:00-03:00", window), "fim_de_semana");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-04T10:00:00-03:00"), settings: { ...settings, business_days_only: false }, policyWindow: window }), "fim_de_semana", "v2 nunca envia no domingo");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-04T10:00:00-03:00"), settings: { ...settings, business_days_only: false } }), null, "regra antiga intacta");
  const s = v2();
  for (const seed of ["a", "b", "item-123", "zzz", "x".repeat(40)]) {
    const gap = extraGapSecondsV2(seed, s);
    assert.ok(gap >= s.policy_gap_seconds.minSeconds && gap <= s.policy_gap_seconds.maxSeconds);
    assert.equal(gap, extraGapSecondsV2(seed, s), "estável entre ciclos do cron");
  }
  assert.ok(extraGapSecondsV2("abc", applyPolicyV2({ min_gap_minutes: 0, max_gap_minutes: 0 })) >= 300);
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
  assert.deepEqual(plan.byAttempt, { 1: { kept: 10, trimmed: 10 }, 2: { kept: 10, trimmed: 9 }, 3: { kept: 10, trimmed: 34 } });
  assert.equal(plan.trimIds.length, 53);
  const kept = items.filter((i) => !plan.trimIds.includes(i.id));
  assert.equal(kept.length, 30, "30 por corretor no máximo (10+10+10)");
  for (const attempt of [1, 2, 3]) {
    const keptIds = kept.filter((i) => i.attempt_number === attempt).map((i) => i.id).sort();
    assert.deepEqual(keptIds, items.filter((i) => i.attempt_number === attempt).slice(0, 10).map((i) => i.id), "ficam os 10 mais prioritários (horário mais cedo)");
  }
  assert.deepEqual(planV2Trim(kept).trimIds, [], "idempotente: rodar de novo não retira nada");
});

test("limpeza do excesso: sem empréstimo entre tentativas (10 + 6 + 10 = 26, nunca 30) e desempate por created_at", () => {
  const same = "2026-10-03T10:00:00.000Z";
  const mk = (attempt, n) => Array.from({ length: n }, (_, i) => ({ id: `b${attempt}-${i}`, attempt_number: attempt, scheduled_for: same, created_at: new Date(Date.UTC(2026, 9, 3, 9, i)).toISOString() }));
  const plan = planV2Trim([...mk(1, 10), ...mk(2, 6), ...mk(3, 10)]);
  assert.deepEqual(plan.trimIds, []);
  assert.deepEqual(plan.byAttempt, { 1: { kept: 10, trimmed: 0 }, 2: { kept: 6, trimmed: 0 }, 3: { kept: 10, trimmed: 0 } });
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
