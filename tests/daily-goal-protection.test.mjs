import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WARMUP_STEPS, warmupDayNumber, warmupCapForDay, slotDailyCap, brokerWarmupCap, filterSlotsByWarmupCap, applyPolicyV2, dailyCapFor,
  v2EnqueueAllowance, DAILY_CAP, CAP_BY_ATTEMPT
} from "../lib/daily-goal-policy-core.mjs";
import {
  classifySessionIntervention, detectSlotInterventions, applyInterventionPauses, shouldPauseWholeBroker, activeDispatchSlots,
  listPausedSlots, clearSlotPauses, syncSlotControls, shouldSkipGoogleSync, googleSkipNote, GOOGLE_SYNC_MAX_RETRIES,
  pendingOverdueMs, findStuckPendingItems, STUCK_PENDING_MS, errorTypeKey, consecutiveErrorStreak, isExpectedHold,
  resolveProtectionRecipients, pausedAlertDeliveries, queueProblemDeliveries, numberPausedDedupeKey, stuckDedupeKey, repeatedErrorDedupeKey
} from "../lib/daily-goal-protection-core.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-10T10:00:00-03:00"); // sábado

/* --------------------------- Aquecimento (item 2) --------------------------- */

test("aquecimento: 10 nos dias 1–2, 15 nos dias 3–4, 20 nos dias 5–6, 30 do dia 7 em diante", () => {
  assert.deepEqual(WARMUP_STEPS.map((s) => [s.fromDay, s.cap]), [[1, 10], [3, 15], [5, 20], [7, 30]]);
  const caps = [1, 2, 3, 4, 5, 6, 7, 8, 30].map(warmupCapForDay);
  assert.deepEqual(caps, [10, 10, 15, 15, 20, 20, 30, 30, 30]);
  assert.equal(warmupCapForDay(0), DAILY_CAP, "dia inválido nunca restringe");
  assert.equal(warmupCapForDay(null), DAILY_CAP);
});

test("dia do aquecimento conta a partir do dia de início (dia 1 = início); sem início = estabelecido", () => {
  assert.equal(warmupDayNumber("2026-10-10", "2026-10-10"), 1);
  assert.equal(warmupDayNumber("2026-10-10", "2026-10-16"), 7);
  assert.equal(warmupDayNumber("2026-10-10", "2026-10-09"), 1, "início no futuro não passa de dia 1");
  assert.equal(warmupDayNumber(null, "2026-10-10"), null);
  assert.equal(slotDailyCap({ warmupStart: null }, "2026-10-10"), 30);
  assert.equal(slotDailyCap(undefined, "2026-10-10"), 30);
  assert.equal(slotDailyCap({ warmupStart: "2026-10-10" }, "2026-10-12"), 15);
});

test("teto do corretor = soma dos números aptos, no máximo 30; pausado ou sem 'usar para disparo' não entra; sem dado = 30", () => {
  const today = "2026-10-10";
  assert.equal(brokerWarmupCap({}, today), 30);
  assert.equal(brokerWarmupCap(null, today), 30);
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: today } }, today), 10);
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: null } }, today), 30);
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: today }, 2: { dispatch: true, warmupStart: today } }, today), 20);
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: null }, 2: { dispatch: true, warmupStart: today } }, today), 30, "nunca passa de 30");
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: today }, 2: { dispatch: false, warmupStart: null } }, today), 10, "número 2 não usado para disparo não soma");
  assert.equal(brokerWarmupCap({ 1: { dispatch: true, warmupStart: today }, 2: { dispatch: true, paused: true, warmupStart: null } }, today), 10, "pausado não soma");
});

test("applyPolicyV2: o aquecimento só REDUZ o teto (30 e 10/10/10 continuam o máximo) e vale para a alocação da fila", () => {
  const today = "2026-10-10";
  const nowMs = Date.parse(`${today}T10:00:00-03:00`);
  const base = { broker_id: "b1", policy_v2_enabled: true };
  assert.equal(dailyCapFor(applyPolicyV2(base, nowMs)), 30);
  const warm = applyPolicyV2({ ...base, slot_controls: { 1: { dispatch: true, warmupStart: today } } }, nowMs);
  assert.equal(dailyCapFor(warm), 10);
  assert.equal(warm.policy_warmup_cap, 10);
  assert.equal(applyPolicyV2(base, nowMs).policy_warmup_cap, null);
  const manual = applyPolicyV2({ ...base, daily_cap_override: 5, slot_controls: { 1: { dispatch: true, warmupStart: today } } }, nowMs);
  assert.equal(dailyCapFor(manual), 5, "teto manual menor continua valendo");
  const later = applyPolicyV2({ ...base, slot_controls: { 1: { dispatch: true, warmupStart: "2026-10-01" } } }, nowMs);
  assert.equal(dailyCapFor(later), 30, "depois de 7 dias volta ao teto normal");
  const usage = { total: 0, metaByAttempt: { 1: 0, 2: 0, 3: 0 } };
  const allowance = v2EnqueueAllowance({ usage, pendingTodayByAttempt: {}, settings: warm });
  assert.equal(allowance.totalLeft, 10, "a fila de hoje só recebe 10");
  assert.deepEqual(allowance.byAttempt, CAP_BY_ATTEMPT, "10/10/10 por etapa intactos (o total é que limita)");
});

test("dois números: cada um respeita o próprio teto de aquecimento", () => {
  const today = "2026-10-10";
  const controls = { 1: { dispatch: true, warmupStart: null }, 2: { dispatch: true, warmupStart: today } };
  assert.deepEqual(filterSlotsByWarmupCap({ slots: [1, 2], sentTodayBySlot: { 1: 12, 2: 9 }, slotControls: controls, todayDate: today }), [1, 2]);
  assert.deepEqual(filterSlotsByWarmupCap({ slots: [1, 2], sentTodayBySlot: { 1: 12, 2: 10 }, slotControls: controls, todayDate: today }), [1], "número 2 bateu 10");
  assert.deepEqual(filterSlotsByWarmupCap({ slots: [2], sentTodayBySlot: { 2: 50 }, slotControls: controls, todayDate: today }), [2], "um só candidato: quem limita é o teto do corretor");
});

/* ---------------------- Pausa por número (item 1) ---------------------- */

const sess = (extra = {}) => ({ user_id: "b1", slot: 1, dispatch_enabled: null, status: "error", phone_number: null, last_connected_at: "2026-10-09T10:00:00-03:00", last_error: "needs_attention:forbidden: O WhatsApp recusou a conexão (403).", last_disconnect_code: 403, last_disconnect_at: new Date(NOW - 20 * MIN).toISOString(), updated_at: new Date(NOW - 20 * MIN).toISOString(), ...extra });

test("classifica 403/forbidden e logged_out; outras quedas não pausam", () => {
  assert.deepEqual(classifySessionIntervention(sess()), { kind: "forbidden", code: 403 });
  assert.deepEqual(classifySessionIntervention(sess({ last_error: null, last_disconnect_code: 403 })), { kind: "forbidden", code: 403 });
  assert.deepEqual(classifySessionIntervention(sess({ status: "disconnected", last_error: "logged_out", last_disconnect_code: 401 })), { kind: "logged_out", code: 401 });
  assert.equal(classifySessionIntervention(sess({ last_error: "needs_attention:connection_replaced: x", last_disconnect_code: 440 })), null, "440 tem tratamento próprio (alerta de atenção), não pausa");
  assert.equal(classifySessionIntervention(sess({ status: "reconnecting", last_error: "Stream Errored", last_disconnect_code: 428 })), null);
  assert.equal(classifySessionIntervention(sess({ last_error: null, last_disconnect_code: null })), null);
  assert.equal(classifySessionIntervention(null), null);
});

test("detecta só intervenção NOVA, recente e de número que a automação usa", () => {
  const found = detectSlotInterventions({ sessionRows: [sess()], slotControls: {}, nowMs: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].slot, 1);
  assert.equal(found[0].kind, "forbidden");
  // mesmo episódio já registrado: não repete
  assert.deepEqual(detectSlotInterventions({ sessionRows: [sess()], slotControls: { 1: { episodeAt: found[0].episodeAt } }, nowMs: NOW }), []);
  // episódio MAIS novo volta a pausar
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ last_disconnect_at: new Date(NOW - 1 * MIN).toISOString() })], slotControls: { 1: { episodeAt: found[0].episodeAt } }, nowMs: NOW }).length, 1);
  // sessão ainda caída: vale até 72 h; antiga demais não
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ last_disconnect_at: new Date(NOW - 71 * HOUR).toISOString() })], nowMs: NOW }).length, 1);
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ last_disconnect_at: new Date(NOW - 73 * HOUR).toISOString() })], nowMs: NOW }).length, 0);
  // reconectou rápido entre dois ciclos: ainda vale por 6 h, depois não reaproveita 403 antigo
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ status: "connected", last_error: null })], nowMs: NOW }).length, 1);
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ status: "connected", last_error: null, last_disconnect_at: new Date(NOW - 7 * HOUR).toISOString() })], nowMs: NOW }).length, 0);
  // número 2 sem "usar para disparo" (padrão): ignorado; com a chave ligada: detectado como Número 2
  assert.equal(detectSlotInterventions({ sessionRows: [sess({ slot: 2 })], nowMs: NOW }).length, 0);
  const second = detectSlotInterventions({ sessionRows: [sess({ slot: 2, dispatch_enabled: true })], nowMs: NOW });
  assert.equal(second[0].slot, 2);
});

test("pausa vale por número: o outro número segue; sem número apto sobrando o corretor inteiro pausa", () => {
  const rows = [sess({ slot: 1, status: "connected", last_error: null, last_disconnect_code: null }), sess({ slot: 2, dispatch_enabled: true })];
  const found = detectSlotInterventions({ sessionRows: rows, slotControls: {}, nowMs: NOW });
  const controls = applyInterventionPauses({}, found, "2026-10-10T13:00:00.000Z");
  assert.equal(controls[2].paused, true);
  assert.match(controls[2].pausedReason, /Número 2/);
  assert.match(controls[2].pausedReason, /403/);
  assert.equal(controls[1], undefined);
  assert.deepEqual(activeDispatchSlots(rows, controls), [1]);
  assert.equal(shouldPauseWholeBroker({ sessionRows: rows, slotControls: controls }), false);
  assert.deepEqual(listPausedSlots(controls).map((item) => item.slot), [2]);
  // os dois pausados -> corretor inteiro
  const both = applyInterventionPauses(controls, [{ slot: 1, kind: "logged_out", code: 401, episodeAt: "2026-10-10T12:00:00.000Z" }], "2026-10-10T13:05:00.000Z");
  assert.equal(shouldPauseWholeBroker({ sessionRows: rows, slotControls: both }), true);
  // um só número: pausa o corretor
  assert.equal(shouldPauseWholeBroker({ sessionRows: [sess()], slotControls: applyInterventionPauses({}, found, "x") }), false, "número 1 sem pausa registrada ainda");
  assert.equal(shouldPauseWholeBroker({ sessionRows: [sess()], slotControls: applyInterventionPauses({}, [{ slot: 1, kind: "forbidden", code: 403, episodeAt: "2026-10-10T12:00:00.000Z" }], "x") }), true);
  assert.equal(shouldPauseWholeBroker({ sessionRows: [], slotControls: {} }), false);
  // entrada não é alterada
  assert.deepEqual(applyInterventionPauses(Object.freeze({}), found, "x")[2].paused, true);
});

test("retomada é manual: libera os números; quem foi bloqueado (403) reinicia o aquecimento hoje, logout não", () => {
  const controls = applyInterventionPauses({ 1: { phone: "5511", dispatch: true, warmupStart: null }, 2: { dispatch: true, warmupStart: null } }, [
    { slot: 1, kind: "forbidden", code: 403, episodeAt: "2026-10-10T12:00:00.000Z" },
    { slot: 2, kind: "logged_out", code: 401, episodeAt: "2026-10-10T12:00:00.000Z" }
  ], "2026-10-10T13:00:00.000Z");
  const only1 = clearSlotPauses(controls, { todayDate: "2026-10-12", slots: [1] });
  assert.deepEqual(only1.resumed, [1]);
  assert.equal(only1.controls[1].paused, undefined);
  assert.equal(only1.controls[1].warmupStart, "2026-10-12");
  assert.equal(only1.controls[1].episodeAt, "2026-10-10T12:00:00.000Z", "o episódio fica: o mesmo 403 não pausa de novo");
  assert.equal(only1.controls[2].paused, true);
  const all = clearSlotPauses(controls, { todayDate: "2026-10-12" });
  assert.deepEqual(all.resumed, [1, 2]);
  assert.equal(all.controls[2].warmupStart, null, "logout não reinicia o aquecimento");
  assert.deepEqual(clearSlotPauses({}, { todayDate: "2026-10-12" }).resumed, []);
  // depois de retomar, o mesmo episódio não volta a pausar
  assert.deepEqual(detectSlotInterventions({ sessionRows: [sess({ last_disconnect_at: "2026-10-10T12:00:00.000Z" })], slotControls: all.controls, nowMs: NOW }), []);
});

test("acompanhamento dos números: estabelecido (já enviou) sem aquecimento, novo com aquecimento, número trocado recomeça, nunca conectou sem entrada", () => {
  const today = "2026-10-10";
  const rows = [
    sess({ slot: 1, status: "connected", phone_number: "5511911111111", last_error: null, last_disconnect_code: null }),
    sess({ slot: 2, dispatch_enabled: true, status: "connected", phone_number: "5511922222222", last_connected_at: "2026-10-10T08:00:00-03:00", last_error: null, last_disconnect_code: null })
  ];
  const first = syncSlotControls({ slotControls: {}, sessionRows: rows, hasPriorSendsBySlot: { 1: true, 2: false }, todayDate: today });
  assert.equal(first.changed, true);
  assert.equal(first.controls[1].warmupStart, null, "Número 1 já enviava: estabelecido");
  assert.equal(first.controls[2].warmupStart, "2026-10-10", "Número 2 novo: aquecimento desde a 1ª conexão");
  assert.equal(first.controls[1].dispatch, true);
  assert.equal(syncSlotControls({ slotControls: first.controls, sessionRows: rows, hasPriorSendsBySlot: {}, todayDate: today }).changed, false, "idempotente");
  const swapped = syncSlotControls({ slotControls: first.controls, sessionRows: [{ ...rows[0], phone_number: "5511933333333" }, rows[1]], todayDate: "2026-10-14" });
  assert.equal(swapped.controls[1].warmupStart, "2026-10-14", "número trocado = número novo");
  assert.equal(swapped.controls[2].warmupStart, "2026-10-10");
  const never = syncSlotControls({ slotControls: {}, sessionRows: [sess({ slot: 2, phone_number: null, last_connected_at: null, status: "disconnected", last_error: null })], todayDate: today });
  assert.deepEqual(never.controls, {});
  const disconnectedPhone = syncSlotControls({ slotControls: first.controls, sessionRows: [{ ...rows[0], phone_number: null }], todayDate: today });
  assert.equal(disconnectedPhone.controls[1].phone, first.controls[1].phone, "telefone vazio (desconectado) não conta como troca");
});

/* ---------------------- Google Contacts (item 5) ---------------------- */

test("Google Contacts: 3 falhas por item/contato; na 4ª o envio sai sem sincronizar, com nota", () => {
  assert.equal(GOOGLE_SYNC_MAX_RETRIES, 3);
  assert.deepEqual([0, 1, 2, 3, 4].map(shouldSkipGoogleSync), [false, false, false, true, true]);
  assert.match(googleSkipNote(3), /SEM sincronizar/);
  assert.match(googleSkipNote(3), /3 tentativas/);
});

/* ---------------------- Item parado e erros seguidos (item 6) ---------------------- */

const win = { windowStartMs: Date.parse("2026-10-10T06:30:00-03:00"), windowEndMs: Date.parse("2026-10-10T15:30:00-03:00"), sendingDay: true };

test("item parado: conta só o tempo DENTRO da janela de hoje, só com a janela aberta e em dia de envio", () => {
  const at = (hhmm) => Date.parse(`2026-10-10T${hhmm}:00-03:00`);
  // agendado ontem à noite: conta a partir da abertura (06:30)
  assert.equal(pendingOverdueMs({ ...win, scheduledForMs: Date.parse("2026-10-09T14:00:00-03:00"), nowMs: at("09:00") }), 150 * MIN);
  // agendado hoje 07:00, agora 09:30
  assert.equal(pendingOverdueMs({ ...win, scheduledForMs: at("07:00"), nowMs: at("09:30") }), 150 * MIN);
  assert.equal(pendingOverdueMs({ ...win, scheduledForMs: at("07:00"), nowMs: at("16:00") }), 0, "janela fechada");
  assert.equal(pendingOverdueMs({ ...win, scheduledForMs: at("07:00"), nowMs: at("06:00") }), 0, "janela ainda não abriu");
  assert.equal(pendingOverdueMs({ ...win, sendingDay: false, scheduledForMs: at("07:00"), nowMs: at("09:30") }), 0, "domingo");
  assert.equal(pendingOverdueMs({ ...win, scheduledForMs: NaN, nowMs: at("09:30") }), 0);
  const items = [{ scheduled_for: "2026-10-10T07:00:00-03:00" }, { scheduled_for: "2026-10-10T09:00:00-03:00" }, { scheduled_for: "2026-10-10T08:25:00-03:00" }];
  const stuck = findStuckPendingItems(items, { ...win, nowMs: at("09:30") });
  assert.equal(stuck.count, 1, "só o das 07:00 passa de 2 h (o das 08:25 tem 65 min; o das 09:00, 30 min)");
  assert.equal(stuck.oldestOverdueMs, 150 * MIN);
  assert.equal(STUCK_PENDING_MS, 2 * HOUR);
  assert.equal(findStuckPendingItems([{ scheduled_for: "2026-10-10T07:30:00-03:00" }], { ...win, nowMs: at("09:30") }).count, 0, "exatamente 2 h não é 'mais de 2 h'");
});

test("erros seguidos do mesmo tipo: mais de 5 alertam; tipo diferente ou um envio com sucesso quebra a sequência", () => {
  const row = (status, reasonOrError, minutesAgo, field = "skip_reason") => ({ status, [field]: reasonOrError, at: new Date(NOW - minutesAgo * MIN).toISOString() });
  const errors = (n, reason = "falha_destinatario_1_3") => Array.from({ length: n }, (_, i) => row("error", reason, i + 1));
  assert.equal(errorTypeKey({ skip_reason: "falha_destinatario_2_3" }), "falha_destinatario");
  assert.equal(errorTypeKey({ skip_reason: "google_contacts_sync_falhou" }), "google_contacts_sync_falhou");
  assert.equal(errorTypeKey({ last_error: "Erro 502 do servidor 10.0.0.1" }), "erro # do servidor #.#.#.#");
  assert.deepEqual(consecutiveErrorStreak(errors(5)), { typeKey: "falha_destinatario", count: 5, exceeded: false });
  assert.deepEqual(consecutiveErrorStreak(errors(6)), { typeKey: "falha_destinatario", count: 6, exceeded: true });
  const mixedType = [...errors(3), ...errors(3, "google_contacts_sync_falhou").map((r, i) => ({ ...r, at: new Date(NOW - (10 + i) * MIN).toISOString() }))];
  assert.equal(consecutiveErrorStreak(mixedType).exceeded, false, "tipos diferentes não somam");
  const broken = [...errors(3), row("sent", null, 4.5), ...errors(4).map((r, i) => ({ ...r, at: new Date(NOW - (10 + i) * MIN).toISOString() }))];
  assert.equal(consecutiveErrorStreak(broken).count, 3, "um envio com sucesso quebra a sequência");
  assert.equal(consecutiveErrorStreak([row("sent", null, 1), ...errors(6).map((r, i) => ({ ...r, at: new Date(NOW - (5 + i) * MIN).toISOString() }))]).exceeded, false, "o mais recente foi sucesso");
  assert.deepEqual(consecutiveErrorStreak([]), { typeKey: null, count: 0, exceeded: false });
  assert.equal(consecutiveErrorStreak([row("skipped", "x", 1), ...errors(6).map((r, i) => ({ ...r, at: new Date(NOW - (5 + i) * MIN).toISOString() }))]).count, 6, "item pulado não entra na conta");
});

test("retenção esperada (teto, janela, intervalo, número pausado) não conta como item parado", () => {
  for (const reason of ["teto_diario_politica", "fora_da_janela", "intervalo_minimo_politica", "numero_pausado_por_bloqueio", "sessao_nao_conectada", "fim_de_semana", "pausa_programada_politica"]) assert.equal(isExpectedHold(reason), true, reason);
  for (const reason of ["fila_vazia", "falha_infraestrutura", "erro_inesperado", "", undefined, "muitos_itens_descartados_seguidos"]) assert.equal(isExpectedHold(reason), false, String(reason));
});

/* ---------------------------- Alertas (itens 1 e 6) ---------------------------- */

const users = [
  { id: "g1", name: "Caroline", role: "manager", status: "active", manager_id: null, linked_broker_id: null, disabled_at: null },
  { id: "b1", name: "Bruna Santos", role: "broker", status: "active", manager_id: "g1", linked_broker_id: null, disabled_at: null },
  { id: "b2", name: "Sem Gestora", role: "broker", status: "active", manager_id: null, linked_broker_id: null, disabled_at: null },
  { id: "b3", name: "Inativo", role: "broker", status: "inactive", manager_id: "g1", linked_broker_id: null, disabled_at: null }
];

test("destinatários: o corretor + a gestora responsável; sem gestora só o corretor; corretor inativo só a gestora", () => {
  assert.deepEqual(resolveProtectionRecipients(users, "b1"), ["b1", "g1"]);
  assert.deepEqual(resolveProtectionRecipients(users, "b2"), ["b2"]);
  assert.deepEqual(resolveProtectionRecipients(users, "b3"), ["g1"]);
  assert.deepEqual(resolveProtectionRecipients(users, "nao-existe"), []);
});

test("alerta de número pausado: importante, ao corretor e à gestora, uma vez por episódio, sem telefone", () => {
  const definition = { id: "d1", enabled: true, kind: "important", title: "Disparos pausados por segurança", body_template: "{corretor}: {motivo} Fila guardada." };
  const list = pausedAlertDeliveries({ definition, recipientIds: ["b1", "g1"], brokerId: "b1", brokerName: "Bruna Santos", slot: 2, kind: "forbidden", episodeAt: "2026-10-10T12:00:00.000Z" });
  assert.equal(list.length, 2);
  assert.ok(list.every((d) => d.kind === "important" && /Bruna Santos/.test(d.body) && /Número 2/.test(d.body) && /403/.test(d.body)));
  assert.deepEqual(list.map((d) => d.recipient_id), ["b1", "g1"]);
  assert.equal(list[0].dedupe_key, numberPausedDedupeKey("b1", 2, "2026-10-10T12:00:00.000Z"));
  assert.notEqual(numberPausedDedupeKey("b1", 1, "2026-10-10T12:00:00.000Z"), numberPausedDedupeKey("b1", 2, "2026-10-10T12:00:00.000Z"));
  assert.doesNotMatch(list[0].body, /\d{10,}/);
  assert.deepEqual(pausedAlertDeliveries({ definition: { ...definition, enabled: false }, recipientIds: ["b1"], brokerId: "b1", slot: 1, kind: "forbidden", episodeAt: "x" }), [], "definição desligada: nada");
  assert.deepEqual(pausedAlertDeliveries({ definition: null, recipientIds: ["b1"], brokerId: "b1", slot: 1, kind: "forbidden", episodeAt: "x" }), [], "definição ausente: nada");
});

test("alerta de problema na fila: informativo, uma chave por dia (e por tipo de erro)", () => {
  const definition = { id: "d2", enabled: true, kind: "informative", title: "Disparos automáticos com problema", body_template: "{corretor}: {motivo}" };
  const list = queueProblemDeliveries({ definition, recipientIds: ["b1", "g1"], brokerId: "b1", brokerName: "Bruna Santos", problem: "stuck", motivo: "3 mensagens paradas.", dedupeKey: stuckDedupeKey("b1", "2026-10-10") });
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, "informative");
  assert.equal(list[0].body, "Bruna Santos: 3 mensagens paradas.");
  assert.equal(list[0].dedupe_key, "dg_stuck:b1:2026-10-10");
  assert.notEqual(repeatedErrorDedupeKey("b1", "falha_destinatario", "2026-10-10"), repeatedErrorDedupeKey("b1", "google_contacts_sync_falhou", "2026-10-10"));
  assert.deepEqual(queueProblemDeliveries({ definition, recipientIds: [], brokerId: "b1", problem: "stuck", motivo: "x", dedupeKey: "k" }), []);
});

/* ------------------------- Ligação no código (proteções de regra) ------------------------- */

test("ligação: cron aplica a proteção antes de gerar/enviar; retomada manual limpa os números; monitor continua sem pausar", () => {
  const code = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(code, /row = await applySessionProtections\(row\)/);
  assert.match(code, /skipped: "pausado_por_bloqueio"/);
  assert.match(code, /numero_pausado_por_bloqueio/);
  assert.match(code, /slotResumePatch\(/);
  assert.match(code, /countGoogleSyncFailures\(item\)/);
  assert.match(code, /runQueueHealthCheck\(/);
  const protection = readFileSync("lib/daily-goal-protection-core.mjs", "utf8");
  assert.doesNotMatch(protection.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"), /delivered_at|taxa de entrega/, "pausa NUNCA por taxa de entrega (decisão do dono, 2026-10-04)");
  const migration = readFileSync("supabase/migrations/20261010140000_daily_goal_protecoes_anti_banimento.sql", "utf8");
  assert.match(migration, /add column if not exists slot_controls/);
  assert.match(migration, /on conflict \(key\) do nothing/);
  assert.doesNotMatch(migration, /\b(drop|delete|truncate|update)\b\s/i);
});
