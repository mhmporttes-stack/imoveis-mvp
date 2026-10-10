// Proteções anti-banimento da automação da Meta Diária (WhatsApp individual) — REGRAS PURAS (sem banco, sem
// "server-only"). Testes: tests/daily-goal-protection.test.mjs. Ligação com o banco: lib/daily-goal-auto.js e
// lib/daily-goal-auto-alerts.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-10]
//  1. Pausa automática POR NÚMERO (corretor + número 1/2) quando a sessão recebe 403/"forbidden" ou "logged_out":
//     a automação desse número para, a fila fica guardada, corretor e gestora são avisados, a retomada é MANUAL.
//     NÃO pausa por taxa de entrega (decisão do dono de 2026-10-04 mantida).
//  2. Aquecimento de número novo/reconectado após bloqueio (a regra do teto está em daily-goal-policy-core.mjs).
//  5. Google Contacts: no máximo 3 tentativas de sincronizar por item; na 4ª o envio sai SEM sincronizar.
//  6. Item parado (pendente há mais de 2 h dentro da janela de envio) ou mais de 5 erros seguidos do mesmo tipo:
//     alerta à gestora e ao corretor, uma vez por episódio.
//
// Estado por número: `daily_goal_auto_settings.slot_controls` (jsonb), chave = número ("1" | "2"):
//   { phone, dispatch, warmupStart, paused, pausedAt, pausedKind, pausedCode, pausedReason, episodeAt }

import { isSlotDispatchEnabled, normalizeSlot } from "./whatsapp-session-slots.mjs";
import { resolveResponsibleManager } from "./whatsapp-connection-alert-core.mjs";

export const SLOT_PAUSE_KIND = Object.freeze({ FORBIDDEN: "forbidden", LOGGED_OUT: "logged_out" });
// Sessão que caiu (não conectada): episódio recente de até 72 h ainda conta; já reconectada: só 6 h (cobre
// reconexão rápida entre dois ciclos do cron sem reaproveitar um 403 antigo).
export const INTERVENTION_LOOKBACK_DOWN_MS = 72 * 60 * 60 * 1000;
export const INTERVENTION_LOOKBACK_CONNECTED_MS = 6 * 60 * 60 * 1000;

const msOf = (value) => {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

// Linha de whatsapp_individual_sessions -> { kind, code } | null. 403 = o WhatsApp recusou a conexão
// (`last_error = needs_attention:forbidden...`); logged_out = logout recebido (401).
export function classifySessionIntervention(row) {
  if (!row) return null;
  const error = String(row.last_error || "").toLowerCase();
  const code = Number(row.last_disconnect_code);
  if (error.startsWith("needs_attention:forbidden") || code === 403) return { kind: SLOT_PAUSE_KIND.FORBIDDEN, code: 403 };
  if (error === "logged_out" || code === 401) return { kind: SLOT_PAUSE_KIND.LOGGED_OUT, code: 401 };
  return null;
}

// Intervenções NOVAS (ainda não registradas em slot_controls) entre as linhas de sessão do corretor.
// -> [{ slot, kind, code, episodeAt }]
export function detectSlotInterventions({ sessionRows = [], slotControls = {}, nowMs = Date.now() } = {}) {
  const found = [];
  for (const row of sessionRows || []) {
    const slot = normalizeSlot(row?.slot) || 1;
    if (!isSlotDispatchEnabled(row)) continue; // número que a automação não usa ("Usar para disparo" desligado): nada a pausar
    const intervention = classifySessionIntervention(row);
    if (!intervention) continue;
    const episodeMs = Number.isFinite(msOf(row.last_disconnect_at)) ? msOf(row.last_disconnect_at) : msOf(row.updated_at);
    if (!Number.isFinite(episodeMs)) continue;
    const lookback = row.status === "connected" ? INTERVENTION_LOOKBACK_CONNECTED_MS : INTERVENTION_LOOKBACK_DOWN_MS;
    if (nowMs - episodeMs > lookback) continue;
    const knownMs = msOf(slotControls?.[slot]?.episodeAt);
    if (Number.isFinite(knownMs) && knownMs >= episodeMs) continue; // mesmo episódio (ou anterior) já tratado
    found.push({ slot, ...intervention, episodeAt: new Date(episodeMs).toISOString() });
  }
  return found;
}

export function slotLabel(slot) {
  return normalizeSlot(slot) === 2 ? "Número 2" : "Número 1";
}

export function interventionDescription(kind, slot = 1) {
  const what = kind === SLOT_PAUSE_KIND.FORBIDDEN
    ? "o WhatsApp recusou a conexão (403)"
    : "o WhatsApp foi desconectado (logout)";
  return `${slotLabel(slot)}: ${what}`;
}

export function pauseReasonText(kind, slot = 1) {
  return `Pausado automaticamente — ${interventionDescription(kind, slot)}. Retomada só manual.`;
}

// Grava a pausa nos números com intervenção nova. Devolve uma CÓPIA (nunca altera a entrada).
export function applyInterventionPauses(slotControls, interventions = [], nowIso = new Date().toISOString()) {
  const next = { ...(slotControls && typeof slotControls === "object" ? slotControls : {}) };
  for (const item of interventions) {
    next[item.slot] = {
      ...(next[item.slot] || {}),
      paused: true,
      pausedAt: nowIso,
      pausedKind: item.kind,
      pausedCode: item.code,
      pausedReason: pauseReasonText(item.kind, item.slot),
      episodeAt: item.episodeAt
    };
  }
  return next;
}

// Números aptos ao disparo do corretor (chave "Usar para disparo" ligada) que NÃO estão pausados.
export function activeDispatchSlots(sessionRows = [], slotControls = {}) {
  return (sessionRows || [])
    .filter((row) => row && isSlotDispatchEnabled(row))
    .map((row) => normalizeSlot(row.slot) || 1)
    .filter((slot) => slotControls?.[slot]?.paused !== true);
}

// Pausa o CORRETOR inteiro (mecanismo existente `paused`/`paused_reason`, o que a tela já mostra e o botão "Retomar"
// resolve) quando não sobra nenhum número apto sem pausa: um só número, ou os dois pausados.
export function shouldPauseWholeBroker({ sessionRows = [], slotControls = {} } = {}) {
  const dispatch = (sessionRows || []).filter((row) => row && isSlotDispatchEnabled(row));
  if (!dispatch.length) return false;
  return activeDispatchSlots(sessionRows, slotControls).length === 0;
}

// Números pausados (para a tela e para o filtro do envio). -> [{ slot, reason, at, kind }]
export function listPausedSlots(slotControls = {}) {
  return Object.entries(slotControls && typeof slotControls === "object" ? slotControls : {})
    .filter(([, entry]) => entry?.paused === true)
    .map(([slot, entry]) => ({ slot: normalizeSlot(slot) || 1, reason: entry.pausedReason || "", at: entry.pausedAt || null, kind: entry.pausedKind || null }))
    .sort((a, b) => a.slot - b.slot);
}

// RETOMADA manual. `slots` (opcional) limita a quais números; sem ele, todos os pausados. Quem estava parado por 403
// reinicia o aquecimento no dia da retomada (o tempo parado não conta). -> { controls, resumed: [slot] }
export function clearSlotPauses(slotControls, { todayDate, slots = null } = {}) {
  const next = { ...(slotControls && typeof slotControls === "object" ? slotControls : {}) };
  const resumed = [];
  for (const [key, entry] of Object.entries(next)) {
    const slot = normalizeSlot(key) || 1;
    if (!entry || entry.paused !== true) continue;
    if (Array.isArray(slots) && !slots.map((value) => normalizeSlot(value)).includes(slot)) continue;
    const { paused, pausedAt, pausedKind, pausedCode, pausedReason, alertedAt, ...rest } = entry; // eslint-disable-line no-unused-vars
    next[key] = { ...rest, ...(entry.pausedKind === SLOT_PAUSE_KIND.FORBIDDEN && todayDate ? { warmupStart: todayDate } : {}) };
    resumed.push(slot);
  }
  return { controls: next, resumed };
}

const digits = (value) => String(value || "").replace(/\D/g, "");
const dayOf = (value, fallback) => {
  const ms = msOf(value);
  return Number.isFinite(ms) ? new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) : fallback;
};

// Mantém `slot_controls` em dia com as sessões do corretor (nunca apaga pausa nem episódio):
//  - número que ainda não tinha entrada: se já enviou antes (`hasPriorSendsBySlot`) = estabelecido (sem aquecimento);
//    se nunca enviou e já conectou alguma vez = NOVO, aquecimento desde o dia em que o número foi criado (não o da última reconexão); nunca conectou = sem entrada;
//  - número trocado (telefone diferente do registrado) = número novo, aquecimento recomeça hoje;
//  - atualiza a chave "Usar para disparo". -> { controls, changed }
export function syncSlotControls({ slotControls = {}, sessionRows = [], hasPriorSendsBySlot = {}, todayDate } = {}) {
  const next = { ...(slotControls && typeof slotControls === "object" ? slotControls : {}) };
  let changed = false;
  for (const row of sessionRows || []) {
    const slot = normalizeSlot(row?.slot) || 1;
    const phone = digits(row.phone_number);
    const dispatch = isSlotDispatchEnabled(row);
    const entry = next[slot];
    if (!entry) {
      if (!phone && !row.last_connected_at) continue; // nunca conectou: ainda não há o que acompanhar
      next[slot] = { phone: phone || null, dispatch, warmupStart: hasPriorSendsBySlot[slot] ? null : dayOf(row.created_at || row.last_connected_at, todayDate) };
      changed = true;
      continue;
    }
    const patch = {};
    if (phone && entry.phone && entry.phone !== phone) { patch.phone = phone; patch.warmupStart = todayDate; }
    else if (phone && !entry.phone) patch.phone = phone;
    if (entry.dispatch !== dispatch) patch.dispatch = dispatch;
    if (Object.keys(patch).length) { next[slot] = { ...entry, ...patch }; changed = true; }
  }
  return { controls: next, changed };
}

/* ------------------------------ Google Contacts ------------------------------ */

// [REGRA OFICIAL — dono, 2026-10-10] Erro passageiro do Google (ex.: 502) é tentado no máximo 3 vezes por item/contato;
// na 4ª o envio sai SEM sincronizar. Erro de permissão já é tratado antes (conexão vira "error").
export const GOOGLE_SYNC_MAX_RETRIES = 3;
export const GOOGLE_SYNC_FAILED_REASON = "google_contacts_sync_falhou";
export const GOOGLE_SYNC_SKIPPED_REASON = "google_contacts_ignorado_apos_3_falhas";

export function shouldSkipGoogleSync(priorFailures) {
  return Number(priorFailures) >= GOOGLE_SYNC_MAX_RETRIES;
}

export function googleSkipNote(priorFailures) {
  return `Google Contacts: enviado SEM sincronizar depois de ${Number(priorFailures) || GOOGLE_SYNC_MAX_RETRIES} tentativas com falha.`;
}

/* ----------------------------- Item parado / erros ----------------------------- */

export const STUCK_PENDING_MS = 2 * 60 * 60 * 1000;
export const REPEATED_ERROR_LIMIT = 5; // "mais de 5 erros seguidos" = 6 ou mais

// Há quanto tempo (ms) um item pendente está "devendo" dentro da janela de envio: conta do mais tardio entre o horário
// agendado e a abertura da janela de HOJE, só se agora está dentro da janela e em dia de envio. Fora disso = 0.
export function pendingOverdueMs({ scheduledForMs, nowMs, windowStartMs, windowEndMs, sendingDay = true }) {
  if (!sendingDay || !Number.isFinite(scheduledForMs) || nowMs < windowStartMs || nowMs > windowEndMs) return 0;
  return Math.max(0, nowMs - Math.max(scheduledForMs, windowStartMs));
}

// Itens pendentes parados há mais de 2 h. `items` = [{ id, scheduled_for }]. -> { count, oldestOverdueMs }
export function findStuckPendingItems(items = [], ctx) {
  let count = 0;
  let oldest = 0;
  for (const item of items || []) {
    const overdue = pendingOverdueMs({ ...ctx, scheduledForMs: msOf(item?.scheduled_for) });
    if (overdue > STUCK_PENDING_MS) { count += 1; oldest = Math.max(oldest, overdue); }
  }
  return { count, oldestOverdueMs: oldest };
}

// Motivos pelos quais o ciclo NÃO enviou e a fila parada é ESPERADA (teto do dia, janela, intervalo/pausa, número
// pausado, sessão fora do ar...): nesses casos item pendente atrasado não é "parado", é a política funcionando.
const EXPECTED_HOLDS = new Set([
  "teto_diario_politica", "teto_por_tentativa_politica", "intervalo_minimo_politica", "pausa_programada_politica",
  "aguardando_apos_reconexao", "fora_da_janela", "fim_de_semana", "sessao_nao_conectada", "acesso_whatsapp_bloqueado",
  "numero_pausado_por_bloqueio", "pausado_por_bloqueio", "automacao_desligada_ou_pausada"
]);
export const isExpectedHold = (skipReason) => EXPECTED_HOLDS.has(String(skipReason || ""));

// "Tipo" do erro de um item da fila: motivo sem numeração (falha_destinatario_2_3 -> falha_destinatario) ou o início
// da mensagem de erro sem números.
export function errorTypeKey(row) {
  const reason = String(row?.skip_reason || "").replace(/(_\d+)+$/, "").trim();
  if (reason) return reason;
  const text = String(row?.last_error || "").toLowerCase().replace(/[0-9]+/g, "#").replace(/\s+/g, " ").trim();
  return text.slice(0, 60) || "erro_desconhecido";
}

// `rows` = envios recentes do corretor ([{ status, skip_reason, last_error, at }]) — só 'sent' e 'error' entram.
// Conta, a partir do mais recente, os erros seguidos do MESMO tipo (um 'sent' quebra a sequência).
// -> { typeKey, count, exceeded } (exceeded = mais de 5)
export function consecutiveErrorStreak(rows = []) {
  const ordered = (rows || [])
    .filter((row) => row && (row.status === "sent" || row.status === "error"))
    .sort((a, b) => msOf(b.at) - msOf(a.at));
  if (!ordered.length || ordered[0].status !== "error") return { typeKey: null, count: 0, exceeded: false };
  const typeKey = errorTypeKey(ordered[0]);
  let count = 0;
  for (const row of ordered) {
    if (row.status !== "error" || errorTypeKey(row) !== typeKey) break;
    count += 1;
  }
  return { typeKey, count, exceeded: count > REPEATED_ERROR_LIMIT };
}

/* ---------------------------------- Alertas ---------------------------------- */

export const NUMBER_PAUSED_ALERT_KEY = "daily_goal_number_paused";
export const QUEUE_PROBLEM_ALERT_KEY = "daily_goal_queue_problem";
export const ALERT_LINK = "/admin/meta-diaria";

// Uma vez por episódio: a chave do número pausado inclui o episódio da sessão; a do problema de fila, o dia + o tipo.
export const numberPausedDedupeKey = (brokerId, slot, episodeAt) => `dg_paused:${brokerId}:${normalizeSlot(slot) || 1}:${new Date(episodeAt || 0).toISOString()}`;
export const stuckDedupeKey = (brokerId, date) => `dg_stuck:${brokerId}:${date}`;
export const repeatedErrorDedupeKey = (brokerId, typeKey, date) => `dg_errors:${brokerId}:${typeKey}:${date}`;

// Destinatários: o corretor (se ativo) + a gestora responsável (manager_id; sem gestora = só o corretor).
export function resolveProtectionRecipients(users = [], brokerId = "") {
  const broker = (users || []).find((user) => user.id === brokerId);
  const ids = [];
  if (broker && broker.status !== "inactive" && !broker.disabled_at) ids.push(broker.id);
  const managerId = resolveResponsibleManager(users || [], brokerId);
  if (managerId) ids.push(managerId);
  return [...new Set(ids)];
}

const fill = (template, vars) => String(template || "").replace(/\{([a-z_]+)\}/gi, (_, name) => (vars[name] === undefined || vars[name] === null ? "" : String(vars[name]))).replace(/\s{2,}/g, " ").trim();

export const DEFAULT_PAUSED_TEXT = Object.freeze({
  title: "Disparos pausados por segurança",
  body: "{corretor}: {motivo} A fila foi guardada e nada será enviado por este número até alguém retomar manualmente em Gestão > Meta Diária > Automação."
});
export const DEFAULT_QUEUE_PROBLEM_TEXT = Object.freeze({
  title: "Disparos automáticos com problema",
  body: "{corretor}: {motivo}"
});

export function pausedAlertDeliveries({ definition, recipientIds = [], brokerId, brokerName, slot, kind, episodeAt }) {
  if (!definition?.enabled || !brokerId || !recipientIds.length) return [];
  const body = fill(definition.body_template || DEFAULT_PAUSED_TEXT.body, { corretor: brokerName || "Um corretor", motivo: `${interventionDescription(kind, slot)}.`, numero: slotLabel(slot) });
  return recipientIds.map((recipientId) => ({
    definition_id: definition.id || null,
    recipient_id: recipientId,
    kind: definition.kind === "informative" ? "informative" : "important",
    title: definition.title || DEFAULT_PAUSED_TEXT.title,
    body,
    context: { source: NUMBER_PAUSED_ALERT_KEY, broker_id: brokerId, slot: normalizeSlot(slot) || 1, pause_kind: kind, link: ALERT_LINK },
    dedupe_key: numberPausedDedupeKey(brokerId, slot, episodeAt)
  }));
}

export function queueProblemDeliveries({ definition, recipientIds = [], brokerId, brokerName, problem, motivo, dedupeKey }) {
  if (!definition?.enabled || !brokerId || !recipientIds.length || !dedupeKey || !motivo) return [];
  const body = fill(definition.body_template || DEFAULT_QUEUE_PROBLEM_TEXT.body, { corretor: brokerName || "Um corretor", motivo });
  return recipientIds.map((recipientId) => ({
    definition_id: definition.id || null,
    recipient_id: recipientId,
    kind: definition.kind === "important" ? "important" : "informative",
    title: definition.title || DEFAULT_QUEUE_PROBLEM_TEXT.title,
    body,
    context: { source: QUEUE_PROBLEM_ALERT_KEY, broker_id: brokerId, problem, link: ALERT_LINK },
    dedupe_key: dedupeKey
  }));
}
