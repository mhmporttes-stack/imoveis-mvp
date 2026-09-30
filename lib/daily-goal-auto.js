import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { registerDailyGoalAttemptAutomated, getDailyGoalAutoMessages, isContactBlockedFromOutreach, ensureDailyGoalGeneratedForBroker } from "./daily-goal";
import { getTodayInSaoPaulo } from "./daily-report";
import { getIndividualSessionStatusForUser, sendIndividualMessage } from "./whatsapp-individual";
import { pickSendChannel } from "./whatsapp-individual-routing.mjs";
import {
  computeDailyAutoCap,
  shuffleArray,
  spreadScheduleMinutes,
  isWithinWindow,
  isBusinessDay,
  nextSequentialVariantIndex,
  classifySendError,
  renderAutoMessage,
  HARD_DAILY_CAP
} from "./daily-goal-auto-core.mjs";

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
      oscillateEnabled: false, oscillatePercent: 50,
      businessDaysOnly: true
    };
  }
  return {
    enabled: row.enabled,
    paused: row.paused,
    pausedReason: row.paused_reason || "",
    consecutiveErrors: row.consecutive_errors || 0,
    warmupStartDate: row.warmup_start_date,
    dailyCapOverride: row.daily_cap_override,
    windowStartMinutes: row.window_start_minutes,
    windowEndMinutes: row.window_end_minutes,
    minGapMinutes: row.min_gap_minutes,
    maxGapMinutes: row.max_gap_minutes,
    oscillateEnabled: Boolean(row.oscillate_enabled),
    oscillatePercent: row.oscillate_percent ?? 50,
    businessDaysOnly: row.business_days_only
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
  const sessionStatus = await getIndividualSessionStatusForUser(brokerId);
  return {
    ...settings,
    sessionConnected: sessionStatus === "connected",
    sentToday: sentToday || 0,
    pendingToday: pendingToday || 0
  };
}

// Liga a automação. Sem rampa de aquecimento (removida a pedido do dono,
// 2026-09-30) — já vale o teto cheio (todas as atividades pendentes do dia,
// até 100) desde a 1ª ativação.
export async function setDailyGoalAutoEnabled(auth, enabled) {
  const brokerId = requireBrokerId(auth);
  const current = await getSettingsRow(brokerId);
  const patch = {
    broker_id: brokerId,
    enabled: Boolean(enabled),
    updated_by: brokerId,
    updated_at: new Date().toISOString()
  };
  if (enabled && !current) {
    // 1ª ativação desse corretor — herda os padrões globais configurados
    // pelo admin (aba Automação) em vez de cair nos valores fixos da coluna.
    const defaults = await getDailyGoalAutoDefaults();
    patch.window_start_minutes = defaults.windowStartMinutes;
    patch.window_end_minutes = defaults.windowEndMinutes;
    patch.min_gap_minutes = defaults.minGapMinutes;
    patch.max_gap_minutes = defaults.maxGapMinutes;
    patch.oscillate_enabled = defaults.oscillateEnabled;
    patch.oscillate_percent = defaults.oscillatePercent;
    patch.business_days_only = defaults.businessDaysOnly;
    patch.daily_cap_override = defaults.dailyCapOverride;
  }
  if (enabled) { patch.paused = false; patch.paused_reason = null; patch.consecutive_errors = 0; }
  const { error } = await db().from("daily_goal_auto_settings").upsert(patch, { onConflict: "broker_id" });
  if (error) throw error;
  if (!enabled) {
    await db().from("daily_goal_auto_queue").update({ status: "canceled", skip_reason: "automacao_desligada", updated_at: new Date().toISOString() })
      .eq("broker_id", brokerId).eq("status", "pending");
  }
  return getDailyGoalAutoStatus(auth);
}

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
export async function adminListDailyGoalAutoSettings(auth) {
  assertGeneralAdminOrManager(auth);
  const [{ data: brokers, error: brokersError }, { data: settingsRows, error: settingsError }, { data: sessionRows, error: sessionError }] = await Promise.all([
    db().from("admin_users").select("id, name, photo_url").is("disabled_at", null).order("name", { ascending: true }),
    db().from("daily_goal_auto_settings").select("*"),
    db().from("whatsapp_individual_sessions").select("user_id, status, last_error, last_connected_at")
  ]);
  if (brokersError) throw brokersError;
  if (settingsError) throw settingsError;
  if (sessionError) throw sessionError;

  const settingsByBroker = new Map((settingsRows || []).map((row) => [row.broker_id, row]));
  const sessionByBroker = new Map((sessionRows || []).map((row) => [row.user_id, row]));

  const brokerIds = (brokers || []).map((b) => b.id);
  const today = getTodayInSaoPaulo();
  const [{ data: todayRows }, { data: sentTotalRows }, { data: issueRows }, { data: pendingActivityRows }, { data: autoErrorRows }] = await Promise.all([
    // "Hoje" tem que pegar pelo que ACONTECEU hoje (enviou/pulou/deu erro
    // hoje), não só pela data em que a linha da fila foi criada — achado
    // real, 2026-09-30: item criado ontem à noite (ou antes da limpeza
    // manual da fila) mas enviado hoje de manhã ficava de fora da contagem
    // de "hoje", o card mostrava menos enviadas do que realmente saiu.
    brokerIds.length
      ? db().from("daily_goal_auto_queue").select("broker_id, status, scheduled_for, delivered_at")
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
      : Promise.resolve({ data: [] })
  ]);
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
    const dailyCap = computeDailyAutoCap({ totalActivities: totalActivitiesToday, dailyCapOverride: settingsRow?.daily_cap_override });
    let dailyCapReason = "";
    if (settingsRow?.daily_cap_override && dailyCap === settingsRow.daily_cap_override) dailyCapReason = "teto manual";
    else if (dailyCap === HARD_DAILY_CAP) dailyCapReason = "teto máximo de segurança";
    else dailyCapReason = "todas as atividades de hoje";
    return {
      brokerId: broker.id,
      brokerName: broker.name || "",
      brokerPhotoUrl: broker.photo_url || "",
      ...rowToSettings(settingsRow),
      sessionStatus: sessionRow?.status || "nunca_conectou",
      sessionLastError: sessionRow?.last_error || "",
      sessionLastConnectedAt: sessionRow?.last_connected_at || null,
      sentToday: todayCounts.sent_confirmed || 0,
      sentUnconfirmedToday: todayCounts.sent_unconfirmed || 0,
      pendingToday: (todayCounts.pending || 0) + (todayCounts.sending || 0),
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
      lastIssue: lastIssueByBroker.get(broker.id) || null
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
  if (dailyCapOverride !== null && (!Number.isInteger(dailyCapOverride) || dailyCapOverride < 1 || dailyCapOverride > HARD_DAILY_CAP)) {
    throw new Error(`Teto diário inválido (1 a ${HARD_DAILY_CAP}, ou vazio para automático).`);
  }

  const config = { windowStartMinutes, windowEndMinutes, minGapMinutes, maxGapMinutes, oscillateEnabled, oscillatePercent, businessDaysOnly, dailyCapOverride };

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
    business_days_only: businessDaysOnly,
    daily_cap_override: dailyCapOverride,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).neq("broker_id", "00000000-0000-0000-0000-000000000000"); // update em todas as linhas
  if (bulkError) throw bulkError;

  return { defaults: config, brokers: await adminListDailyGoalAutoSettings(auth) };
}

// Exceção pontual pra 1 corretor específico (ex.: reduzir o teto dele sem
// mexer nos outros) — sobrescreve o próximo "aplicar a todos" só se o admin
// rodar de novo o global depois.
export async function adminSetBrokerDailyCapOverride(auth, brokerId, dailyCapOverride) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
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
  return true;
}

export async function adminSetDailyGoalAutoPaused(auth, brokerId, paused, reason) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
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
    patch.business_days_only = defaults.businessDaysOnly;
    patch.daily_cap_override = defaults.dailyCapOverride;
  }
  if (enabled) { patch.paused = false; patch.paused_reason = null; patch.consecutive_errors = 0; }
  const { error } = await db().from("daily_goal_auto_settings").upsert(patch, { onConflict: "broker_id" });
  if (error) throw error;
  if (!enabled) {
    await db().from("daily_goal_auto_queue").update({ status: "canceled", skip_reason: "automacao_desligada", updated_at: new Date().toISOString() })
      .eq("broker_id", brokerId).eq("status", "pending");
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

// Completa a fila do corretor para hoje: pega rodadas ativas com
// attempt_count < 3 (ainda faltam tentativas) que ainda não têm item de
// fila para a PRÓXIMA tentativa delas (pending/sent/sending), até o teto do
// dia (computeDailyAutoCap = todas as atividades pendentes agora, até 100 —
// pedido do dono, 2026-09-30), embaralha a ordem (1ª/2ª/3ª tentativa se
// misturam sem padrão previsível, não mais FIFO por rodada — ajuda a variar
// o ritmo/tipo de mensagem e reduzir risco de banimento) e agenda horários
// espalhados dentro da janela configurada.
async function enqueueTodayItemsForBroker(brokerId, settingsRow, brokerProfile = {}) {
  const today = getTodayInSaoPaulo();

  const { count: usedToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true })
    .eq("broker_id", brokerId)
    .in("status", ["pending", "sending", "sent"])
    .gte("created_at", `${today}T00:00:00-03:00`);

  const { data: rounds, error } = await db().from("daily_goal_rounds")
    .select("id, prospecting_contact_id, attempt_count, client_id, contact:prospecting_contacts(id, name, phone_normalized, status), client:simulation_registrations(full_name, client_code)")
    .eq("broker_id", brokerId)
    .eq("status", "active")
    .lt("attempt_count", 3)
    .limit(HARD_DAILY_CAP * 2); // folga: alguns podem já ter item de fila (ex.: canceled) ou virar do_not_contact
  if (error) throw error;

  const candidateRoundIds = (rounds || []).map((round) => round.id);
  if (!candidateRoundIds.length) return 0;

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
  const eligibleAll = (rounds || []).filter((round) => {
    const nextAttempt = round.attempt_count + 1;
    const queued = alreadyQueuedByRound.get(round.id);
    return !(queued && queued.has(nextAttempt)) &&
      !attemptedTodaySet.has(round.id) &&
      round.contact?.status !== "do_not_contact" &&
      round.contact?.phone_normalized &&
      String(round.contact?.name || "").trim();
  });
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
    nowMinutes
  });

  const autoMessages = await getDailyGoalAutoMessages();
  // Rotação sequencial persistente por tentativa (1A→1B→1C→1D→1A...), pedido
  // do dono 2026-09-30 — o cursor começa de onde a última execução do cron
  // parou (guardado em daily_goal_auto_settings) e só avança em memória
  // dentro deste lote, persistindo tudo de uma vez no fim (ver abaixo).
  const cursorByAttempt = {
    1: settingsRow.variant_cursor_attempt1 || 0,
    2: settingsRow.variant_cursor_attempt2 || 0,
    3: settingsRow.variant_cursor_attempt3 || 0
  };
  const rows = [];
  for (let i = 0; i < eligible.length && i < scheduleMinutes.length; i += 1) {
    const round = eligible[i];
    const attemptNumber = round.attempt_count + 1;
    const variants = autoMessages[`message${attemptNumber}`];
    const { index, nextCursor } = nextSequentialVariantIndex(cursorByAttempt[attemptNumber], variants?.length || 0);
    if (index < 0) continue;
    cursorByAttempt[attemptNumber] = nextCursor;
    const messageText = renderAutoMessage(variants[index], {
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
      variant_index: index
    });
  }
  if (!rows.length) return 0;

  // Persiste o cursor da rotação ANTES do insert (best-effort: se o insert
  // falhar/parcial por conflito, o pior caso é pular uma variação da
  // sequência, nunca travar ou repetir — aceitável, não vale a pena
  // complicar com rollback manual do cursor por causa disso).
  await db().from("daily_goal_auto_settings").update({
    variant_cursor_attempt1: cursorByAttempt[1],
    variant_cursor_attempt2: cursorByAttempt[2],
    variant_cursor_attempt3: cursorByAttempt[3]
  }).eq("broker_id", brokerId);

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
async function dispatchOneForBroker(brokerId, brokerName, settingsRow) {
  const { minutes: nowMinutes, weekday } = saoPauloNow();
  if (!isWithinWindow(nowMinutes, settingsRow.window_start_minutes, settingsRow.window_end_minutes)) return { skipped: "fora_da_janela" };
  if (settingsRow.business_days_only && !isBusinessDay(weekday)) return { skipped: "fim_de_semana" };

  const sessionStatus = await getIndividualSessionStatusForUser(brokerId);
  const channel = pickSendChannel({ assignedUserId: brokerId, individualSessionStatus: sessionStatus });
  if (channel !== "individual") return { skipped: "sessao_nao_conectada" };

  const staleSkips = [];
  for (let round = 0; round < MAX_STALE_SKIPS_PER_CYCLE; round += 1) {
    const { data: item, error: claimError } = await db().rpc("claim_next_daily_goal_auto_item", { p_broker_id: brokerId });
    if (claimError) throw claimError;
    if (!item) return { skipped: "fila_vazia", staleSkips };

    try {
      const result = await processClaimedItem({ item, brokerId, brokerName, staleSkips });
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
async function processClaimedItem({ item, brokerId, brokerName, staleSkips }) {
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

  let sendResult;
  try {
    sendResult = await sendIndividualMessage(brokerId, { to: contactRow.phone_normalized, text: item.message_text });
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
      variant_index: item.variant_index ?? null
    }]
  });
  if (retryInsertError) console.error(`Falha ao reagendar retry técnico do item ${item.id}:`, retryInsertError.message || retryInsertError);
  staleSkips.push(`falha_destinatario_${nextErrorCount}_${MAX_CONTACT_RETRIES}`);
}

// Ponto de entrada do cron (app/api/cron/whatsapp-meta-diaria-dispatch):
// para cada corretor com a automação ligada e não pausada, completa a fila
// do dia (se faltar) e tenta enviar NO MÁXIMO 1 mensagem.
export async function runDailyGoalAutoDispatch() {
  const { data: settingsRows, error } = await db().from("daily_goal_auto_settings")
    .select("*, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name, gender)")
    .eq("enabled", true).eq("paused", false);
  if (error) throw error;

  // Cada corretor tem sua própria sessão de WhatsApp e sua própria fila —
  // processamento em paralelo em vez de sequencial (achado de performance,
  // pente-fino 2026-09-30): o throttle anti-banimento já é por corretor
  // (min/max gap, oscilação, dentro da fila dele mesmo), então rodar vários
  // corretores ao mesmo tempo não aumenta o ritmo de envio de ninguém, só
  // evita que o cron cresça em duração conforme mais gente ativa a
  // automação. Erro de um corretor continua isolado (nunca derruba os outros).
  const results = await Promise.all((settingsRows || []).map(async (row) => {
    const brokerId = row.broker_id;
    const brokerName = row.broker?.name || "";
    try {
      // Garante a geração/seleção dos 20 novos do dia SEM depender do
      // corretor abrir a tela da Meta Diária (pedido do dono, 2026-09-30) —
      // mesmos 3 passos de getBrokerDailyGoal (fechar dia anterior,
      // reconciliar, gerar), só que disparado pelo cron.
      await ensureDailyGoalGeneratedForBroker(brokerId);
      await enqueueTodayItemsForBroker(brokerId, row, { name: brokerName, gender: row.broker?.gender || "" });
      const result = await dispatchOneForBroker(brokerId, brokerName, row);
      return { brokerId, ...result };
    } catch (brokerError) {
      console.error(`Falha na automação da Meta Diária do corretor ${brokerId}:`, brokerError?.message || brokerError);
      return { brokerId, error: String(brokerError?.message || brokerError) };
    }
  }));
  return { processed: results.length, results };
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
  const status = HISTORY_STATUS_FILTERS.has(params.status) ? params.status : null;
  const attemptNumber = [1, 2, 3].includes(Number(params.attemptNumber)) ? Number(params.attemptNumber) : null;
  const today = getTodayInSaoPaulo();
  const from = params.from || `${today}T00:00:00-03:00`;
  const to = params.to || new Date().toISOString();
  const limit = Math.min(Number(params.limit) || 200, 500);

  let query = db().from("daily_goal_auto_queue")
    .select("id, broker_id, contact_id, round_id, attempt_number, status, skip_reason, last_error, variant_index, attempts_count, scheduled_for, sent_at, delivered_at, updated_at, contact:prospecting_contacts(name)")
    .gte("updated_at", from).lte("updated_at", to)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (brokerId) query = query.eq("broker_id", brokerId);
  if (status) query = query.eq("status", status);
  if (attemptNumber) query = query.eq("attempt_number", attemptNumber);

  const { data: rows, error } = await query;
  if (error) throw error;

  const brokerIds = [...new Set((rows || []).map((row) => row.broker_id))];
  const { data: brokers } = brokerIds.length
    ? await db().from("admin_users").select("id, name").in("id", brokerIds)
    : { data: [] };
  const brokerNameById = new Map((brokers || []).map((row) => [row.id, row.name]));

  const summary = { processadas: rows?.length || 0, enviadas: 0, aguardandoRetry: 0, erros: 0, puladas: 0 };
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
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at
    };
  });

  return { summary, timeline };
}
