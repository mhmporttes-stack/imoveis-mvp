import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertCanAccessResponsibleUser, assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";
import { resolveTeamVisibilityScope } from "./admin-profiles";
import { isOwnerAdminEmail } from "./admin-auth";
import { registerDailyGoalAttemptAutomated, getDailyGoalAutoMessages, isContactBlockedFromOutreach, ensureDailyGoalGeneratedForBroker } from "./daily-goal";
import { getTimeGreeting, getTodayInSaoPaulo } from "./daily-report";
import { getDispatchSessionState, getDispatchSessionStatusForUser, sendIndividualMessage } from "./whatsapp-individual";
import { dispatchSlots, groupSessionRowsByUser, isSlotDispatchEnabled, normalizeSlot, pickDispatchSlot, representativeSessionRow } from "./whatsapp-session-slots.mjs";
import { endRestrictionIfConnected, listOpenRestrictions } from "./whatsapp-restriction";
import { pickSendChannel } from "./whatsapp-individual-routing.mjs";
import { isSessionOperational } from "./prospecting-eligibility-core.mjs";
import { listWhatsappBlockedUserIds } from "./whatsapp-access";
import { WHATSAPP_ACCESS_BLOCKED_CODE } from "./whatsapp-access-core.mjs";
import { withEffectiveWindow } from "./daily-goal-window";
import { listGoogleContactsStatuses, isGoogleContactsSyncEnabledForBroker, ensureClientInBrokerContacts } from "./google-contacts";
import {
  computeDailyAutoCap,
  shuffleArray,
  spreadScheduleMinutes,
  isWithinWindow,
  isBusinessDay,
  pickAntiRepeatVariant,
  hasUnresolvedVariable,
  wasVariantActuallySent,
  classifySendError,
  renderAutoMessage,
  isScheduleOutsideCurrentConfig,
  sendBlockReason,
  decideStuckSendingItem,
  STUCK_SENDING_TIMEOUT_MS,
  HARD_DAILY_CAP,
  temporaryDispatchReductionFor,
  decideTemporaryReduction
} from "./daily-goal-auto-core.mjs";
import { extraGapMinutes, extraSendBlockReason, minutesUntilNextSendAllowed } from "./prospecting-extra-core.mjs";
import { humanConversationBlockFor, listPhonesBlockedByHumanConversation } from "./daily-goal-human-guard";
import {
  isPolicyV2Enabled,
  applyPolicyV2,
  summarizeV2Usage,
  v2SendBlockReason,
  planV2Schedule,
  findStaleV2Items,
  rescheduleV2Items,
  v2EnqueueAllowance,
  pickV2EnqueueCandidates,
  extraGapSecondsV2,
  dailyCapFor,
  sendsSinceLastPause,
  nextSendingDate,
  saoPauloInstantMs,
  planV2Trim,
  summarizeAutoQueueForCard,
  TRIM_SKIP_REASON,
  TRIM_POLICY_NAME,
  WINDOW_START_MINUTES,
  WINDOW_END_MINUTES,
  MIN_GAP_SECONDS,
  MAX_GAP_SECONDS
} from "./daily-goal-policy-core.mjs";
import { V2_AUTO_MESSAGES, pickV2Variant } from "./daily-goal-policy-messages.mjs";
import { runDeliveryMonitorForCron } from "./daily-goal-delivery-monitor";

// Quantos minutos depois de uma falha TÉCNICA atribuível ao contato (número
// inválido, JID inexistente...) a automação tenta de novo o MESMO contato —
// não incrementa a tentativa comercial, só afasta o retry o suficiente pra
// não dominar a fila nem repetir em loop apertado (pedido do dono, 2026-09-30).
const CONTACT_RETRY_DELAY_MINUTES = 30;
const MAX_CONTACT_RETRIES = 3;

// Automação da Meta Diária pelo WhatsApp individual do corretor (pedido do
// dono, 2026-09-29) — cobre 1ª, 2ª e 3ª tentativa de cada contato, opt-in
// por corretor, NUNCA usa o número oficial (ver pickSendChannel/GUARD em
// lib/whatsapp-broadcasts.js, que continua intocado). Este arquivo é o
// único lugar que chama registerDailyGoalAttemptAutomated — nenhuma rota de
// usuário deve importar essa função diretamente. As 3 tentativas usam
// bancos de 4 variações cada (getDailyGoalAutoMessages em lib/daily-goal.js,
// editável em Gestão > Meta Diária > Automação) — sorteadas sem repetir a
// última usada, pra reduzir o padrão repetitivo que ajuda a banir número no
// WhatsApp (pedido do dono, 2026-09-29).

const MAX_CONSECUTIVE_ERRORS = 3;
const AUTO_DEFAULTS_SETTINGS_ID = "daily_goal_auto_defaults";
const HARDCODED_DEFAULTS = {
  windowStartMinutes: 390,
  windowEndMinutes: 1140,
  minGapMinutes: 20,
  maxGapMinutes: 40,
  oscillateEnabled: false,
  oscillatePercent: 50,
  maxAvgGapMinutes: null,
  businessDaysOnly: true,
  dailyCapOverride: null
};

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function requireBrokerId(auth) {
  const id = auth?.profile?.id;
  if (!auth?.ok || !id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

// Hora/dia em São Paulo, sem depender de fuso do servidor (Vercel roda em
// UTC) — mesmo padrão de lib/daily-report.js (getTimeGreeting/getTodayInSaoPaulo).
function saoPauloNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const minutes = Number(map.hour) * 60 + Number(map.minute);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minutes, weekday: weekdayMap[map.weekday] ?? 1 };
}

function rowToSettings(row) {
  if (!row) {
    return {
      enabled: false, paused: false, pausedReason: "", consecutiveErrors: 0,
      warmupStartDate: null, dailyCapOverride: null,
      windowStartMinutes: 390, windowEndMinutes: 1140, minGapMinutes: 20, maxGapMinutes: 40,
      oscillateEnabled: false, oscillatePercent: 50, maxAvgGapMinutes: null,
      businessDaysOnly: true, policyV2Enabled: false
    };
  }
  const policyV2 = isPolicyV2Enabled(row);
  return {
    enabled: row.enabled,
    paused: row.paused,
    pausedReason: row.paused_reason || "",
    consecutiveErrors: row.consecutive_errors || 0,
    warmupStartDate: row.warmup_start_date,
    dailyCapOverride: row.daily_cap_override,
    // Política v2 vigente: a tela mostra os valores que valem de verdade (constantes da política), não os antigos do banco.
    windowStartMinutes: policyV2 ? WINDOW_START_MINUTES : row.window_start_minutes,
    windowEndMinutes: policyV2 ? WINDOW_END_MINUTES : row.window_end_minutes,
    minGapMinutes: policyV2 ? MIN_GAP_SECONDS / 60 : row.min_gap_minutes,
    maxGapMinutes: policyV2 ? MAX_GAP_SECONDS / 60 : row.max_gap_minutes,
    oscillateEnabled: Boolean(row.oscillate_enabled),
    oscillatePercent: row.oscillate_percent ?? 50,
    maxAvgGapMinutes: row.max_avg_gap_minutes ?? null,
    businessDaysOnly: row.business_days_only,
    // Política de disparos v2 (2026-10-04): vigente por padrão (coluna ausente/NULL = ligada; só false explícito desliga).
    policyV2Enabled: policyV2
  };
}

async function getSettingsRow(brokerId) {
  const { data, error } = await db().from("daily_goal_auto_settings").select("*").eq("broker_id", brokerId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Padrões globais (janela, intervalo entre mensagens, dias úteis, teto
// diário) usados quando um corretor liga a automação pela 1ª vez — guardados
// em crm_settings, mesmo padrão de getDailyGoalAutoMessages em lib/daily-goal.js.
export async function getDailyGoalAutoDefaults() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", AUTO_DEFAULTS_SETTINGS_ID).maybeSingle();
  if (error) throw error;
  return { ...HARDCODED_DEFAULTS, ...(data?.setting_value || {}) };
}

/* --------------------------- Corretor (opt-in) --------------------------- */

export async function getDailyGoalAutoStatus(auth) {
  const brokerId = requireBrokerId(auth);
  const row = await getSettingsRow(brokerId);
  const today = getTodayInSaoPaulo();

  // Confirmado pelo WhatsApp (delivered_at), não só o Baileys ter aceitado
  // local (status='sent') — a confirmação pode demorar (até horas), então
  // isso é só pra exibição, nunca usado pra decidir travar/pausar envio.
  const { count: sentToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("status", "sent")
    .not("delivered_at", "is", null)
    .gte("sent_at", `${today}T00:00:00-03:00`);
  const { count: pendingToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("status", "pending");

  const settings = rowToSettings(row);
  // Dois números (2026-10-08): "conectado" para a automação = algum número conectado com "Usar para disparo" ligado.
  const sessionStatus = await getDispatchSessionStatusForUser(brokerId);
  return {
    ...settings,
    sessionConnected: sessionStatus === "connected",
    sentToday: sentToday || 0,
    pendingToday: pendingToday || 0
  };
}

// (setDailyGoalAutoEnabled — liga/desliga pelo próprio corretor — foi removida em 2026-10-02: sem nenhum
// chamador, e era um caminho para ligar a automação sem a recusa do número do dono. Quem liga/desliga hoje
// é adminSetDailyGoalAutoEnabled e a conexão do WhatsApp, ensureDailyGoalAutoEnabledOnConnect.)

export async function setDailyGoalAutoPausedByBroker(auth, paused) {
  const brokerId = requireBrokerId(auth);
  const { error } = await db().from("daily_goal_auto_settings").update({
    paused: Boolean(paused),
    paused_reason: paused ? "Pausado pelo corretor" : null,
    consecutive_errors: paused ? undefined : 0,
    updated_by: brokerId,
    updated_at: new Date().toISOString()
  }).eq("broker_id", brokerId);
  if (error) throw error;
  return getDailyGoalAutoStatus(auth);
}

/* ------------------------------- Admin ------------------------------- */

// Visão completa pro admin (pedido do dono, 2026-09-29: "quem está rodando
// com a automação, quem está conectado, quem está ok") — TODOS os corretores
// ativos, não só quem já mexeu na automação, cruzado com o status real da
// sessão WhatsApp individual (whatsapp_individual_sessions). 3 consultas
// separadas em vez de embed do Supabase: cada tabela só tem no máximo 1 linha
// por corretor (broker_id é chave primária nas duas), então o cruzamento em
// JS é simples e evita ambiguidade de FK duplicada (broker_id/updated_by).
// Escopo de EQUIPE (REGRA OFICIAL — dono, 2026-10-02): admin geral = todos (null); gestora = só o próprio
// time (managedUserIds). Vale no backend para listar, consultar histórico e operar — nunca só na tela.
function teamScopeIdsFor(auth) {
  const scope = resolveTeamVisibilityScope(auth);
  return scope.admin ? null : (scope.ids || []);
}

export async function adminListDailyGoalAutoSettings(auth) {
  assertGeneralAdminOrManager(auth);
  const scopeIds = teamScopeIdsFor(auth);
  if (scopeIds && !scopeIds.length) return [];
  let brokersQuery = db().from("admin_users").select("id, name, photo_url, role, email, whatsapp_access_blocked").is("disabled_at", null).order("name", { ascending: true });
  if (scopeIds) brokersQuery = brokersQuery.in("id", scopeIds);
  const [{ data: brokers, error: brokersError }, { data: settingsRows, error: settingsError }, { data: sessionRows, error: sessionError }] = await Promise.all([
    brokersQuery,
    db().from("daily_goal_auto_settings").select("*"),
    db().from("whatsapp_individual_sessions").select("user_id, slot, label, dispatch_enabled, status, last_error, last_connected_at")
  ]);
  if (brokersError) throw brokersError;
  if (settingsError) throw settingsError;
  if (sessionError) throw sessionError;

  const settingsByBroker = new Map((settingsRows || []).map((row) => [row.broker_id, row]));
  // Até 2 números por corretor (2026-10-08): o card mostra a linha representativa (conectada primeiro; senão o Número 1).
  const sessionRowsByBroker = groupSessionRowsByUser(sessionRows || []);
  const sessionByBroker = new Map([...sessionRowsByBroker].map(([userId, rows]) => [userId, representativeSessionRow(rows)]));

  const brokerIds = (brokers || []).map((b) => b.id);

  // WhatsApp restringido (informado pelo corretor; só status operacional, não libera nada).
  // Encerra sozinho quem já voltou a "connected" (o microsserviço grava a sessão direto no banco).
  const restrictionByBroker = await listOpenRestrictions(brokerIds).catch(() => new Map());
  for (const [restrictedId] of [...restrictionByBroker]) {
    if (sessionByBroker.get(restrictedId)?.status === "connected") {
      await endRestrictionIfConnected(restrictedId, "connected").catch(() => {});
      restrictionByBroker.delete(restrictedId);
    }
  }
  const today = getTodayInSaoPaulo();
  // Status do Google Contacts por corretor (pedido do dono, 2026-10-01) —
  // integração PARALELA ao WhatsApp, mostrada de forma discreta no mesmo
  // painel, nunca confundida com o status do WhatsApp (ver lib/google-contacts.js).
  const googleContactsByBroker = await listGoogleContactsStatuses(brokerIds);
  const [{ data: todayRows }, { data: sentTotalRows }, { data: issueRows }, { data: pendingActivityRows }, { data: autoErrorRows }, { data: openQueueRows }] = await Promise.all([
    // "Hoje" tem que pegar pelo que ACONTECEU hoje (enviou/pulou/deu erro
    // hoje), não só pela data em que a linha da fila foi criada — achado
    // real, 2026-09-30: item criado ontem à noite (ou antes da limpeza
    // manual da fila) mas enviado hoje de manhã ficava de fora da contagem
    // de "hoje", o card mostrava menos enviadas do que realmente saiu.
    brokerIds.length
      ? db().from("daily_goal_auto_queue").select("broker_id, status, scheduled_for, delivered_at, sent_at, attempt_number, source")
          .in("broker_id", brokerIds)
          .or(`created_at.gte.${today}T00:00:00-03:00,sent_at.gte.${today}T00:00:00-03:00,updated_at.gte.${today}T00:00:00-03:00`)
      : Promise.resolve({ data: [] }),
    // "Enviado" aqui = confirmado pelo WhatsApp (delivered_at), não só o
    // Baileys ter aceitado local (status='sent') — achado real, 2026-09-30:
    // mensagens marcadas "sent" que nunca chegaram de verdade.
    brokerIds.length
      ? db().from("daily_goal_auto_queue").select("broker_id").eq("status", "sent").not("delivered_at", "is", null).in("broker_id", brokerIds)
      : Promise.resolve({ data: [] }),
    // Último problema (erro real de envio ou item pulado) por corretor, pra
    // mostrar o motivo direto no card sem precisar abrir o Chat/logs.
    brokerIds.length
      ? db().from("daily_goal_auto_queue").select("broker_id, status, skip_reason, last_error, updated_at")
          .in("broker_id", brokerIds).in("status", ["error", "skipped"]).order("updated_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
    // Atividades pendentes AGORA (1ª+2ª+3ª tentativa juntas) — mesma conta
    // que a Meta Diária mostra, usada pra calcular e explicar o teto de hoje
    // (computeDailyAutoCap): ver enqueueTodayItemsForBroker.
    brokerIds.length
      ? db().from("daily_goal_rounds").select("broker_id").in("broker_id", brokerIds).eq("status", "active").lt("attempt_count", 3)
      : Promise.resolve({ data: [] }),
    // Clientes que a automação desistiu de tentar (3 falhas técnicas
    // atribuíveis ao contato) — categoria "Erro", separada de "Não
    // contactar" (pedido do dono, 2026-09-30). Contagem acumulada (não só
    // hoje), já que é um estado terminal que fica esperando o corretor olhar.
    brokerIds.length
      ? db().from("daily_goal_rounds").select("broker_id").in("broker_id", brokerIds).eq("status", "auto_error")
      : Promise.resolve({ data: [] }),
    // Fila ABERTA (pendente/enviando) de QUALQUER dia, só para o resumo da política v2 no card
    // ("fila automática de hoje X de 30"). Item atrasado conta: é reprogramado e sai na próxima janela.
    brokerIds.length
      ? db().from("daily_goal_auto_queue").select("broker_id, attempt_number, source").in("broker_id", brokerIds).in("status", ["pending", "sending"])
      : Promise.resolve({ data: [] })
  ]);
  const openQueueByBroker = new Map();
  for (const row of openQueueRows || []) {
    const list = openQueueByBroker.get(row.broker_id) || [];
    list.push(row);
    openQueueByBroker.set(row.broker_id, list);
  }
  const todayStartMs = new Date(`${today}T00:00:00-03:00`).getTime();
  const sentTodayRowsByBroker = new Map();
  for (const row of todayRows || []) {
    if (row.status !== "sent" || !row.sent_at || new Date(row.sent_at).getTime() < todayStartMs) continue;
    const list = sentTodayRowsByBroker.get(row.broker_id) || [];
    list.push(row);
    sentTodayRowsByBroker.set(row.broker_id, list);
  }
  const autoErrorCountByBroker = new Map();
  for (const row of autoErrorRows || []) autoErrorCountByBroker.set(row.broker_id, (autoErrorCountByBroker.get(row.broker_id) || 0) + 1);
  const pendingActivitiesByBroker = new Map();
  for (const row of pendingActivityRows || []) pendingActivitiesByBroker.set(row.broker_id, (pendingActivitiesByBroker.get(row.broker_id) || 0) + 1);

  // Contagem de hoje por corretor+status (pending/sending/sent/skipped/error/canceled)
  // e os horários agendados (status que ainda vão ou já foram disparados) pra
  // calcular quantas mensagens tocam hoje e o intervalo médio real entre elas.
  const todayByBroker = new Map();
  const scheduledTimesByBroker = new Map();
  const nextDispatchByBroker = new Map();
  for (const row of todayRows || []) {
    const counts = todayByBroker.get(row.broker_id) || {};
    counts[row.status] = (counts[row.status] || 0) + 1;
    // "sent" fica dividido em confirmado (delivered_at) vs aguardando
    // confirmação — sentToday do card só conta o confirmado (ver abaixo).
    if (row.status === "sent") {
      const key = row.delivered_at ? "sent_confirmed" : "sent_unconfirmed";
      counts[key] = (counts[key] || 0) + 1;
    }
    todayByBroker.set(row.broker_id, counts);
    if (["pending", "sending", "sent"].includes(row.status) && row.scheduled_for) {
      const list = scheduledTimesByBroker.get(row.broker_id) || [];
      list.push(new Date(row.scheduled_for).getTime());
      scheduledTimesByBroker.set(row.broker_id, list);
    }
    // Próximo disparo = o horário agendado mais cedo entre os itens que
    // ainda vão sair (pending/sending) — pedido do dono, 2026-09-30.
    if (["pending", "sending"].includes(row.status) && row.scheduled_for) {
      const current = nextDispatchByBroker.get(row.broker_id);
      const candidate = new Date(row.scheduled_for).getTime();
      if (current === undefined || candidate < current) nextDispatchByBroker.set(row.broker_id, candidate);
    }
  }
  const sentTotalByBroker = new Map();
  for (const row of sentTotalRows || []) sentTotalByBroker.set(row.broker_id, (sentTotalByBroker.get(row.broker_id) || 0) + 1);
  // issueRows já vem ordenado do mais recente pro mais antigo — o 1º que
  // aparecer por corretor é o problema mais recente dele.
  const lastIssueByBroker = new Map();
  for (const row of issueRows || []) {
    if (lastIssueByBroker.has(row.broker_id)) continue;
    lastIssueByBroker.set(row.broker_id, {
      status: row.status,
      // skip_reason agora também é preenchido para status='error' (falha
      // técnica classificada, ver handleSendFailure) — prefere o motivo
      // amigável (traduzido em SKIP_REASON_LABELS no card) e só cai no texto
      // cru do erro quando não há classificação (ex.: falha ao registrar
      // após enviar, que ainda não seta skip_reason).
      reason: row.skip_reason || row.last_error,
      at: row.updated_at
    });
  }

  return (brokers || []).map((broker) => {
    const settingsRow = settingsByBroker.get(broker.id) || null;
    const sessionRow = sessionByBroker.get(broker.id) || null;
    const todayCounts = todayByBroker.get(broker.id) || {};
    const scheduledTimes = (scheduledTimesByBroker.get(broker.id) || []).slice().sort((a, b) => a - b);
    const plannedToday = scheduledTimes.length;
    let avgGapMinutes = null;
    if (scheduledTimes.length >= 2) {
      const totalSpanMs = scheduledTimes[scheduledTimes.length - 1] - scheduledTimes[0];
      avgGapMinutes = totalSpanMs / (scheduledTimes.length - 1) / 60000;
    }
    // Teto de hoje = todas as atividades pendentes agora (já enfileiradas +
    // ainda por enfileirar), até o máximo de HARD_DAILY_CAP (100) — mesma
    // conta que enqueueTodayItemsForBroker usa de verdade pra decidir quanto
    // ainda falta enfileirar.
    const usedTodayCount = (todayCounts.sent || 0) + (todayCounts.pending || 0) + (todayCounts.sending || 0);
    const totalActivitiesToday = usedTodayCount + (pendingActivitiesByBroker.get(broker.id) || 0);
    let dailyCap = computeDailyAutoCap({ totalActivities: totalActivitiesToday, dailyCapOverride: settingsRow?.daily_cap_override });
    let dailyCapReason = "";
    if (settingsRow?.daily_cap_override && dailyCap === settingsRow.daily_cap_override) dailyCapReason = "teto manual";
    else if (dailyCap === HARD_DAILY_CAP) dailyCapReason = "teto máximo de segurança";
    else dailyCapReason = "todas as atividades de hoje";
    // Política v2 (2026-10-04): o teto de verdade é 30 por dia (Meta Diária + fila extra); o card mostra o mesmo número.
    if (isPolicyV2Enabled(settingsRow)) {
      dailyCap = Math.min(dailyCap, dailyCapFor(settingsRow));
      dailyCapReason = "política nova (máx. 30 por dia)";
    }
    return {
      brokerId: broker.id,
      brokerName: broker.name || "",
      brokerPhotoUrl: broker.photo_url || "",
      // Acesso aos recursos WhatsApp (2026-10-04) — independente da automação ligada/desligada; o dono nunca é bloqueado.
      whatsappAccessBlocked: broker.whatsapp_access_blocked === true && broker.role !== "admin" && !isOwnerAdminEmail(broker.email),
      whatsappAccessControllable: broker.role !== "admin" && !isOwnerAdminEmail(broker.email),
      ...rowToSettings(settingsRow),
      sessionStatus: sessionRow?.status || "nunca_conectou",
      // Números aptos ao disparo agora (conectados + "Usar para disparo" ligado) e o resumo de cada número.
      dispatchSlots: dispatchSlots(sessionRowsByBroker.get(broker.id) || []),
      sessionSlots: (sessionRowsByBroker.get(broker.id) || []).map((item) => ({ slot: normalizeSlot(item.slot) || 1, status: item.status, label: item.label || "", dispatchEnabled: isSlotDispatchEnabled(item) })),
      whatsappRestricted: restrictionByBroker.has(broker.id),
      whatsappRestrictedAt: restrictionByBroker.get(broker.id)?.reported_at || null,
      sessionLastError: sessionRow?.last_error || "",
      sessionLastConnectedAt: sessionRow?.last_connected_at || null,
      sentToday: todayCounts.sent_confirmed || 0,
      sentUnconfirmedToday: todayCounts.sent_unconfirmed || 0,
      // "Na fila" = tudo que ainda vai sair (pendente/enviando de QUALQUER dia, inclusive atrasado que será
      // reprogramado) — antes só contava item mexido hoje e mostrava 0 com 30 pendentes de ontem.
      pendingToday: (openQueueByBroker.get(broker.id) || []).length,
      // Resumo da política v2 para o card (só exibição): enviadas hoje + na fila por tentativa, teto 10/10/10 e 30.
      policyV2Queue: isPolicyV2Enabled(settingsRow) ? summarizeAutoQueueForCard({
        sentTodayRows: sentTodayRowsByBroker.get(broker.id) || [],
        openRows: openQueueByBroker.get(broker.id) || [],
        settings: settingsRow
      }) : null,
      skippedToday: todayCounts.skipped || 0,
      errorToday: todayCounts.error || 0,
      canceledToday: todayCounts.canceled || 0,
      // Total de mensagens que tocam hoje (já enviadas + ainda na fila, sem
      // contar puladas/erro/canceladas) e o intervalo médio REAL entre os
      // horários agendados (reflete o resultado de qualquer modo — fixo ou
      // com oscilação — em vez de recalcular a teoria separadamente).
      plannedToday,
      avgGapMinutes,
      dailyCap,
      dailyCapReason,
      nextDispatchAt: nextDispatchByBroker.has(broker.id) ? new Date(nextDispatchByBroker.get(broker.id)).toISOString() : null,
      sentTotal: sentTotalByBroker.get(broker.id) || 0,
      autoErrorTotal: autoErrorCountByBroker.get(broker.id) || 0,
      lastIssue: lastIssueByBroker.get(broker.id) || null,
      // Independente do status/sessão do WhatsApp — nunca usar isto pra
      // decidir nada sobre o WhatsApp, é só exibição (pedido do dono).
      googleContactsStatus: googleContactsByBroker.get(broker.id)?.status || "disconnected",
      googleContactsEmail: googleContactsByBroker.get(broker.id)?.email || ""
    };
  });
}

// Padrões globais aplicados a TODOS os corretores de uma vez (pedido do
// dono, 2026-09-30: menu de configuração completo — janela de envio,
// intervalo entre mensagens, dias úteis, teto diário). Atualiza quem já tem
// linha em daily_goal_auto_settings e guarda em crm_settings pra quem ligar
// a automação depois herdar o mesmo padrão (ver getDailyGoalAutoDefaults).
export async function adminUpdateDailyGoalAutoGlobalConfig(auth, payload) {
  assertGeneralAdminOrManager(auth);
  const windowStartMinutes = Number(payload?.windowStartMinutes);
  const windowEndMinutes = Number(payload?.windowEndMinutes);
  const minGapMinutes = Number(payload?.minGapMinutes);
  const maxGapMinutes = Number(payload?.maxGapMinutes);
  const oscillateEnabled = Boolean(payload?.oscillateEnabled);
  const oscillatePercent = Number(payload?.oscillatePercent ?? 50);
  const maxAvgGapRaw = payload?.maxAvgGapMinutes;
  const maxAvgGapMinutes = maxAvgGapRaw === null || maxAvgGapRaw === "" || maxAvgGapRaw === undefined ? null : Number(maxAvgGapRaw);
  const businessDaysOnly = Boolean(payload?.businessDaysOnly);
  const dailyCapOverrideRaw = payload?.dailyCapOverride;
  const dailyCapOverride = dailyCapOverrideRaw === null || dailyCapOverrideRaw === "" || dailyCapOverrideRaw === undefined
    ? null : Number(dailyCapOverrideRaw);

  if (!Number.isInteger(windowStartMinutes) || windowStartMinutes < 0 || windowStartMinutes > 1439) throw new Error("Horário de início inválido.");
  if (!Number.isInteger(windowEndMinutes) || windowEndMinutes < 0 || windowEndMinutes > 1439) throw new Error("Horário de fim inválido.");
  if (windowEndMinutes <= windowStartMinutes) throw new Error("O horário de fim precisa ser depois do horário de início.");
  if (!Number.isInteger(minGapMinutes) || minGapMinutes < 1 || minGapMinutes > 180) throw new Error("Intervalo mínimo inválido (1 a 180 minutos).");
  if (!Number.isInteger(maxGapMinutes) || maxGapMinutes < minGapMinutes || maxGapMinutes > 180) throw new Error("Intervalo máximo inválido (não pode ser menor que o mínimo, máx. 180 minutos).");
  if (!Number.isInteger(oscillatePercent) || oscillatePercent < 0 || oscillatePercent > 100) throw new Error("Percentual de oscilação inválido (0 a 100).");
  if (maxAvgGapMinutes !== null && (!Number.isInteger(maxAvgGapMinutes) || maxAvgGapMinutes < 1 || maxAvgGapMinutes > 180)) {
    throw new Error("Intervalo médio máximo inválido (1 a 180 minutos, ou vazio para sem limite).");
  }
  if (dailyCapOverride !== null && (!Number.isInteger(dailyCapOverride) || dailyCapOverride < 1 || dailyCapOverride > HARD_DAILY_CAP)) {
    throw new Error(`Teto diário inválido (1 a ${HARD_DAILY_CAP}, ou vazio para automático).`);
  }

  const config = { windowStartMinutes, windowEndMinutes, minGapMinutes, maxGapMinutes, oscillateEnabled, oscillatePercent, maxAvgGapMinutes, businessDaysOnly, dailyCapOverride };

  const { error: defaultsError } = await db().from("crm_settings").upsert({
    id: AUTO_DEFAULTS_SETTINGS_ID,
    setting_value: config,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  });
  if (defaultsError) throw defaultsError;

  const { error: bulkError } = await db().from("daily_goal_auto_settings").update({
    window_start_minutes: windowStartMinutes,
    window_end_minutes: windowEndMinutes,
    min_gap_minutes: minGapMinutes,
    max_gap_minutes: maxGapMinutes,
    oscillate_enabled: oscillateEnabled,
    oscillate_percent: oscillatePercent,
    max_avg_gap_minutes: maxAvgGapMinutes,
    business_days_only: businessDaysOnly,
    daily_cap_override: dailyCapOverride,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).neq("broker_id", "00000000-0000-0000-0000-000000000000"); // update em todas as linhas
  if (bulkError) throw bulkError;

  // Salvar a configuração recalcula AUTOMATICAMENTE a fila pendente de todos
  // os corretores com a automação ligada (2026-10-02) — sem depender de
  // clicar em "Reagendar". Só itens 'pending'; enviados/histórico/opt-out
  // intocados.
  const requeued = await requeueAllEnabledBrokers("reagendado_por_configuracao");

  return { defaults: config, requeued, brokers: await adminListDailyGoalAutoSettings(auth) };
}

// Reorganiza a fila de disparos de HOJE de um corretor (pedido do dono,
// 2026-10-02): cancela TODOS os itens ainda pendentes — inclusive os
// atrasados — e gera uma fila nova, espalhada a partir de agora, com a
// mesma janela/intervalo/teto já configurados (reaproveita
// enqueueTodayItemsForBroker, a mesma função que o cron usa — não recria
// lógica nenhuma). Itens já enviados/com erro/puladas não são tocados
// (histórico preservado); item em 'sending' (sendo processado agora mesmo
// pelo cron) também não é tocado, pra nunca disputar com um envio em
// andamento. As rodadas (daily_goal_rounds) continuam intactas — só a
// AGENDA dos itens ainda não enviados é reorganizada.
async function requeueBrokerQueueCore(brokerId, settingsRow, broker, skipReason, { cancelPending = false } = {}) {
  // Política v2 (2026-10-04): reorganizar a fila REPROGRAMA os horários (UPDATE) em vez de cancelar e recriar os
  // itens — sem churn de "canceled" e sem risco de duplicar. `cancelPending` só na troca da chave v2 (a fila antiga
  // não segue as regras novas e é refeita uma vez).
  if (isPolicyV2Enabled(settingsRow) && !cancelPending) {
    const rescheduled = await rescheduleV2Queue(brokerId, settingsRow, { force: true });
    const enqueuedV2 = await enqueueTodayItemsForBroker(brokerId, settingsRow, { name: broker?.name || "", gender: broker?.gender || "" });
    return { canceled: 0, enqueued: enqueuedV2, rescheduled: rescheduled.rescheduled };
  }
  const { data: canceledRows, error: cancelError } = await db().from("daily_goal_auto_queue")
    .update({ status: "canceled", skip_reason: skipReason, updated_at: new Date().toISOString() })
    .eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta")
    .select("id");
  if (cancelError) throw cancelError;

  const enqueued = await enqueueTodayItemsForBroker(brokerId, settingsRow, { name: broker?.name || "", gender: broker?.gender || "" });

  return { canceled: canceledRows?.length || 0, enqueued };
}

async function requeueAllEnabledBrokers(skipReason) {
  const { data: rows, error } = await db().from("daily_goal_auto_settings")
    .select("*, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name, gender)")
    .eq("enabled", true);
  if (error) throw error;
  const summary = { brokers: 0, canceled: 0, enqueued: 0, failed: 0 };
  for (const row of rows || []) {
    try {
      const result = await requeueBrokerQueueCore(row.broker_id, row, row.broker, skipReason);
      summary.brokers += 1;
      summary.canceled += result.canceled;
      summary.enqueued += result.enqueued;
    } catch (error) {
      summary.failed += 1;
      // A trava do envio + repairInvalidPendingQueue no próximo ciclo cobrem
      // uma falha aqui: nada fora da configuração chega a ser enviado.
      console.error(`Falha ao recalcular a fila do corretor ${row.broker_id} após salvar a configuração:`, error?.message || error);
    }
  }
  return summary;
}

export async function adminRequeueBrokerQueue(auth, brokerId) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  assertCanAccessResponsibleUser(auth, brokerId);

  const settingsRow = await getSettingsRow(brokerId);
  if (!settingsRow) throw new Error("Este corretor ainda não tem a automação configurada.");

  const { data: broker, error: brokerError } = await db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle();
  if (brokerError) throw brokerError;

  return requeueBrokerQueueCore(brokerId, settingsRow, broker, "reordenado_manualmente");
}

// Redistribui a fila de HOJE sozinha quando a sessão do WhatsApp RECONECTA
// com itens pendentes atrasados (pedido do dono, 2026-10-02: corretor que
// desconectou/foi desconectado no meio do dia e reconecta horas depois não
// pode receber uma RAJADA de atrasados). Sem isso, os itens parados
// (scheduled_for no passado, nunca tocados enquanto a sessão esteve fora —
// ver dispatchOneForBroker/pickSendChannel) sairiam 1 por ciclo do cron
// (a cada 2 min), bem mais rápido que o intervalo mínimo/máximo configurado
// — risco real de banimento. Só age quando existe atraso de verdade (algum
// pending com scheduled_for <= agora); uma reconexão normal (flutuação de
// rede, sem backlog) não cancela/reagenda nada. Chamada pelo webhook do
// microsserviço (mesmo gatilho de ensureDailyGoalAutoEnabledOnConnect) —
// sempre "a sessão DESTE corretor específico acabou de conectar", nunca uma
// ação de terceiro, então não precisa (nem pode) checar auth de admin aqui.
export async function redistributeBrokerQueueOnReconnect(brokerId) {
  if (!brokerId) return;
  try {
    // Política v2: o excesso da fila é retirado também na reconexão (idempotente), antes de reprogramar.
    const settingsForTrim = await getSettingsRow(brokerId);
    await trimV2QueueExcess(brokerId, settingsForTrim);
    const nowIso = new Date().toISOString();
    const { count: overdueCount, error: overdueError } = await db().from("daily_goal_auto_queue")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta").lte("scheduled_for", nowIso);
    if (overdueError) throw overdueError;
    if (!overdueCount) return;

    const settingsRow = await getSettingsRow(brokerId);
    if (!settingsRow?.enabled) return;

    // Política v2: atrasados são REPROGRAMADOS para os próximos horários livres (espaçados, depois de 5 min da
    // reconexão), nunca cancelados nem enviados de uma vez.
    if (isPolicyV2Enabled(settingsRow)) {
      const rescheduled = await rescheduleV2Queue(brokerId, settingsRow);
      console.log(`Fila (política v2) reprogramada sozinha ao reconectar (corretor ${brokerId}): ${rescheduled.rescheduled} item(ns).`);
      return;
    }

    const { data: broker, error: brokerError } = await db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle();
    if (brokerError) throw brokerError;

    const result = await requeueBrokerQueueCore(brokerId, settingsRow, broker, "reordenado_automaticamente_reconexao");
    console.log(`Fila da Meta Diária redistribuída sozinha ao reconectar (corretor ${brokerId}): ${result.canceled} atrasado(s) cancelado(s), ${result.enqueued} reagendado(s).`);
  } catch (error) {
    // Best-effort: nunca derruba o webhook de status por causa disso — o
    // admin sempre pode reorganizar manualmente (botão no card) se isso falhar.
    console.error(`Falha ao redistribuir a fila sozinha ao reconectar (corretor ${brokerId}):`, error?.message || error);
  }
}

// RETOMADA depois do bloqueio de acesso ao WhatsApp (2026-10-04): chamada por setWhatsappAccessBlocked ANTES de a
// flag virar. Durante o bloqueio o cron ignora o corretor, então a fila pendente envelhece (horários vencidos, dias
// anteriores). A retomada NUNCA compensa o período parado: o excesso é aparado (10 por tentativa) e os pendentes são
// REPROGRAMADOS para horários futuros e espaçados pela política vigente (30/dia, 10/10/10, janela, intervalo 5–8,
// pausas) — nenhum item vencido sai de uma vez. Só mexe na AGENDA da fila (nada é enviado, apagado ou transferido);
// automação desligada/pausada continua como está (nada é criado). Os limites do dia são relidos do que já saiu.
export async function resumeBrokerQueueAfterUnblock(brokerId) {
  if (!brokerId) return { skipped: "sem_corretor" };
  const settingsRow = await getSettingsRow(brokerId);
  if (!settingsRow?.enabled || settingsRow.paused) return { skipped: "automacao_desligada_ou_pausada" };
  const { data: broker, error: brokerError } = await db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle();
  if (brokerError) throw brokerError;
  return requeueBrokerQueueCore(brokerId, settingsRow, broker, "reordenado_apos_desbloqueio");
}

// Exceção pontual pra 1 corretor específico (ex.: reduzir o teto dele sem
// mexer nos outros) — sobrescreve o próximo "aplicar a todos" só se o admin
// rodar de novo o global depois.
export async function adminSetBrokerDailyCapOverride(auth, brokerId, dailyCapOverride) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  assertCanAccessResponsibleUser(auth, brokerId);
  const capRaw = dailyCapOverride === null || dailyCapOverride === "" || dailyCapOverride === undefined ? null : Number(dailyCapOverride);
  if (capRaw !== null && (!Number.isInteger(capRaw) || capRaw < 1 || capRaw > HARD_DAILY_CAP)) {
    throw new Error(`Teto diário inválido (1 a ${HARD_DAILY_CAP}, ou vazio para automático).`);
  }
  const { error } = await db().from("daily_goal_auto_settings").update({
    daily_cap_override: capRaw,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).eq("broker_id", brokerId);
  if (error) throw error;
  // Teto novo vale para a fila pendente já agendada (2026-10-02).
  const settingsAfter = await getSettingsRow(brokerId);
  if (settingsAfter?.enabled) {
    const { data: broker } = await db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle();
    await requeueBrokerQueueCore(brokerId, settingsAfter, broker, "reagendado_por_configuracao");
  }
  return true;
}

// Liga/desliga a POLÍTICA DE DISPAROS v2 de UM corretor (REGRA OFICIAL — dono, 2026-10-04): 30 mensagens/dia,
// 06:30–15:30 de segunda a sábado, intervalos 90 s–8 min com pausas, modelos novos e monitor. Só o administrador
// geral (decisão de política do dono). Troca a regra da fila: a fila pendente de agora é refeita UMA vez (os itens
// pendentes antigos são cancelados com motivo e recriados pelas regras da política escolhida).
export async function adminSetBrokerPolicyV2(auth, brokerId, enabled) {
  assertGeneralAdmin(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  const current = await getSettingsRow(brokerId);
  if (!current) throw new Error("Este corretor ainda não tem a automação configurada. Ative a automação dele primeiro.");
  if (!("policy_v2_enabled" in current)) throw new Error("A política nova de disparos ainda não está disponível no banco (a migration 20261004130000 precisa ser aplicada).");
  const { error } = await db().from("daily_goal_auto_settings").update({
    policy_v2_enabled: Boolean(enabled),
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).eq("broker_id", brokerId);
  if (error) throw error;
  const after = await getSettingsRow(brokerId);
  if (after?.enabled) {
    const { data: broker, error: brokerError } = await db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle();
    if (brokerError) throw brokerError;
    await requeueBrokerQueueCore(brokerId, after, broker, enabled ? "politica_v2_ativada" : "politica_v2_desativada", { cancelPending: true });
  }
  return true;
}

export async function adminSetDailyGoalAutoPaused(auth, brokerId, paused, reason) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  assertCanAccessResponsibleUser(auth, brokerId);
  const { error } = await db().from("daily_goal_auto_settings").update({
    paused: Boolean(paused),
    paused_reason: paused ? (reason || "Pausado pelo admin") : null,
    consecutive_errors: paused ? undefined : 0,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).eq("broker_id", brokerId);
  if (error) throw error;
  return true;
}

// Liga/desliga a automação de UM corretor específico, pelo admin — pedido do
// dono (2026-09-30): o corretor deixou de poder ligar/pausar a própria
// automação (ver setDailyGoalAutoEnabled/setDailyGoalAutoPausedByBroker,
// ambos retirados da UI dele), então precisa existir um jeito do admin
// ativar pela primeira vez. Mesma lógica de 1ª ativação de
// setDailyGoalAutoEnabled (herda os padrões globais) — só que via UPSERT
// com brokerId explícito, não auth.profile.id. Sem rampa de aquecimento
// (removida a pedido do dono, 2026-09-30).
export async function adminSetDailyGoalAutoEnabled(auth, brokerId, enabled) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  assertCanAccessResponsibleUser(auth, brokerId);
  const current = await getSettingsRow(brokerId);
  const patch = {
    broker_id: brokerId,
    enabled: Boolean(enabled),
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  };
  if (enabled && !current) {
    const defaults = await getDailyGoalAutoDefaults();
    patch.window_start_minutes = defaults.windowStartMinutes;
    patch.window_end_minutes = defaults.windowEndMinutes;
    patch.min_gap_minutes = defaults.minGapMinutes;
    patch.max_gap_minutes = defaults.maxGapMinutes;
    patch.oscillate_enabled = defaults.oscillateEnabled;
    patch.oscillate_percent = defaults.oscillatePercent;
    patch.max_avg_gap_minutes = defaults.maxAvgGapMinutes ?? null;
    patch.business_days_only = defaults.businessDaysOnly;
    patch.daily_cap_override = defaults.dailyCapOverride;
  }
  if (enabled) { patch.paused = false; patch.paused_reason = null; patch.consecutive_errors = 0; }
  const { error } = await db().from("daily_goal_auto_settings").upsert(patch, { onConflict: "broker_id" });
  if (error) throw error;
  if (!enabled) {
    // Só a fila da Meta Diária: clientes já colocados no "Disparar" esperam
    // a automação voltar (o botão fica travado enquanto isso).
    await db().from("daily_goal_auto_queue").update({ status: "canceled", skip_reason: "automacao_desligada", updated_at: new Date().toISOString() })
      .eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta");
  }
  return true;
}

// Ativa a automação sozinha assim que a sessão do WhatsApp individual do
// PRÓPRIO corretor conecta (pedido do dono, 2026-09-30: "conforme o pessoal
// conecta vai ativando também") — chamada pelo webhook do microsserviço
// (app/api/webhooks/whatsapp-individual), nunca por uma rota que aceite
// brokerId de fora, então não precisa (nem pode) checar auth de admin aqui:
// o gatilho é sempre "a sessão DESTE corretor específico acabou de
// conectar", nunca uma ação de terceiro. Não pausa nem desliga em nenhuma
// circunstância — só liga quando ainda não estava ligada; se já estava
// ligada (reconexão normal), não mexe em nada.
export async function ensureDailyGoalAutoEnabledOnConnect(brokerId) {
  if (!brokerId) return;
  try {
    // O número do dono NÃO faz disparo automático — só os corretores
    // (decisão do dono, 2026-10-02). Sem isto, conectar o WhatsApp dele
    // ligava a automação sozinha e enfileirava envios para clientes reais.
    const { data: profile } = await db().from("admin_users").select("email").eq("id", brokerId).maybeSingle();
    if (isOwnerAdminEmail(profile?.email)) return;
    const current = await getSettingsRow(brokerId);
    if (current?.enabled) return;
    const defaults = await getDailyGoalAutoDefaults();
    const patch = {
      broker_id: brokerId,
      enabled: true,
      paused: false,
      paused_reason: null,
      consecutive_errors: 0,
      window_start_minutes: defaults.windowStartMinutes,
      window_end_minutes: defaults.windowEndMinutes,
      min_gap_minutes: defaults.minGapMinutes,
      max_gap_minutes: defaults.maxGapMinutes,
      oscillate_enabled: defaults.oscillateEnabled,
      oscillate_percent: defaults.oscillatePercent,
      max_avg_gap_minutes: defaults.maxAvgGapMinutes ?? null,
      business_days_only: defaults.businessDaysOnly,
      daily_cap_override: current?.daily_cap_override ?? defaults.dailyCapOverride,
      updated_at: new Date().toISOString()
    };
    const { error } = await db().from("daily_goal_auto_settings").upsert(patch, { onConflict: "broker_id" });
    if (error) throw error;
  } catch (error) {
    // Best-effort: nunca derruba o webhook de status por causa disso — o
    // admin sempre pode ativar manualmente na aba Automação se isso falhar.
    console.error(`Falha ao ativar a automação sozinha ao conectar (corretor ${brokerId}):`, error?.message || error);
  }
}

/* ------------------------------- Fila (enqueue) ------------------------------- */

// Rodadas ELEGÍVEIS para entrar na fila da Meta Diária hoje (mesmos filtros para a política antiga e a v2): ativas,
// sem item de fila para a próxima tentativa, sem tentativa hoje, contato utilizável, fora de conversa humana recente.
// `attemptCount` (v2) restringe a uma etapa (0 = 1ª tentativa, 1 = 2ª, 2 = 3ª); sem ele, todas as ativas (< 3).
async function loadEligibleEnqueueRounds(brokerId, today, { attemptCount = null, limit = HARD_DAILY_CAP * 2 } = {}) {
  let roundsQuery = db().from("daily_goal_rounds")
    .select("id, prospecting_contact_id, attempt_count, client_id, origin, contact:prospecting_contacts(id, name, phone_normalized, status), client:simulation_registrations(full_name, client_code)")
    .eq("broker_id", brokerId)
    .eq("status", "active");
  roundsQuery = attemptCount === null ? roundsQuery.lt("attempt_count", 3) : roundsQuery.eq("attempt_count", attemptCount);
  const { data: rounds, error } = await roundsQuery.limit(limit); // folga: alguns podem já ter item de fila (ex.: canceled) ou virar do_not_contact
  if (error) throw error;

  const candidateRoundIds = (rounds || []).map((round) => round.id);
  if (!candidateRoundIds.length) return [];

  // Já em fila para a PRÓXIMA tentativa de cada round — evita duplicar item
  // se este cron já criou um pendente/enviado nesse ciclo anterior.
  const { data: existingItems } = await db().from("daily_goal_auto_queue")
    .select("round_id, attempt_number").in("round_id", candidateRoundIds).neq("status", "canceled");
  const alreadyQueuedByRound = new Map();
  for (const item of existingItems || []) {
    const set = alreadyQueuedByRound.get(item.round_id) || new Set();
    set.add(item.attempt_number);
    alreadyQueuedByRound.set(item.round_id, set);
  }
  // Política v2 — limpeza do excesso (2026-10-04): quem foi retirado da fila por excesso (mais de 10 por tentativa)
  // NUNCA volta como pendência automática (nem hoje, nem amanhã). A rodada segue ativa para o trabalho manual.
  const { data: trimmedItems } = await db().from("daily_goal_auto_queue")
    .select("round_id, attempt_number").in("round_id", candidateRoundIds)
    .eq("status", "canceled").eq("skip_reason", TRIM_SKIP_REASON);
  for (const trimmed of trimmedItems || []) {
    const set = alreadyQueuedByRound.get(trimmed.round_id) || new Set();
    set.add(trimmed.attempt_number);
    alreadyQueuedByRound.set(trimmed.round_id, set);
  }
  // Exceção temporária por data (ver TEMPORARY_DISPATCH_REDUCTIONS): quem a redução descartou hoje NÃO volta
  // para a fila de hoje (senão a fila se refaria inteira). Amanhã o cancelamento não vale mais.
  const reduction = temporaryDispatchReductionFor(today);
  if (reduction) {
    const { data: droppedItems } = await db().from("daily_goal_auto_queue")
      .select("round_id, attempt_number").in("round_id", candidateRoundIds)
      .eq("status", "canceled").eq("skip_reason", reduction.skipReason);
    for (const dropped of droppedItems || []) {
      const set = alreadyQueuedByRound.get(dropped.round_id) || new Set();
      set.add(dropped.attempt_number);
      alreadyQueuedByRound.set(dropped.round_id, set);
    }
  }

  // Round que já teve QUALQUER tentativa hoje (inclusive manual, pelo Chat)
  // nunca deve ENTRAR na fila de novo — achado real, 2026-09-30: corretora
  // trabalhando a carteira na mão em paralelo à automação fazia a fila
  // encher de itens pra rounds que ela mesma já tinha contactado hoje, e o
  // dispatcher só descobria isso na hora de enviar (skip "ja_teve_tentativa_
  // hoje"), desperdiçando ciclo atrás de ciclo com itens fadados a serem
  // descartados em vez de processar quem realmente precisa de contato.
  const { data: attemptedTodayRows } = await db().from("daily_goal_attempts")
    .select("round_id").in("round_id", candidateRoundIds).eq("goal_date", today);
  const attemptedTodaySet = new Set((attemptedTodayRows || []).map((row) => row.round_id));

  // Nome válido é obrigatório pra entrar na automação (pedido do dono,
  // 2026-09-30) — contato sem nome nunca recebe mensagem automática (o texto
  // ficaria quebrado, ex.: "Oi ,") e nunca teria como saber quem é de volta.
  const eligibleBase = (rounds || []).filter((round) => {
    const nextAttempt = round.attempt_count + 1;
    const queued = alreadyQueuedByRound.get(round.id);
    return !(queued && queued.has(nextAttempt)) &&
      // 1ª mensagem do "Disparar" pertence à fila extra; 2ª/3ª entram aqui.
      !(round.origin === "extra_dispatch" && round.attempt_count === 0) &&
      !attemptedTodaySet.has(round.id) &&
      round.contact?.status !== "do_not_contact" &&
      round.contact?.phone_normalized &&
      String(round.contact?.name || "").trim();
  });
  // Conversa humana recente (decisão do dono, 2026-10-03): quem está conversando com uma pessoa da equipe (ou
  // acabou de escrever) não entra na fila — evita encher a fila de itens que a trava do envio cancelaria.
  // A trava definitiva é a de processClaimedItem, imediatamente antes de enviar.
  const humanBlocked = await listPhonesBlockedByHumanConversation(eligibleBase.map((round) => round.contact.phone_normalized));
  const eligibleAll = eligibleBase.filter((round) => !humanBlocked.has(round.contact.phone_normalized));
  return eligibleAll;
}

/* ------------------- Política de disparos v2 (REGRA OFICIAL — dono, 2026-10-04) ------------------- */
// Vale SÓ para o corretor com daily_goal_auto_settings.policy_v2_enabled = true (padrão desligado; coluna ausente =
// desligada). Regras puras em lib/daily-goal-policy-core.mjs; aqui só a leitura/gravação do banco. Resumo: 30 mensagens
// por dia por número (10/10/10 por tentativa; a fila extra conta só no total), segunda a sábado 06:30–15:30, nunca
// duas mensagens juntas (90 s a 8 min, pausa de 15–30 min a cada 8–12 envios), reconexão sem rajada (atrasados são
// REPROGRAMADOS, 1º envio ≥ 5 min depois de conectar) e o que não saiu hoje passa ao dia seguinte sem cancelar.

// Configuração com a política v2 aplicada (janela 06:30–15:30, nunca domingo) quando a chave do corretor está ligada;
// sem a chave, a linha volta como está. `extraWindow` é a janela que a fila extra ("Disparar") usa na v2.
// Fila extra sem v2 pode rodar fora da janela da Meta Diária (07–21h, prospecting-extra-core.mjs).
function resolvePolicySettings(row) {
  const policyV2 = isPolicyV2Enabled(row);
  const settings = policyV2 ? applyPolicyV2(row) : row;
  const extraWindow = policyV2 ? { startMinutes: settings.window_start_minutes, endMinutes: settings.window_end_minutes } : null;
  return { policyV2, settings, extraWindow };
}

const V2_USAGE_COLUMNS = "id, attempt_number, source, status, wa_message_id, send_started_at, sent_at";

// Uso de HOJE do número (Meta Diária + fila extra) — base do teto de 30, do intervalo e da pausa.
async function loadV2Usage(brokerId, { excludeItemId = null } = {}) {
  const dayStart = `${getTodayInSaoPaulo()}T00:00:00-03:00`;
  const { data, error } = await db().from("daily_goal_auto_queue")
    .select(V2_USAGE_COLUMNS).eq("broker_id", brokerId)
    .or(`send_started_at.gte.${dayStart},sent_at.gte.${dayStart}`)
    .limit(500);
  if (error) throw error;
  return summarizeV2Usage(data || [], { excludeItemId });
}

// Instante da última conexão da sessão (whatsapp_individual_sessions.last_connected_at). Com dois números
// (2026-10-08): a conexão MAIS RECENTE entre os números aptos ao disparo (o mais restritivo — nunca rajada
// logo depois de um número voltar).
async function loadV2ConnectedAtMs(brokerId) {
  const { rows, slots } = await getDispatchSessionState(brokerId);
  const candidates = rows.filter((row) => slots.includes(normalizeSlot(row.slot) || 1));
  const list = candidates.length ? candidates : rows.filter((row) => (normalizeSlot(row.slot) || 1) === 1);
  const times = list.map((row) => (row?.last_connected_at ? new Date(row.last_connected_at).getTime() : NaN)).filter((ms) => !Number.isNaN(ms));
  return times.length ? Math.max(...times) : null;
}

// Por qual número sai o próximo envio automático (REGRA OFICIAL — dono, 2026-10-08): só números conectados com
// "Usar para disparo" ligado; com dois, meio a meio (pickDispatchSlot). Conta os envios iniciados HOJE por número
// (antes desta mudança tudo saía pelo Número 1: session_slot vazio = 1). Nenhum apto = null.
async function chooseDispatchSlot(brokerId) {
  const { slots } = await getDispatchSessionState(brokerId);
  if (slots.length <= 1) return slots[0] || null;
  const dayStart = `${getTodayInSaoPaulo()}T00:00:00-03:00`;
  const { data, error } = await db().from("daily_goal_auto_queue")
    .select("session_slot, send_started_at").eq("broker_id", brokerId)
    .gte("send_started_at", dayStart).order("send_started_at", { ascending: false }).limit(500);
  if (error) throw error;
  const sentTodayBySlot = {};
  for (const row of data || []) {
    const slot = normalizeSlot(row.session_slot) || 1;
    sentTodayBySlot[slot] = (sentTodayBySlot[slot] || 0) + 1;
  }
  return pickDispatchSlot({ candidates: slots, sentTodayBySlot, lastSlot: data?.[0] ? normalizeSlot(data[0].session_slot) || 1 : null });
}

// Limpeza do excesso da fila (REGRA OFICIAL — dono, 2026-10-04). Só para corretor com automação ligada e política v2
// vigente. Mantém no máximo 10 pendentes da Meta Diária por tentativa (os 10 prioritários, na ordem normal da fila:
// scheduled_for, created_at) e CANCELA só os excedentes da fila (skip_reason = policy_v2_trim_excess). Não envia nada,
// não toca cliente, funil, histórico nem rodada; os excedentes nunca são recriados (ver loadEligibleEnqueueRounds).
// Idempotente. O rastro fica no motivo de cada item cancelado e (quando a tabela existe) em daily_goal_policy_trim_log.
async function trimV2QueueExcess(brokerId, rawSettingsRow) {
  if (!rawSettingsRow?.enabled || !isPolicyV2Enabled(rawSettingsRow)) return { trimmed: 0 };
  const { data: pending, error } = await db().from("daily_goal_auto_queue")
    .select("id, attempt_number, scheduled_for, created_at")
    .eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta");
  if (error) throw error;
  const plan = planV2Trim(pending || []);
  if (!plan.trimIds.length) return { trimmed: 0 };
  const nowIso = new Date().toISOString();
  // Só enquanto continua 'pending': um item reivindicado nesse meio-tempo nunca é mexido.
  const { data: canceled, error: cancelError } = await db().from("daily_goal_auto_queue")
    .update({ status: "canceled", skip_reason: TRIM_SKIP_REASON, updated_at: nowIso })
    .in("id", plan.trimIds).eq("status", "pending").select("id, attempt_number");
  if (cancelError) throw cancelError;
  const trimmedByAttempt = { 1: 0, 2: 0, 3: 0 };
  for (const row of canceled || []) trimmedByAttempt[row.attempt_number] += 1;
  const logRows = [1, 2, 3].filter((a) => trimmedByAttempt[a] > 0).map((a) => ({
    broker_id: brokerId,
    attempt_number: a,
    kept: plan.byAttempt[a].kept,
    trimmed: trimmedByAttempt[a],
    trimmed_at: nowIso,
    policy: TRIM_POLICY_NAME
  }));
  console.log(`Política v2: excesso da fila retirado (corretor ${brokerId}): ${JSON.stringify(trimmedByAttempt)}.`);
  if (logRows.length) {
    const { error: logError } = await db().from("daily_goal_policy_trim_log").insert(logRows);
    // Tabela de auditoria ausente (migration complementar não aplicada) não impede a limpeza: o rastro fica no
    // motivo dos itens cancelados. Erro é registrado, não escondido.
    if (logError) console.warn(`Política v2: não gravou daily_goal_policy_trim_log (corretor ${brokerId}): ${logError.message}`);
  }
  return { trimmed: (canceled || []).length, byAttempt: trimmedByAttempt };
}

// Reprograma (UPDATE do scheduled_for, nunca cancela) os pendentes da Meta Diária quando algum ficou velho: dia
// anterior, fora da janela, atrasado, ou "vencido" enquanto a sessão reconectava. `force` reprograma sempre.
async function rescheduleV2Queue(brokerId, rawSettingsRow, { force = false } = {}) {
  const settings = applyPolicyV2(rawSettingsRow);
  await trimV2QueueExcess(brokerId, rawSettingsRow);
  const { data: pending, error } = await db().from("daily_goal_auto_queue")
    .select("id, attempt_number, scheduled_for")
    .eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta");
  if (error) throw error;
  if (!pending?.length) return { rescheduled: 0 };
  const nowMs = Date.now();
  const today = getTodayInSaoPaulo();
  const connectedAtMs = await loadV2ConnectedAtMs(brokerId);
  const stale = findStaleV2Items(pending, { nowMs, dateStr: today, settings, connectedAtMs });
  if (!force && !stale.length) return { rescheduled: 0 };
  const usage = await loadV2Usage(brokerId);
  const updates = rescheduleV2Items(pending, { nowMs, dateStr: today, settings, usage, connectedAtMs, todayAllowed: isBusinessDay(saoPauloNow().weekday) });
  const nowIso = new Date().toISOString();
  await Promise.all(updates.map(async (update) => {
    // Só enquanto continua 'pending': um item que acabou de ser reivindicado nunca é mexido.
    const { error: updateError } = await db().from("daily_goal_auto_queue")
      .update({ scheduled_for: new Date(update.scheduledMs).toISOString(), updated_at: nowIso })
      .eq("id", update.id).eq("status", "pending");
    if (updateError) throw updateError;
  }));
  return { rescheduled: updates.length };
}

// Fila de HOJE pela política v2: completa até 30 (10/10/10) com horários espaçados, depois do que já saiu/está
// agendado. O que não couber hoje NÃO é criado agora: a rodada continua ativa e entra amanhã (a fila é derivada das
// rodadas ativas), sem cancelar nada e sem duplicar (itens existentes seguem valendo).
async function enqueueTodayItemsV2(brokerId, rawSettingsRow, brokerProfile = {}) {
  const settings = applyPolicyV2(rawSettingsRow);
  const today = getTodayInSaoPaulo();
  await rescheduleV2Queue(brokerId, rawSettingsRow);
  const { minutes: nowMinutes, weekday } = saoPauloNow();
  if (!isBusinessDay(weekday)) return 0;
  if (nowMinutes > settings.window_end_minutes) return 0;

  const [usage, pendingResult] = await Promise.all([
    loadV2Usage(brokerId),
    db().from("daily_goal_auto_queue").select("attempt_number, scheduled_for").eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta")
  ]);
  if (pendingResult.error) throw pendingResult.error;
  const dayStartMs = saoPauloInstantMs(today, 0);
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const pendingTodayByAttempt = { 1: 0, 2: 0, 3: 0 };
  const pendingTimes = [];
  for (const row of pendingResult.data || []) {
    const ms = new Date(row.scheduled_for).getTime();
    if (pendingTodayByAttempt[row.attempt_number] === undefined) continue;
    // Pendentes de QUALQUER dia contam na vaga da tentativa (máx. 10 por tentativa na fila; nada de acumular).
    pendingTodayByAttempt[row.attempt_number] += 1;
    if (ms >= dayStartMs && ms < dayEndMs) pendingTimes.push(ms);
  }
  const allowance = v2EnqueueAllowance({ usage, pendingTodayByAttempt, settings });
  if (allowance.totalLeft <= 0) return 0;

  const eligibleByAttempt = [];
  for (const attempt of [1, 2, 3]) {
    if (!(allowance.byAttempt[attempt] > 0)) continue;
    const rounds = await loadEligibleEnqueueRounds(brokerId, today, { attemptCount: attempt - 1, limit: 60 });
    for (const round of rounds) eligibleByAttempt.push({ round, attempt });
  }
  const picked = pickV2EnqueueCandidates(shuffleArray(eligibleByAttempt), allowance);
  if (!picked.length) return 0;

  const timeline = [...usage.sendTimesMs, ...pendingTimes].sort((a, b) => a - b);
  const lastReferenceMs = Math.max(usage.lastSendMs ?? 0, ...pendingTimes, 0) || null;
  const times = planV2Schedule({
    count: picked.length,
    nowMs: Date.now(),
    dateStr: today,
    settings,
    lastSendMs: lastReferenceMs,
    sendsSinceLastPauseCount: sendsSinceLastPause(timeline),
    connectedAtMs: await loadV2ConnectedAtMs(brokerId)
  });

  // O MODELO não é escolhido aqui (como na política antiga): grava só um texto provisório e variant_index nulo;
  // o modelo de verdade é sorteado no envio (selectVariantForSend).
  const rows = [];
  for (let i = 0; i < picked.length && i < times.length; i += 1) {
    const { round, attempt } = picked[i];
    const provisional = V2_AUTO_MESSAGES[`message${attempt}`]?.[0]?.text;
    const messageText = provisional ? renderAutoMessage(provisional, {
      saudacao: getTimeGreeting(),
      primeiroNome: firstName(round.contact?.name),
      nomeCorretor: firstName(brokerProfile.name),
      corretorGender: brokerProfile.gender || ""
    }) : "";
    if (!messageText) continue;
    rows.push({
      round_id: round.id,
      broker_id: brokerId,
      contact_id: round.prospecting_contact_id,
      attempt_number: attempt,
      message_text: messageText,
      scheduled_for: new Date(times[i]).toISOString(),
      status: "pending",
      variant_index: null
    });
  }
  if (!rows.length) return 0;
  const { data: insertedCount, error: insertError } = await db().rpc("insert_daily_goal_auto_queue_items", { items: rows });
  if (insertError) throw insertError;
  return insertedCount || 0;
}

// Rechecagem logo DEPOIS do claim (anti-corrida): duas execuções do cron em paralelo nunca mandam duas mensagens
// juntas. O claim já é atômico por corretor (advisory lock + recusa se há item "enviando"); aqui, com o item
// reivindicado, relê o uso do dia SEM ele e confere teto, intervalo, pausa e reconexão. Se algo bloqueia, o item
// volta para 'pending' (teto da tentativa: vai para o próximo dia de disparo) e o ciclo para. Devolve o motivo ou null.
async function v2GuardAfterClaim({ item, brokerId, settings, source }) {
  const [usage, connectedAtMs] = await Promise.all([loadV2Usage(brokerId, { excludeItemId: item.id }), loadV2ConnectedAtMs(brokerId)]);
  const reason = v2SendBlockReason({ nowMs: Date.now(), usage, settings, connectedAtMs, attemptNumber: item.attempt_number, source });
  if (!reason) return null;
  if (reason === "teto_por_tentativa_politica") {
    const nextStart = saoPauloInstantMs(nextSendingDate(getTodayInSaoPaulo()), settings.window_start_minutes);
    await markItem(item.id, { status: "pending", scheduled_for: new Date(nextStart).toISOString() });
  } else {
    await markItem(item.id, { status: "pending" });
  }
  return reason;
}

// Envios reais recentes do número, de QUALQUER tentativa (do mais antigo ao mais recente) — alternância curto/longo.
async function loadRecentSendsAnyAttempt(brokerId) {
  const { data, error } = await db().from("daily_goal_auto_queue")
    .select("attempt_number, variant_index, status, wa_message_id, skip_reason, send_started_at, sent_at, updated_at")
    .eq("broker_id", brokerId)
    .not("variant_index", "is", null)
    .or("status.eq.sent,wa_message_id.not.is.null,skip_reason.eq.enviando_sem_confirmacao")
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  const at = (row) => new Date(row.send_started_at || row.sent_at || row.updated_at).getTime();
  return (data || []).filter(wasVariantActuallySent).sort((a, b) => at(a) - at(b)).map((row) => ({ attempt_number: row.attempt_number, variant_index: row.variant_index }));
}


// Completa a fila do corretor para hoje: pega rodadas ativas com
// attempt_count < 3 (ainda faltam tentativas) que ainda não têm item de
// fila para a PRÓXIMA tentativa delas (pending/sent/sending), até o teto do
// dia (computeDailyAutoCap = todas as atividades pendentes agora, até 100 —
// pedido do dono, 2026-09-30), embaralha a ordem (1ª/2ª/3ª tentativa se
// misturam sem padrão previsível, não mais FIFO por rodada — ajuda a variar
// o ritmo/tipo de mensagem e reduzir risco de banimento) e agenda horários
// espalhados dentro da janela configurada.
async function enqueueTodayItemsForBroker(brokerId, rawSettingsRow, brokerProfile = {}) {
  if (isPolicyV2Enabled(rawSettingsRow)) return enqueueTodayItemsV2(brokerId, rawSettingsRow, brokerProfile);
  const today = getTodayInSaoPaulo();
  // Janela EFETIVA do dia (compensação por restrição validada, 2026-10-02): fim da janela estendido,
  // cadência congelada na janela base (ver lib/daily-goal-window-core.mjs).
  const settingsRow = await withEffectiveWindow(rawSettingsRow, { date: today });

  const { count: usedToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true })
    .eq("broker_id", brokerId)
    .eq("source", "meta")
    .in("status", ["pending", "sending", "sent"])
    .gte("created_at", `${today}T00:00:00-03:00`);

  const eligibleAll = await loadEligibleEnqueueRounds(brokerId, today);
  if (!eligibleAll.length) return 0;

  // Teto de hoje = tudo que já está em fila/enviado + tudo que ainda está
  // elegível agora, até o máximo de HARD_DAILY_CAP.
  const cap = computeDailyAutoCap({
    totalActivities: (usedToday || 0) + eligibleAll.length,
    dailyCapOverride: settingsRow.daily_cap_override
  });
  const remaining = Math.max(0, cap - (usedToday || 0));
  if (remaining <= 0) return 0;

  const eligible = shuffleArray(eligibleAll).slice(0, remaining);
  if (!eligible.length) return 0;

  const { minutes: nowMinutes } = saoPauloNow();
  const scheduleMinutes = spreadScheduleMinutes({
    count: eligible.length,
    windowStartMinutes: settingsRow.window_start_minutes,
    windowEndMinutes: settingsRow.window_end_minutes,
    minGapMinutes: settingsRow.min_gap_minutes,
    maxGapMinutes: settingsRow.max_gap_minutes,
    oscillateEnabled: Boolean(settingsRow.oscillate_enabled),
    oscillatePercent: settingsRow.oscillate_percent ?? 50,
    maxAverageGapMinutes: settingsRow.max_avg_gap_minutes ?? null,
    cadenceCursorMinutes: settingsRow.window_cadence?.cursorMinutes ?? null,
    cadenceWindowEndMinutes: settingsRow.window_cadence?.endMinutes ?? null,
    nowMinutes
  });

  const autoMessages = await getDailyGoalAutoMessages();
  // O MODELO não é escolhido aqui (2026-10-02): a fila é montada para o dia
  // inteiro e muita coisa muda antes do envio (resposta, Não contactar,
  // reagendamento). Grava só um texto provisório (1º modelo, para validar
  // que a tentativa tem modelo) e variant_index nulo; o modelo de verdade é
  // sorteado com anti-repetição no momento do envio (selectVariantForSend).
  const rows = [];
  for (let i = 0; i < eligible.length && i < scheduleMinutes.length; i += 1) {
    const round = eligible[i];
    const attemptNumber = round.attempt_count + 1;
    const variants = autoMessages[`message${attemptNumber}`];
    if (!variants?.length) continue;
    const messageText = renderAutoMessage(variants[0], {
      saudacao: getTimeGreeting(),
      primeiroNome: firstName(round.contact?.name),
      nomeCorretor: firstName(brokerProfile.name),
      corretorGender: brokerProfile.gender || ""
    });
    if (!messageText) continue;

    rows.push({
      round_id: round.id,
      broker_id: brokerId,
      contact_id: round.prospecting_contact_id,
      attempt_number: attemptNumber,
      message_text: messageText,
      scheduled_for: minutesTodayToIso(scheduleMinutes[i], today),
      status: "pending",
      variant_index: null
    });
  }
  if (!rows.length) return 0;

  // Um insert em lote comum só é aceito se TODAS as linhas passarem — uma
  // única colisão no índice único parcial (round_id, attempt_number), numa
  // corrida entre execuções do cron que se sobrepuseram (mais provável agora
  // que cada execução pode enfileirar dezenas de itens de uma vez, em vez do
  // teto antigo de 20), derrubava o LOTE INTEIRO em silêncio. Uma correção
  // anterior tentou inserir linha a linha, mas isso é lento demais (o cron
  // tem 50s de timeout e cada corretor agora pode ter dezenas de linhas) —
  // trocado por uma função no banco (insert_daily_goal_auto_queue_items) que
  // faz tudo num INSERT ... ON CONFLICT DO NOTHING só, pulando apenas a(s)
  // linha(s) realmente conflitante(s), num único round-trip. Achado real,
  // 2026-09-30: Bruna com 82 atividades pendentes e só 3 chegando na fila.
  const { data: insertedCount, error: insertError } = await db().rpc("insert_daily_goal_auto_queue_items", { items: rows });
  if (insertError) throw insertError;
  return insertedCount || 0;
}

function minutesTodayToIso(minutes, todayPlainDate) {
  // spreadScheduleMinutes (modo com oscilação) devolve minutos fracionados
  // (ex.: 47.79...) — sem arredondar antes, o minuto virava
  // "47.79023124434957" na string final, um timestamp inválido que o
  // Postgres rejeitava (achado real, 2026-09-30: TODOS os corretores
  // falhavam ao enfileirar por causa disso, silenciosamente).
  const roundedMinutes = Math.round(minutes);
  const hour = Math.floor(roundedMinutes / 60);
  const minute = roundedMinutes % 60;
  // -03:00 fixo (América/São_Paulo não observa horário de verão desde 2019).
  return `${todayPlainDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
}

/* ------------------------------- Envio (dispatch) ------------------------------- */

async function markItem(id, patch) {
  await db().from("daily_goal_auto_queue").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

async function pauseBrokerAfterErrors(brokerId, currentErrors) {
  const next = currentErrors + 1;
  const patch = { consecutive_errors: next, updated_at: new Date().toISOString() };
  if (next >= MAX_CONSECUTIVE_ERRORS) {
    patch.paused = true;
    patch.paused_reason = `Pausado automaticamente após ${MAX_CONSECUTIVE_ERRORS} erros seguidos`;
  }
  await db().from("daily_goal_auto_settings").update(patch).eq("broker_id", brokerId);
  return next >= MAX_CONSECUTIVE_ERRORS;
}

// Item pendente com horário que a configuração ATUAL não permite (outro dia,
// ou fora da janela — ex.: calculado com a janela antiga) faz a fila do
// corretor ser recalculada pela mesma função do botão "Reagendar". Devolve
// null quando a fila já está válida.
async function repairInvalidPendingQueue(brokerId, rawSettingsRow, brokerName = "") {
  // Janela EFETIVA: item agendado na parte compensada (restrição validada) é válido, não é recalculado.
  const settingsRow = await withEffectiveWindow(rawSettingsRow);
  const { data: pendingRows, error } = await db().from("daily_goal_auto_queue")
    .select("scheduled_for").eq("broker_id", brokerId).eq("status", "pending").eq("source", "meta");
  if (error) throw error;
  const config = { now: new Date(), windowStartMinutes: settingsRow.window_start_minutes, windowEndMinutes: settingsRow.window_end_minutes };
  const invalid = (pendingRows || []).filter((row) => isScheduleOutsideCurrentConfig(row.scheduled_for, config)).length;
  if (!invalid) return null;
  const result = await requeueBrokerQueueCore(brokerId, settingsRow, { name: brokerName, gender: settingsRow.broker?.gender || "" }, "reagendado_fora_da_configuracao");
  console.log(`Fila da Meta Diária recalculada (corretor ${brokerId}): ${invalid} item(ns) fora da configuração atual.`);
  return { invalid, ...result };
}

// Quantos itens descartados seguidos (obsoletos OU que falharam de verdade
// no envio) o dispatcher pula DENTRO do mesmo ciclo antes de desistir — nunca
// CONTA mais de 1 mensagem enviada com sucesso por ciclo (a pausa entre
// envios reais continua a mesma, isso não acelera o ritmo de envio),  só
// evita gastar um ciclo inteiro de 5 min preso num item que não vai sair de
// jeito nenhum: rodada que já saiu por outro caminho, e agora (pedido do
// dono, 2026-09-30, repetido: "se não foi enviado por erro ou falha, ele
// deve buscar o próximo cliente, esse deve ser descartado") também um envio
// que falhou de verdade (número inválido, recusa do WhatsApp, confirmação de
// entrega que nunca chegou) — descarta e tenta o próximo cliente da fila na
// hora, em vez de travar o corretor inteiro até o próximo ciclo. O contador
// de erros seguidos (pauseBrokerAfterErrors) continua valendo do mesmo jeito
// — se acumular 3 falhas REAIS de envio (não itens obsoletos, que não contam
// como erro), a automação pausa sozinha e o ciclo para ali, não fica
// tentando enviar pra galera inteira com a sessão claramente quebrada.
const MAX_STALE_SKIPS_PER_CYCLE = 20;

// Reivindica e envia NO MÁXIMO 1 item pendente do corretor. Ordem exigida
// (item 3 do pedido): reivindicar (claim atômico) -> REVALIDAR tudo de novo
// no momento do envio -> enviar -> só então registrar a tentativa. Envio que
// falhou nunca conta tentativa; registro que falhar DEPOIS do envio nunca
// gera reenvio (fica 'error' para reconciliação manual, nunca duplica).
// Exceção temporária por data (TEMPORARY_DISPATCH_REDUCTIONS, daily-goal-auto-core.mjs): metade dos envios do dia.
// Conta o dia do corretor (itens da Meta Diária agendados hoje, fuso de São Paulo): enviados + em envio (exceto
// este) = `sent`; pendentes (incluindo este) = `pending`; já descartados pela redução = `dropped`. O total
// (o que seria enviado sem a exceção) é estável durante o dia; o alvo é metade dele. Item descartado fica
// 'canceled' com skip_reason próprio — a rodada continua intacta e volta a ser elegível amanhã.
async function dropItemByTemporaryReduction({ item, brokerId }) {
  const today = getTodayInSaoPaulo();
  const reduction = temporaryDispatchReductionFor(today);
  if (!reduction) return false;
  const { data: rows, error } = await db().from("daily_goal_auto_queue")
    .select("id, status, skip_reason")
    .eq("broker_id", brokerId).eq("source", "meta")
    .gte("scheduled_for", `${today}T00:00:00-03:00`).lte("scheduled_for", `${today}T23:59:59-03:00`);
  if (error) throw error;
  let sent = 0;
  let pending = 1; // este item
  let dropped = 0;
  for (const row of rows || []) {
    if (row.id === item.id) continue;
    if (row.status === "sent" || row.status === "sending") sent += 1;
    else if (row.status === "pending") pending += 1;
    else if (row.status === "canceled" && row.skip_reason === reduction.skipReason) dropped += 1;
  }
  const decision = decideTemporaryReduction({ factor: reduction.factor, sent, pending, dropped });
  if (decision.keep) return false;
  const { error: dropError } = await db().from("daily_goal_auto_queue")
    .update({ status: "canceled", skip_reason: reduction.skipReason, updated_at: new Date().toISOString() })
    .eq("id", item.id).eq("status", "sending");
  if (dropError) throw dropError;
  return true;
}

async function dispatchOneForBroker(brokerId, brokerName, rawSettingsRow) {
  // Política v2 (2026-10-04): janela 06:30–15:30, intervalo/pausa/teto próprios e reprogramação em vez de recálculo.
  const policyV2 = isPolicyV2Enabled(rawSettingsRow);
  const settingsRow = policyV2 ? applyPolicyV2(rawSettingsRow) : await withEffectiveWindow(rawSettingsRow);
  // Antes de tudo (inclusive fora da janela): fila com item que a
  // configuração atual não permite é recalculada, nunca enviada.
  // (v2: a reprogramação dos itens velhos já rodou em enqueueTodayItemsV2, antes deste passo.)
  if (!policyV2) {
    const repaired = await repairInvalidPendingQueue(brokerId, settingsRow, brokerName);
    if (repaired) return { skipped: "fila_recalculada_fora_da_configuracao", ...repaired };
  }

  const { minutes: nowMinutes, weekday } = saoPauloNow();
  if (!isWithinWindow(nowMinutes, settingsRow.window_start_minutes, settingsRow.window_end_minutes)) return { skipped: "fora_da_janela" };
  if (settingsRow.business_days_only && !isBusinessDay(weekday)) return { skipped: "fim_de_semana" };

  const sessionStatus = await getDispatchSessionStatusForUser(brokerId);
  const channel = pickSendChannel({ assignedUserId: brokerId, individualSessionStatus: sessionStatus });
  if (channel !== "individual") return { skipped: "sessao_nao_conectada" };

  // Filas diferentes nunca geram dois envios colados pelo mesmo número: se o
  // último envio deste WhatsApp veio da fila extra ("Disparar"), a Meta
  // Diária espera o intervalo mínimo configurado (2026-10-02).
  if (policyV2) {
    // Teto de 30, intervalo mínimo, pausa e espera pós-reconexão valem para o número inteiro (as duas filas).
    const [usage, connectedAtMs] = await Promise.all([loadV2Usage(brokerId), loadV2ConnectedAtMs(brokerId)]);
    const policyReason = v2SendBlockReason({ nowMs: Date.now(), usage, settings: settingsRow, connectedAtMs });
    if (policyReason) return { skipped: policyReason };
  } else {
    const lastSend = await getLastSendForBroker(brokerId);
    if (lastSend?.source === "extra" && minutesUntilNextSendAllowed({ lastSendAt: lastSend.at, gapMinutes: settingsRow.min_gap_minutes })) {
      return { skipped: "aguardando_intervalo_apos_fila_extra" };
    }
  }

  const staleSkips = [];
  for (let round = 0; round < MAX_STALE_SKIPS_PER_CYCLE; round += 1) {
    const { data: item, error: claimError } = await db().rpc("claim_next_daily_goal_auto_item", { p_broker_id: brokerId });
    if (claimError) throw claimError;
    if (!item) return { skipped: "fila_vazia", staleSkips };

    // Política v2: rechecagem depois do claim (anti-corrida entre execuções do cron).
    if (policyV2) {
      const guardReason = await v2GuardAfterClaim({ item, brokerId, settings: settingsRow, source: "meta" });
      if (guardReason) return { skipped: guardReason, staleSkips };
    }

    // Exceção temporária por data (50% dos disparos em 03/10/2026): o item reivindicado pode ser descartado
    // aqui, ANTES de qualquer envio — segue para o próximo da fila. Fora da data, não faz nada.
    try {
      if (await dropItemByTemporaryReduction({ item, brokerId })) continue;
    } catch (reductionError) {
      // Na dúvida NÃO envia: devolve o item à fila e encerra o ciclo (nunca dispara a mais por falha aqui).
      console.error(`Redução temporária: falha ao decidir o item ${item.id}; devolvido à fila.`, reductionError?.message || reductionError);
      await markItem(item.id, { status: "pending", last_error: `Redução temporária: ${String(reductionError?.message || reductionError).slice(0, 200)}` });
      return { skipped: "erro_reducao_temporaria", staleSkips };
    }

    try {
      const result = await processClaimedItem({ item, brokerId, brokerName, staleSkips, source: "meta" });
      if (result?.done) return result.response;
      // result undefined/continue: item foi descartado (obsoleto, falha de
      // destinatário, etc.) sem bloquear a fila — tenta o próximo item.
    } catch (unexpectedError) {
      // Rede de segurança final (item 4 do pedido: nenhum caminho de erro
      // pode deixar um item reivindicado preso indefinidamente). Qualquer
      // exceção não prevista aqui (ex.: banco fora do ar no meio da
      // revalidação) devolve o item pra fila (nunca marca 'error' sem saber
      // a causa, nunca penaliza o cliente) e para o ciclo — mais seguro do
      // que insistir às cegas com algo desconhecido quebrado.
      console.error(`Item ${item.id} da fila da automação: erro inesperado, devolvendo para a fila.`, unexpectedError?.message || unexpectedError);
      await markItem(item.id, { status: "pending", last_error: `Erro inesperado: ${String(unexpectedError?.message || unexpectedError).slice(0, 300)}` });
      return { skipped: "erro_inesperado", staleSkips };
    }
  }
  return { skipped: "muitos_itens_descartados_seguidos", staleSkips };
}

// Processa 1 item já reivindicado (status='sending'): revalida tudo de novo,
// envia e registra. Devolve { done: true, response } quando o ciclo deve
// PARAR aqui (enviou com sucesso, pausou por erro de infra, ou falhou ao
// registrar após enviar) ou undefined quando deve seguir pro próximo item da
// fila (item obsoleto ou falha técnica atribuível só àquele contato).
async function processClaimedItem({ item, brokerId, brokerName, staleSkips, source = "meta" }) {
  // Revalidação no momento do envio (item 6 do pedido): a rodada ainda
  // precisa estar exatamente esperando a tentativa deste item
  // (round.attempt_count + 1 == item.attempt_number) — se avançou por outro
  // caminho entre o agendamento e agora (tentativa manual, conversão, "não
  // contactar"...) o item ficou obsoleto e é descartado, nunca reenviado com
  // número de tentativa errado.
  const { data: roundRow } = await db().from("daily_goal_rounds")
    .select("id, status, attempt_count, client_id, auto_error_count, contact:prospecting_contacts(name, status, registration_id, phone_normalized)")
    .eq("id", item.round_id).maybeSingle();
  if (!roundRow || roundRow.status !== "active" || roundRow.attempt_count + 1 !== item.attempt_number) {
    await markItem(item.id, { status: "skipped", skip_reason: "round_nao_esta_mais_ativo" });
    staleSkips.push("round_nao_esta_mais_ativo");
    return;
  }
  if (roundRow.contact?.status === "do_not_contact") {
    await markItem(item.id, { status: "skipped", skip_reason: "contato_do_not_contact" });
    staleSkips.push("contato_do_not_contact");
    return;
  }
  if (!String(roundRow.contact?.name || "").trim()) {
    await markItem(item.id, { status: "skipped", skip_reason: "sem_nome" });
    staleSkips.push("sem_nome");
    return;
  }
  // Mesma pessoa pode ter mais de um telefone/linha em prospecting_contacts
  // (legado de importação) — a checagem acima só cobre a linha exata desta
  // rodada. Checa pela PESSOA (por registration_id OU telefone) antes de
  // mandar de verdade, mesma trava dos RPCs de reivindicar contato. Achado
  // real, 2026-09-30 (pente-fino): sem isso, uma rodada presa numa dessas
  // outras linhas (comum quando ainda não teve 1º toque, client_id nulo,
  // fora do alcance de reconcileDailyGoalRounds) podia mandar mensagem de
  // verdade pra quem já pediu pra parar.
  if (await isContactBlockedFromOutreach({ registrationId: roundRow.client_id || roundRow.contact?.registration_id, phoneNormalized: roundRow.contact?.phone_normalized })) {
    await markItem(item.id, { status: "skipped", skip_reason: "contato_do_not_contact" });
    staleSkips.push("contato_do_not_contact");
    return;
  }

  // Fila extra: o cliente precisa continuar com ESTE corretor (transferência
  // no meio do caminho cancela o disparo, nunca manda pelo número antigo).
  if (source === "extra" && roundRow.client_id) {
    const { data: clientRow } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", roundRow.client_id).maybeSingle();
    if (clientRow && clientRow.responsible_user_id && clientRow.responsible_user_id !== brokerId) {
      await markItem(item.id, { status: "skipped", skip_reason: "responsavel_mudou" });
      staleSkips.push("responsavel_mudou");
      return;
    }
  }

  const today = getTodayInSaoPaulo();
  const { count: attemptedToday } = await db().from("daily_goal_attempts")
    .select("id", { count: "exact", head: true }).eq("round_id", roundRow.id).eq("goal_date", today);
  if (attemptedToday) {
    await markItem(item.id, { status: "skipped", skip_reason: "ja_teve_tentativa_hoje" });
    staleSkips.push("ja_teve_tentativa_hoje");
    return;
  }

  const { data: contactRow } = await db().from("prospecting_contacts").select("phone_normalized").eq("id", item.contact_id).maybeSingle();
  if (!contactRow?.phone_normalized) {
    await markItem(item.id, { status: "skipped", skip_reason: "sem_telefone" });
    staleSkips.push("sem_telefone");
    return;
  }

  // PRE-SEND HOOK — Google Contacts (pedido do dono, 2026-10-01): só entra
  // em ação para o corretor que conectou a própria conta Google e ativou a
  // sincronização (isGoogleContactsSyncEnabledForBroker já checa a flag
  // global + a conexão deste corretor); para todo o resto (hoje, 100% dos
  // corretores), o fluxo continua idêntico ao de antes, sem nenhum atraso
  // ou chamada extra. Integração PARALELA ao WhatsApp — nunca toca em
  // sessão/socket/credencial do Baileys, só decide se libera o envio.
  if (await isGoogleContactsSyncEnabledForBroker(brokerId)) {
    const syncResult = await ensureClientInBrokerContacts({
      brokerId,
      clientId: roundRow.client_id,
      phone: contactRow.phone_normalized,
      name: roundRow.contact?.name
    });
    if (!syncResult.success) {
      // Nunca perde nem duplica a mensagem: devolve o item pra fila (mesmo
      // padrão de retry técnico já usado pra falha de destinatário/infra —
      // ver handleSendFailure) e NÃO avança a tentativa comercial. O
      // WhatsApp deste corretor continua 100% funcional; só o disparo
      // AUTOMÁTICO dele aguarda a sincronização, refletido no card via
      // googleContactsStatus/"Requer reconexão" quando for o caso.
      return handleGoogleSyncFailure({ item, brokerId, reason: syncResult.error, staleSkips });
    }
  }

  // TRAVA FINAL (2026-10-02): relê a configuração AGORA (nunca a do início
  // do ciclo — o admin pode ter salvo outra janela no meio) e confere o
  // horário atual E o horário do próprio item. Fora do permitido: não envia;
  // o item é cancelado e a fila do corretor é recalculada no próximo ciclo
  // (repairInvalidPendingQueue). Nenhum horário gravado no banco passa daqui.
  const currentSettings = await withEffectiveWindow(await getSettingsRow(brokerId));
  const { policyV2, settings: policySettings, extraWindow } = resolvePolicySettings(currentSettings);
  const blockReason = source === "extra"
    ? extraSendBlockReason({ now: new Date(), settings: policySettings, policyWindow: extraWindow })
    : sendBlockReason({ scheduledFor: item.scheduled_for, now: new Date(), settings: policySettings });
  if (blockReason) {
    if (blockReason === "agendado_fora_da_configuracao") {
      await markItem(item.id, { status: "canceled", skip_reason: "bloqueado_fora_da_janela_no_envio" });
    } else {
      // Janela fechou/automação pausou no meio do ciclo: o item volta
      // intacto para a fila (não é falha nem do cliente nem técnica).
      await markItem(item.id, { status: "pending" });
    }
    return { done: true, response: { skipped: blockReason, staleSkips } };
  }

  // Modelo escolhido AGORA, no último passo antes do envio (anti-repetição
  // por WhatsApp/tentativa, mesma regra para Meta Diária e fila extra). Só
  // um item por corretor fica em "enviando" por vez (claim_* no banco), então
  // duas escolhas do mesmo número nunca correm em paralelo.
  const selected = await selectVariantForSend({ brokerId, attemptNumber: item.attempt_number, contactName: roundRow.contact?.name, policyV2 });
  if (!selected || selected.invalid) {
    const reason = selected?.invalid ? "modelo_com_variavel_invalida" : "sem_modelo_de_mensagem";
    // Nunca envia texto quebrado. O item é cancelado (não trava a fila do
    // corretor; "canceled" não impede reenfileirar) e a tentativa NÃO é
    // gasta: a rodada continua ativa e volta à fila, e sai assim que o
    // modelo for corrigido em Gestão.
    await markItem(item.id, { status: "canceled", skip_reason: reason });
    return { done: true, response: { skipped: reason, staleSkips } };
  }
  item.message_text = selected.text;
  item.variant_index = selected.index;

  // TRAVA DE CONVERSA HUMANA (decisão do dono, 2026-10-03), revalidada AQUI, imediatamente antes do envio:
  // a cadência automática nunca manda por cima de uma conversa humana recente (pessoa da equipe mandou
  // mensagem — pelo Chat ou pelo celular — ou o cliente escreveu). Lê o estado ATUAL da conversa (nunca o
  // da montagem da fila) e não usa last_whatsapp_contact_at (também gravado por clique e pela automação).
  // Bloqueado: o item é cancelado com o motivo (a tentativa NÃO é gasta; a rodada volta a ser elegível quando a
  // conversa esfriar) e o ciclo segue para o próximo. Erro de leitura propaga: na dúvida, não envia.
  const humanBlock = await humanConversationBlockFor(contactRow.phone_normalized);
  if (humanBlock) {
    await markItem(item.id, { status: "canceled", skip_reason: humanBlock });
    staleSkips.push(humanBlock);
    return;
  }

  // Marca de "envio começou" ANTES de chamar o WhatsApp: se o processo morrer
  // daqui em diante, a varredura de itens presos (recoverStuckSendingItems)
  // sabe que o envio é incerto e NUNCA reenvia. Grava junto o modelo/texto
  // que vai sair de fato.
  // Número do envio (dois números, 2026-10-08): escolhido AGORA, entre os conectados com "Usar para disparo"
  // ligado; nenhum apto = o item volta intacto para a fila (não é falha do contato nem conta como erro).
  const dispatchSlot = await chooseDispatchSlot(brokerId);
  if (!dispatchSlot) {
    await markItem(item.id, { status: "pending" });
    return { done: true, response: { skipped: "sessao_nao_conectada", staleSkips } };
  }
  const { data: markedRows, error: markerError } = await db().from("daily_goal_auto_queue").update({ send_started_at: new Date().toISOString(), message_text: selected.text, variant_index: selected.index, session_slot: dispatchSlot, updated_at: new Date().toISOString() }).eq("id", item.id).eq("status", "sending").select("id");
  if (markerError) {
    await markItem(item.id, { status: "pending" });
    return { done: true, response: { skipped: "falha_ao_marcar_inicio_do_envio", staleSkips } };
  }
  // 0 linhas = o item deixou de estar "enviando" no meio do caminho (ex.: recuperação de itens presos o
  // devolveu) — enviar agora duplicaria a mensagem (auditoria incremental 2026-10-02).
  if (!markedRows?.length) return { done: true, response: { skipped: "item_nao_esta_mais_enviando", staleSkips } };

  let sendResult;
  try {
    sendResult = await sendIndividualMessage(brokerId, { to: contactRow.phone_normalized, text: item.message_text, slot: dispatchSlot });
  } catch (sendError) {
    return handleSendFailure({ item, roundRow, brokerId, sendError, staleSkips });
  }

  try {
    await registerDailyGoalAttemptAutomated({ roundId: item.round_id, brokerId, brokerName, text: item.message_text });
  } catch (registerError) {
    // Enviado mas não registrado — NUNCA reenvia (idempotência, item 3).
    // Fica marcado como erro para reconciliação manual, com o wa_message_id
    // já salvo para achar a mensagem de verdade no Chat se precisar.
    await markItem(item.id, {
      status: "error",
      last_error: `Enviado (${sendResult.messageId}) mas falhou ao registrar a tentativa: ${String(registerError?.message || registerError).slice(0, 300)}`,
      wa_message_id: sendResult.messageId,
      sent_at: new Date().toISOString()
    });
    return { done: true, response: { error: "falha_ao_registrar_apos_envio", staleSkips } };
  }

  await markItem(item.id, { status: "sent", sent_at: new Date().toISOString(), wa_message_id: sendResult.messageId });
  await db().from("daily_goal_auto_settings").update({ consecutive_errors: 0 }).eq("broker_id", brokerId);
  // Retry técnico resolvido: um envio de sucesso prova que o número é
  // alcançável, então zera o contador de falhas atribuíveis ao contato desta
  // rodada (não faz sentido continuar "contando" contra quem acabou de
  // receber mensagem de verdade).
  if (roundRow.auto_error_count) {
    await db().from("daily_goal_rounds").update({ auto_error_count: 0 }).eq("id", roundRow.id);
  }
  return { done: true, response: { sent: true, staleSkips } };
}

// Erro de ENVIO classificado em 'contact' (atribuível ao destinatário) ou
// 'infra' (sessão/microsserviço/rede) — pedido do dono, 2026-09-30, item
// central desta mudança: os dois NUNCA podem ser tratados do mesmo jeito.
async function handleSendFailure({ item, roundRow, brokerId, sendError, staleSkips }) {
  // Acesso WhatsApp bloqueado entre o ciclo e o envio (2026-10-04): NÃO é falha de infraestrutura nem do contato —
  // devolve o item intacto (sem penalizar, sem contar tentativa, sem pausar a automação, sem consumir o teto do dia)
  // e para o ciclo. O envio nunca saiu.
  if (sendError?.code === WHATSAPP_ACCESS_BLOCKED_CODE) {
    await markItem(item.id, { status: "pending", send_started_at: null });
    staleSkips.push("acesso_whatsapp_bloqueado");
    return { done: true, response: { skipped: "acesso_whatsapp_bloqueado", staleSkips } };
  }
  const kind = classifySendError(sendError);
  const message = String(sendError?.message || sendError).slice(0, 500);

  if (kind === "infra") {
    // Nunca penaliza o cliente (nem tentativa comercial, nem retry dele) e
    // nunca conta como "Erro" — devolve o item pra fila (status='pending',
    // mesmo scheduled_for) pra ser tentado de novo automaticamente quando a
    // sessão/infra voltar, e PARA o ciclo aqui: continuar tentando outros
    // clientes com a sessão claramente quebrada só desperdiçaria o ciclo
    // inteiro (pedido do dono: "não pode virar dezenas de clientes com erro
    // por causa de uma queda do serviço").
    await markItem(item.id, { status: "pending", last_error: message, attempts_count: (item.attempts_count || 0) + 1 });
    const settingsRowNow = await getSettingsRow(brokerId);
    const paused = await pauseBrokerAfterErrors(brokerId, settingsRowNow?.consecutive_errors || 0);
    staleSkips.push("falha_infraestrutura");
    return { done: true, response: { skipped: "falha_infraestrutura", paused, staleSkips } };
  }

  // 'contact': só incrementa AQUI (nunca mexe em consecutive_errors/pausa
  // global — 3 números diferentes com problema não significa WhatsApp
  // quebrado). Retry técnico (não comercial): mesma tentativa, reagendada
  // mais à frente, sem tocar attempt_count.
  const nextErrorCount = (roundRow.auto_error_count || 0) + 1;
  if (nextErrorCount >= MAX_CONTACT_RETRIES) {
    await db().from("daily_goal_rounds").update({
      status: "auto_error",
      ended_at: new Date().toISOString(),
      auto_error_count: nextErrorCount,
      auto_error_last: message,
      auto_error_at: new Date().toISOString()
    }).eq("id", roundRow.id);
    await markItem(item.id, { status: "error", last_error: message, skip_reason: "movido_para_erro", attempts_count: (item.attempts_count || 0) + 1 });
    staleSkips.push("movido_para_erro");
    return;
  }

  await db().from("daily_goal_rounds").update({
    auto_error_count: nextErrorCount,
    auto_error_last: message,
    auto_error_at: new Date().toISOString()
  }).eq("id", roundRow.id);
  await markItem(item.id, { status: "error", last_error: message, skip_reason: `falha_destinatario_${nextErrorCount}_${MAX_CONTACT_RETRIES}`, attempts_count: (item.attempts_count || 0) + 1 });

  const retryAt = new Date(Date.now() + CONTACT_RETRY_DELAY_MINUTES * 60000).toISOString();
  const { error: retryInsertError } = await db().rpc("insert_daily_goal_auto_queue_items", {
    items: [{
      round_id: item.round_id,
      broker_id: brokerId,
      contact_id: item.contact_id,
      attempt_number: item.attempt_number,
      message_text: item.message_text,
      scheduled_for: retryAt,
      status: "pending",
      variant_index: item.variant_index ?? null,
      source: item.source || "meta",
      extra_cycle_id: item.extra_cycle_id || null
    }]
  });
  if (retryInsertError) console.error(`Falha ao reagendar retry técnico do item ${item.id}:`, retryInsertError.message || retryInsertError);
  staleSkips.push(`falha_destinatario_${nextErrorCount}_${MAX_CONTACT_RETRIES}`);
}

// Falha ao sincronizar o cliente no Google Contacts ANTES do envio (pedido
// do dono, 2026-10-01) — nunca é culpa do cliente nem do WhatsApp, então
// nunca conta como erro de destinatário (round.auto_error_count intocado,
// nunca vira "Erro") nem como falha de infraestrutura do WhatsApp
// (consecutive_errors/pauseBrokerAfterErrors intocados — Google instável
// não pode pausar o WhatsApp de ninguém). Reagenda a MESMA tentativa 30 min
// à frente (mesmo padrão de retry técnico já usado pra falha de
// destinatário) e segue pro próximo item da fila — não bloqueia os demais
// clientes deste corretor nem os de outros.
async function handleGoogleSyncFailure({ item, brokerId, reason, staleSkips }) {
  const message = `Google Contacts: ${String(reason || "falha desconhecida").slice(0, 450)}`;
  await markItem(item.id, { status: "error", last_error: message, skip_reason: "google_contacts_sync_falhou", attempts_count: (item.attempts_count || 0) + 1 });

  const retryAt = new Date(Date.now() + CONTACT_RETRY_DELAY_MINUTES * 60000).toISOString();
  const { error: retryInsertError } = await db().rpc("insert_daily_goal_auto_queue_items", {
    items: [{
      round_id: item.round_id,
      broker_id: brokerId,
      contact_id: item.contact_id,
      attempt_number: item.attempt_number,
      message_text: item.message_text,
      scheduled_for: retryAt,
      status: "pending",
      variant_index: item.variant_index ?? null,
      source: item.source || "meta",
      extra_cycle_id: item.extra_cycle_id || null
    }]
  });
  if (retryInsertError) console.error(`Falha ao reagendar retry de sincronização do Google Contacts (item ${item.id}):`, retryInsertError.message || retryInsertError);
  staleSkips.push("google_contacts_sync_falhou");
}

// Modelos REALMENTE enviados por este WhatsApp (corretor) nesta tentativa,
// do mais antigo para o mais recente — histórico da anti-repetição. Conta
// só o que saiu (status 'sent', ou com id de mensagem do WhatsApp, ou envio
// incerto em revisão); cancelado/pulado/erro antes do envio não conta.
const VARIANT_HISTORY_LIMIT = 60;
async function loadSentVariantHistory(brokerId, attemptNumber) {
  const { data, error } = await db().from("daily_goal_auto_queue")
    .select("variant_index, status, wa_message_id, skip_reason, send_started_at, sent_at, updated_at")
    .eq("broker_id", brokerId)
    .eq("attempt_number", attemptNumber)
    .not("variant_index", "is", null)
    .or("status.eq.sent,wa_message_id.not.is.null,skip_reason.eq.enviando_sem_confirmacao")
    .order("updated_at", { ascending: false })
    .limit(VARIANT_HISTORY_LIMIT);
  if (error) throw error;
  const at = (row) => new Date(row.send_started_at || row.sent_at || row.updated_at).getTime();
  return (data || []).filter(wasVariantActuallySent).sort((a, b) => at(a) - at(b)).map((row) => row.variant_index);
}

// Fonte ÚNICA da escolha do modelo (Meta Diária e "Disparar"), no servidor,
// no momento do envio. Regra pura em pickAntiRepeatVariant.
async function selectVariantForSend({ brokerId, attemptNumber, contactName, policyV2 = false }) {
  if (policyV2) {
    // Política v2: modelos novos (curtos/longos alternados, sem repetir o último nem o penúltimo, sem promessa/link, com SAIR).
    const [recentSends, { data: v2Broker }] = await Promise.all([
      loadRecentSendsAnyAttempt(brokerId),
      db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle()
    ]);
    const v2Index = pickV2Variant({ attemptNumber, recentSends });
    const v2Variant = V2_AUTO_MESSAGES[`message${attemptNumber}`]?.[v2Index];
    if (!v2Variant) return null;
    const v2Text = renderAutoMessage(v2Variant.text, {
      saudacao: getTimeGreeting(),
      primeiroNome: firstName(contactName),
      nomeCorretor: firstName(v2Broker?.name),
      corretorGender: v2Broker?.gender || ""
    });
    if (!v2Text) return null;
    if (hasUnresolvedVariable(v2Text)) return { index: v2Index, text: v2Text, invalid: true };
    return { index: v2Index, text: v2Text };
  }
  const [autoMessages, history, { data: broker }] = await Promise.all([
    getDailyGoalAutoMessages(),
    loadSentVariantHistory(brokerId, attemptNumber),
    db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle()
  ]);
  const variants = autoMessages[`message${attemptNumber}`] || [];
  const index = pickAntiRepeatVariant({ count: variants.length, history });
  if (index < 0) return null;
  // Saudação da hora REAL do envio (America/Sao_Paulo).
  const text = renderAutoMessage(variants[index], {
    saudacao: getTimeGreeting(),
    primeiroNome: firstName(contactName),
    nomeCorretor: firstName(broker?.name),
    corretorGender: broker?.gender || ""
  });
  if (!text) return null;
  // Variável desconhecida/sem valor ({...} sobrando) nunca sai para o cliente.
  if (hasUnresolvedVariable(text)) return { index, text, invalid: true };
  return { index, text };
}

// Último envio deste WhatsApp, de qualquer fila (marca send_started_at,
// gravada imediatamente antes de chamar o WhatsApp; sent_at cobre itens
// antigos sem a marca).
async function getLastSendForBroker(brokerId) {
  const [{ data: byMarker }, { data: bySent }] = await Promise.all([
    db().from("daily_goal_auto_queue").select("send_started_at, source").eq("broker_id", brokerId).not("send_started_at", "is", null).order("send_started_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("daily_goal_auto_queue").select("sent_at, source").eq("broker_id", brokerId).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const candidates = [
    byMarker ? { at: byMarker.send_started_at, source: byMarker.source } : null,
    bySent ? { at: bySent.sent_at, source: bySent.source } : null
  ].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => new Date(b.at) - new Date(a.at))[0];
}

// Fila extra ("Disparar", 2026-10-02): no máximo 1 envio por ciclo do cron,
// só quando a Meta Diária não enviou nada neste ciclo, respeitando o
// intervalo desde o último envio do número (qualquer fila) e dando
// prioridade a item da Meta Diária que vença nos próximos minutos. Mesmo
// processamento do item da Meta Diária (processClaimedItem): revalida tudo,
// envia, registra a 1ª tentativa — da 2ª em diante a rodada segue a cadência
// normal da Meta Diária do MESMO corretor.
async function dispatchExtraForBroker(brokerId, brokerName, settingsRow) {
  const now = new Date();
  const { data: nextExtra, error: nextError } = await db().from("daily_goal_auto_queue")
    .select("id, scheduled_for").eq("broker_id", brokerId).eq("source", "extra").eq("status", "pending")
    .lte("scheduled_for", now.toISOString()).order("scheduled_for", { ascending: true }).limit(1).maybeSingle();
  if (nextError) throw nextError;
  if (!nextExtra) return { skipped: "fila_extra_vazia" };

  const policyV2 = isPolicyV2Enabled(settingsRow);
  const policySettings = policyV2 ? applyPolicyV2(settingsRow) : settingsRow;
  const blockReason = extraSendBlockReason({
    now,
    settings: policySettings,
    policyWindow: policyV2 ? { startMinutes: policySettings.window_start_minutes, endMinutes: policySettings.window_end_minutes } : null
  });
  if (blockReason) return { skipped: blockReason };

  const sessionStatus = await getDispatchSessionStatusForUser(brokerId);
  if (pickSendChannel({ assignedUserId: brokerId, individualSessionStatus: sessionStatus }) !== "individual") return { skipped: "sessao_nao_conectada" };

  let gapMinutes;
  if (policyV2) {
    // Política v2: o teto de 30/dia soma a Meta Diária e a fila extra; intervalo/pausa/reconexão valem para o número.
    const gapSeconds = extraGapSecondsV2(nextExtra.id, policySettings);
    gapMinutes = gapSeconds / 60;
    const [usage, connectedAtMs] = await Promise.all([loadV2Usage(brokerId), loadV2ConnectedAtMs(brokerId)]);
    const policyReason = v2SendBlockReason({ nowMs: now.getTime(), usage, settings: policySettings, connectedAtMs, source: "extra" });
    if (policyReason) return { skipped: policyReason };
    if (usage.lastSendMs !== null && now.getTime() < usage.lastSendMs + gapSeconds * 1000) {
      return { skipped: "aguardando_intervalo", waitMinutes: Math.ceil((usage.lastSendMs + gapSeconds * 1000 - now.getTime()) / 60000) };
    }
  } else {
    gapMinutes = extraGapMinutes(nextExtra.id, settingsRow.min_gap_minutes, settingsRow.max_gap_minutes);
    const lastSend = await getLastSendForBroker(brokerId);
    const waitMinutes = minutesUntilNextSendAllowed({ lastSendAt: lastSend?.at, now, gapMinutes });
    if (waitMinutes) return { skipped: "aguardando_intervalo", waitMinutes };
  }

  const horizon = new Date(now.getTime() + gapMinutes * 60000).toISOString();
  const { data: dueMeta } = await db().from("daily_goal_auto_queue")
    .select("id").eq("broker_id", brokerId).eq("source", "meta").eq("status", "pending")
    .lte("scheduled_for", horizon).limit(1).maybeSingle();
  if (dueMeta && !sendBlockReason({ scheduledFor: now.toISOString(), now, settings: settingsRow })) {
    return { skipped: "meta_diaria_tem_prioridade" };
  }

  const { data: item, error: claimError } = await db().rpc("claim_next_extra_dispatch_item", { p_broker_id: brokerId });
  if (claimError) throw claimError;
  if (!item?.id) return { skipped: "fila_extra_vazia" };
  if (policyV2) {
    const guardReason = await v2GuardAfterClaim({ item, brokerId, settings: policySettings, source: "extra" });
    if (guardReason) return { skipped: guardReason };
  }

  const staleSkips = [];
  try {
    const result = await processClaimedItem({ item, brokerId, brokerName, staleSkips, source: "extra" });
    if (result?.done) return { extra: true, ...result.response };
    return { extra: true, skipped: staleSkips[staleSkips.length - 1] || "descartado", staleSkips };
  } catch (unexpectedError) {
    console.error(`Item ${item.id} da fila extra: erro inesperado, devolvendo para a fila.`, unexpectedError?.message || unexpectedError);
    await markItem(item.id, { status: "pending", last_error: `Erro inesperado: ${String(unexpectedError?.message || unexpectedError).slice(0, 300)}` });
    return { extra: true, skipped: "erro_inesperado" };
  }
}

// Ponto de entrada do cron (app/api/cron/whatsapp-meta-diaria-dispatch):
// para cada corretor com a automação ligada e não pausada, completa a fila
// do dia (se faltar) e tenta enviar NO MÁXIMO 1 mensagem.
// Itens presos em 'sending' além do tempo normal (processo morreu entre
// reivindicar e concluir). Nunca reenvia sem prova de que o envio não
// começou — ver decideStuckSendingItem (lib/daily-goal-auto-core.mjs).
async function recoverStuckSendingItems() {
  const cutoff = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MS).toISOString();
  const { data: items, error } = await db().from("daily_goal_auto_queue")
    .select("id, round_id, attempt_number, wa_message_id, sent_at, delivered_at, send_started_at, updated_at")
    .eq("status", "sending").lte("updated_at", cutoff).limit(50);
  if (error) throw error;
  const summary = { checked: items?.length || 0 };
  for (const item of items || []) {
    const [{ data: round }, { count: slotCount }] = await Promise.all([
      db().from("daily_goal_rounds").select("status, attempt_count").eq("id", item.round_id).maybeSingle(),
      db().from("daily_goal_attempts").select("id", { count: "exact", head: true }).eq("round_id", item.round_id).eq("attempt_number", item.attempt_number)
    ]);
    const decision = decideStuckSendingItem({ item, round, slotAlreadyAttempted: (slotCount || 0) > 0 });
    summary[decision] = (summary[decision] || 0) + 1;
    const guard = (patch) => db().from("daily_goal_auto_queue").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", item.id).eq("status", "sending");
    if (decision === "mark_sent") await guard({ status: "sent", sent_at: item.sent_at || item.updated_at, last_error: "Recuperado de 'enviando': havia confirmação do envio (não reenviado)." });
    else if (decision === "return_pending") await guard({ status: "pending", last_error: "Recuperado de 'enviando': o envio não chegou a começar." });
    else if (decision === "skip_obsolete") await guard({ status: "skipped", skip_reason: "preso_enviando_obsoleto" });
    else if (decision === "review") await guard({ status: "error", skip_reason: "enviando_sem_confirmacao", last_error: "Ficou em 'enviando' sem confirmação de envio — NÃO reenviado automaticamente; conferir no WhatsApp do corretor." });
  }
  return summary;
}

export async function runDailyGoalAutoDispatch() {
  try {
    await recoverStuckSendingItems();
  } catch (stuckError) {
    console.error("Falha ao recuperar itens presos em 'enviando':", stuckError?.message || stuckError);
  }

  const { data: settingsRows, error } = await db().from("daily_goal_auto_settings")
    .select("*, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name, gender, email)")
    .eq("enabled", true).eq("paused", false);
  if (error) throw error;

  // Cada corretor tem sua própria sessão de WhatsApp e sua própria fila —
  // processamento em paralelo em vez de sequencial (achado de performance,
  // pente-fino 2026-09-30): o throttle anti-banimento já é por corretor
  // (min/max gap, oscilação, dentro da fila dele mesmo), então rodar vários
  // corretores ao mesmo tempo não aumenta o ritmo de envio de ninguém, só
  // evita que o cron cresça em duração conforme mais gente ativa a
  // automação. Erro de um corretor continua isolado (nunca derruba os outros).
  // Acesso WhatsApp bloqueado (2026-10-04): corretor bloqueado é IGNORADO antes de qualquer geração, reserva ou claim
  // — nenhum disparo automático, nada da fila extra, nenhuma mudança na fila (nada é apagado nem cancelado). A
  // consulta é uma só por ciclo; o envio ainda tem a barreira final em sendIndividualMessage.
  const accessBlockedIds = await listWhatsappBlockedUserIds();
  const results = await Promise.all((settingsRows || []).map(async (row) => {
    const brokerId = row.broker_id;
    const brokerName = row.broker?.name || "";
    if (accessBlockedIds.has(brokerId)) return { brokerId, skipped: "acesso_whatsapp_bloqueado" };
    // Defesa em profundidade (auditoria incremental 2026-10-02): o número do dono NUNCA dispara automático
    // (incidente 2026-10-02). Só o caminho "ao conectar" checava; qualquer outro jeito de deixar a linha
    // ligada (toggle, SQL, deploy antigo) rearmaria envios reais — aqui o cron também recusa.
    if (isOwnerAdminEmail(row.broker?.email)) return { brokerId, skipped: "numero_do_dono_sem_disparo" };
    try {
      // Garante a geração/seleção dos 20 novos do dia SEM depender do
      // corretor abrir a tela da Meta Diária (pedido do dono, 2026-09-30) —
      // mesmos 3 passos de getBrokerDailyGoal (fechar dia anterior,
      // reconciliar, gerar), só que disparado pelo cron.
      await ensureDailyGoalGeneratedForBroker(brokerId);
      // Política v2: limpeza do excesso da fila ANTES de qualquer outra coisa (inclusive sem sessão conectada). Só mexe
      // na fila (cancela excedentes com motivo); não envia nada. Idempotente.
      await trimV2QueueExcess(brokerId, row);
      // Prospecção SÓ com WhatsApp conectado (regra do dono, 2026-10-02): sem a sessão realmente
      // conectada o corretor não entra na fila de disparos (nenhum item novo é criado) nem na fila
      // extra. Itens que já estavam na fila, histórico e pontuação ficam como estão. Ao reconectar,
      // o próximo ciclo volta sozinho (e redistributeBrokerQueueOnReconnect reorganiza os atrasados).
      // Dois números (2026-10-08): só conta número conectado com "Usar para disparo" ligado.
      if (!isSessionOperational(await getDispatchSessionStatusForUser(brokerId))) return { brokerId, skipped: "sessao_nao_conectada" };
      // Janela efetiva do dia (compensação por restrição validada, 2026-10-02) lida UMA vez por ciclo.
      const effectiveRow = await withEffectiveWindow(row);
      await enqueueTodayItemsForBroker(brokerId, effectiveRow, { name: brokerName, gender: row.broker?.gender || "" });
      const result = await dispatchOneForBroker(brokerId, brokerName, effectiveRow);
      // Fila extra ("Disparar") só quando a Meta Diária não enviou neste ciclo
      // — nunca dois envios do mesmo número no mesmo ciclo.
      const extra = result?.sent ? null : await dispatchExtraForBroker(brokerId, brokerName, effectiveRow);
      return { brokerId, ...result, ...(extra ? { extra } : {}) };
    } catch (brokerError) {
      console.error(`Falha na automação da Meta Diária do corretor ${brokerId}:`, brokerError?.message || brokerError);
      return { brokerId, error: String(brokerError?.message || brokerError) };
    }
  }));
  // Monitor de taxa de entrega (2026-10-04): só LÊ e avisa a gestora; nunca pausa nada. Falha aqui nunca derruba o envio.
  let monitor;
  try {
    monitor = await runDeliveryMonitorForCron();
  } catch (monitorError) {
    console.error("Falha no monitor de taxa de entrega:", monitorError?.message || monitorError);
    monitor = { error: String(monitorError?.message || monitorError) };
  }
  return { processed: results.length, results, monitor };
}

/* ------------------------------- Histórico ------------------------------- */

const HISTORY_STATUS_FILTERS = new Set(["pending", "sending", "sent", "skipped", "error", "canceled"]);

function variantLabel(attemptNumber, variantIndex) {
  if (!Number.isInteger(variantIndex) || variantIndex < 0 || !attemptNumber) return null;
  return `${attemptNumber}${String.fromCharCode(65 + variantIndex)}`;
}

// Histórico da automação (pedido do dono, 2026-09-30) — reaproveita
// integralmente daily_goal_auto_queue (nenhuma tabela nova): resumo do
// período (processadas/enviadas/aguardando retry/erro/puladas) + timeline
// cronológica com cliente, corretor, tentativa, variante, horário e motivo.
// Admin/gestor pode consultar de qualquer corretor (brokerId opcional).
export async function adminGetDailyGoalAutoHistory(auth, params = {}) {
  assertGeneralAdminOrManager(auth);
  const brokerId = params.brokerId || null;
  if (brokerId) assertCanAccessResponsibleUser(auth, brokerId);
  const historyScopeIds = brokerId ? null : teamScopeIdsFor(auth);
  const NO_ONE = ["00000000-0000-0000-0000-000000000000"];
  const status = HISTORY_STATUS_FILTERS.has(params.status) ? params.status : null;
  const attemptNumber = [1, 2, 3].includes(Number(params.attemptNumber)) ? Number(params.attemptNumber) : null;
  const today = getTodayInSaoPaulo();
  const from = params.from || `${today}T00:00:00-03:00`;
  const to = params.to || new Date().toISOString();
  const limit = Math.min(Number(params.limit) || 200, 500);
  // "Hoje" (pedido do dono, 2026-10-02) mostra, além do que já aconteceu, o
  // que ainda falta disparar hoje — só faz sentido pro filtro de hoje (o
  // front manda isso junto com period==="today"), nunca num período passado.
  const includeScheduled = Boolean(params.scheduled) && (!status || status === "pending");

  // Item nunca tocado (status='pending', attempts_count=0) é AGENDA, não
  // HISTÓRICO — fica de fora da timeline de "aconteceu" (fica em `scheduled`
  // abaixo) pra não aparecer misturado com rótulo cru "pending" no meio dos
  // eventos já processados. Retry (attempts_count>0) continua aqui: já teve
  // pelo menos 1 tentativa de verdade, é tão "aconteceu" quanto um erro.
  let query = db().from("daily_goal_auto_queue")
    .select("id, broker_id, contact_id, round_id, attempt_number, status, skip_reason, last_error, variant_index, attempts_count, scheduled_for, sent_at, delivered_at, updated_at, source, contact:prospecting_contacts(name)")
    .gte("updated_at", from).lte("updated_at", to)
    .or("status.neq.pending,attempts_count.gt.0")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (brokerId) query = query.eq("broker_id", brokerId);
  if (historyScopeIds) query = query.in("broker_id", historyScopeIds.length ? historyScopeIds : NO_ONE);
  if (status) query = query.eq("status", status);
  if (attemptNumber) query = query.eq("attempt_number", attemptNumber);

  let scheduledQuery = null;
  if (includeScheduled) {
    scheduledQuery = db().from("daily_goal_auto_queue")
      .select("id, broker_id, contact_id, round_id, attempt_number, variant_index, attempts_count, scheduled_for, contact:prospecting_contacts(name)")
      .eq("status", "pending")
      .gte("scheduled_for", `${today}T00:00:00-03:00`).lte("scheduled_for", `${today}T23:59:59-03:00`)
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (brokerId) scheduledQuery = scheduledQuery.eq("broker_id", brokerId);
    if (historyScopeIds) scheduledQuery = scheduledQuery.in("broker_id", historyScopeIds.length ? historyScopeIds : NO_ONE);
    if (attemptNumber) scheduledQuery = scheduledQuery.eq("attempt_number", attemptNumber);
  }

  const [{ data: rows, error }, scheduledResult] = await Promise.all([
    query,
    scheduledQuery ? scheduledQuery : Promise.resolve({ data: [] })
  ]);
  if (error) throw error;
  if (scheduledResult.error) throw scheduledResult.error;
  const scheduledRows = scheduledResult.data;

  const brokerIds = [...new Set([...(rows || []).map((row) => row.broker_id), ...(scheduledRows || []).map((row) => row.broker_id)])];
  const { data: brokers } = brokerIds.length
    ? await db().from("admin_users").select("id, name").in("id", brokerIds)
    : { data: [] };
  const brokerNameById = new Map((brokers || []).map((row) => [row.id, row.name]));

  const summary = { processadas: rows?.length || 0, enviadas: 0, aguardandoRetry: 0, erros: 0, puladas: 0 };
  if (includeScheduled) summary.agendadas = scheduledRows?.length || 0;
  const timeline = (rows || []).map((row) => {
    if (row.status === "sent") summary.enviadas += 1;
    else if (row.status === "error") summary.erros += 1;
    else if (row.status === "skipped") summary.puladas += 1;
    else if (row.status === "pending" && (row.attempts_count || 0) > 0) summary.aguardandoRetry += 1;

    return {
      id: row.id,
      at: row.sent_at || row.updated_at,
      brokerId: row.broker_id,
      brokerName: brokerNameById.get(row.broker_id) || "",
      contactName: row.contact?.name || "",
      attemptNumber: row.attempt_number,
      variant: variantLabel(row.attempt_number, row.variant_index),
      status: row.status,
      reason: row.skip_reason || row.last_error || "",
      source: row.source || "meta",
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at
    };
  });

  const scheduled = (scheduledRows || []).map((row) => ({
    id: row.id,
    brokerId: row.broker_id,
    brokerName: brokerNameById.get(row.broker_id) || "",
    contactName: row.contact?.name || "",
    attemptNumber: row.attempt_number,
    variant: variantLabel(row.attempt_number, row.variant_index),
    scheduledFor: row.scheduled_for,
    isRetry: (row.attempts_count || 0) > 0
  }));

  return { summary, timeline, scheduled: includeScheduled ? scheduled : undefined };
}
