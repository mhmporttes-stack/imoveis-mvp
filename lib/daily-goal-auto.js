import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { getCurrentDailyGoalQuota, registerDailyGoalAttemptAutomated, getDailyGoalFollowupMessageForAuto } from "./daily-goal";
import { getTodayInSaoPaulo } from "./daily-report";
import { getIndividualSessionStatusForUser, sendIndividualMessage } from "./whatsapp-individual";
import { pickSendChannel } from "./whatsapp-individual-routing.mjs";
import {
  computeDailyAutoCap,
  warmupDayNumber,
  spreadScheduleMinutes,
  isWithinWindow,
  isBusinessDay,
  pickMessageVariant,
  renderAutoMessage
} from "./daily-goal-auto-core.mjs";

// Automação da Meta Diária pelo WhatsApp individual do corretor (pedido do
// dono, 2026-09-29) — cobre 1ª, 2ª e 3ª tentativa de cada contato, opt-in
// por corretor, NUNCA usa o número oficial (ver pickSendChannel/GUARD em
// lib/whatsapp-broadcasts.js, que continua intocado). Este arquivo é o
// único lugar que chama registerDailyGoalAttemptAutomated — nenhuma rota de
// usuário deve importar essa função diretamente. A 1ª tentativa usa as
// variações próprias abaixo (AUTO_MESSAGE_VARIANTS); a 2ª/3ª reaproveitam as
// mensagens já configuradas em Gestão > Meta Diária > Mensagens (ver
// getDailyGoalFollowupMessageForAuto em lib/daily-goal.js).

const AUTO_MESSAGE_VARIANTS = [
  "Oi, {primeiro_nome}! Tudo bem? Vi que você teve um atendimento com a gente há um tempo sobre a compra do seu imóvel e queria saber como você está. Se quiser continuar essa conversa, é só responder por aqui.\n\n(Responda PARAR para não receber mais mensagens.)",
  "Olá, {primeiro_nome}! Passando para saber se ainda está em busca do seu imóvel e se posso ajudar em algo. Fico à disposição por aqui.\n\n(Responda PARAR para não receber mais mensagens.)",
  "{primeiro_nome}, tudo certo? Faz um tempo que conversamos sobre a compra do seu imóvel — queria retomar esse assunto com você, se ainda fizer sentido.\n\n(Responda PARAR para não receber mais mensagens.)",
  "Oi, {primeiro_nome}! Sou da equipe do Matheus Machado Corretor de Imóveis. Queria saber se posso te ajudar a dar continuidade à busca pelo seu imóvel.\n\n(Responda PARAR para não receber mais mensagens.)",
  "{primeiro_nome}, tudo bem? Só passando para saber se você ainda tem interesse em avançar com a compra do imóvel. Qualquer coisa, é só responder aqui.\n\n(Responda PARAR para não receber mais mensagens.)"
];

const OPT_OUT_SUFFIX = "\n\n(Responda PARAR para não receber mais mensagens.)";
const MAX_CONSECUTIVE_ERRORS = 3;

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
    businessDaysOnly: row.business_days_only
  };
}

async function getSettingsRow(brokerId) {
  const { data, error } = await db().from("daily_goal_auto_settings").select("*").eq("broker_id", brokerId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/* --------------------------- Corretor (opt-in) --------------------------- */

export async function getDailyGoalAutoStatus(auth) {
  const brokerId = requireBrokerId(auth);
  const row = await getSettingsRow(brokerId);
  const today = getTodayInSaoPaulo();

  const { count: sentToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("status", "sent")
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

// Liga a automação — 1ª ativação grava warmup_start_date = hoje (início da
// rampa 5/10/15/20 dias). Reativar depois de já ter sido ligada não reinicia
// a rampa (simplificação deliberada: "sessão nova" = nova na automação, não
// cada reconexão de WhatsApp).
export async function setDailyGoalAutoEnabled(auth, enabled) {
  const brokerId = requireBrokerId(auth);
  const current = await getSettingsRow(brokerId);
  const today = getTodayInSaoPaulo();
  const patch = {
    broker_id: brokerId,
    enabled: Boolean(enabled),
    updated_by: brokerId,
    updated_at: new Date().toISOString()
  };
  if (enabled && !current?.warmup_start_date) patch.warmup_start_date = today;
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

export async function adminListDailyGoalAutoSettings(auth) {
  assertGeneralAdminOrManager(auth);
  const { data: rows, error } = await db().from("daily_goal_auto_settings").select("*, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name, photo_url)");
  if (error) throw error;

  const brokerIds = (rows || []).map((row) => row.broker_id);
  const [{ data: pendingCounts }, { data: sentCounts }] = await Promise.all([
    brokerIds.length ? db().from("daily_goal_auto_queue").select("broker_id").eq("status", "pending").in("broker_id", brokerIds) : Promise.resolve({ data: [] }),
    brokerIds.length ? db().from("daily_goal_auto_queue").select("broker_id").eq("status", "sent").gte("sent_at", `${getTodayInSaoPaulo()}T00:00:00-03:00`).in("broker_id", brokerIds) : Promise.resolve({ data: [] })
  ]);
  const pendingByBroker = new Map();
  for (const row of pendingCounts || []) pendingByBroker.set(row.broker_id, (pendingByBroker.get(row.broker_id) || 0) + 1);
  const sentByBroker = new Map();
  for (const row of sentCounts || []) sentByBroker.set(row.broker_id, (sentByBroker.get(row.broker_id) || 0) + 1);

  return (rows || []).map((row) => ({
    brokerId: row.broker_id,
    brokerName: row.broker?.name || "",
    brokerPhotoUrl: row.broker?.photo_url || "",
    ...rowToSettings(row),
    pendingToday: pendingByBroker.get(row.broker_id) || 0,
    sentToday: sentByBroker.get(row.broker_id) || 0
  }));
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

/* ------------------------------- Fila (enqueue) ------------------------------- */

// Completa a fila do corretor para hoje: pega rodadas ativas com
// attempt_count < 3 (ainda faltam tentativas) que ainda não têm item de
// fila para a PRÓXIMA tentativa delas (pending/sent/sending), até o teto do
// dia (computeDailyAutoCap, somando 1ª+2ª+3ª juntas), e agenda horários
// espalhados dentro da janela configurada. Mais antigas primeiro (FIFO por
// round), misturando naturalmente 1ª tentativa de contato novo com
// follow-up de quem já foi abordado.
async function enqueueTodayItemsForBroker(brokerId, brokerName, settingsRow) {
  const today = getTodayInSaoPaulo();
  const quota = await getCurrentDailyGoalQuota();
  const dayNumber = warmupDayNumber(settingsRow.warmup_start_date, today);
  const cap = computeDailyAutoCap({ quota, warmupDayNumber: dayNumber, dailyCapOverride: settingsRow.daily_cap_override });

  const { count: usedToday } = await db().from("daily_goal_auto_queue")
    .select("id", { count: "exact", head: true })
    .eq("broker_id", brokerId)
    .in("status", ["pending", "sending", "sent"])
    .gte("created_at", `${today}T00:00:00-03:00`);
  const remaining = Math.max(0, cap - (usedToday || 0));
  if (remaining <= 0) return 0;

  const { data: rounds, error } = await db().from("daily_goal_rounds")
    .select("id, prospecting_contact_id, attempt_count, client_id, contact:prospecting_contacts(id, name, phone_normalized, status), client:simulation_registrations(full_name, client_code)")
    .eq("broker_id", brokerId)
    .eq("status", "active")
    .lt("attempt_count", 3)
    .order("created_at", { ascending: true })
    .limit(remaining * 2); // folga: alguns podem já ter item de fila (ex.: canceled) ou virar do_not_contact
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

  const eligible = (rounds || []).filter((round) => {
    const nextAttempt = round.attempt_count + 1;
    const queued = alreadyQueuedByRound.get(round.id);
    return !(queued && queued.has(nextAttempt)) &&
      round.contact?.status !== "do_not_contact" &&
      round.contact?.phone_normalized;
  }).slice(0, remaining);
  if (!eligible.length) return 0;

  const { minutes: nowMinutes } = saoPauloNow();
  const scheduleMinutes = spreadScheduleMinutes({
    count: eligible.length,
    windowStartMinutes: settingsRow.window_start_minutes,
    windowEndMinutes: settingsRow.window_end_minutes,
    minGapMinutes: settingsRow.min_gap_minutes,
    maxGapMinutes: settingsRow.max_gap_minutes,
    nowMinutes
  });

  let lastVariantIndex = -1;
  const rows = [];
  for (let i = 0; i < eligible.length && i < scheduleMinutes.length; i += 1) {
    const round = eligible[i];
    const attemptNumber = round.attempt_count + 1;
    let messageText;
    if (attemptNumber === 1) {
      const { text, index } = pickMessageVariant(AUTO_MESSAGE_VARIANTS, lastVariantIndex);
      lastVariantIndex = index;
      messageText = renderAutoMessage(text, { primeiroNome: firstName(round.contact?.name) });
    } else {
      const followup = await getDailyGoalFollowupMessageForAuto(brokerId, brokerName, round, attemptNumber);
      messageText = followup ? `${followup}${OPT_OUT_SUFFIX}` : "";
    }
    if (!messageText) continue; // mensagem de follow-up vazia (não configurada em Gestão) — não agenda envio sem texto.

    rows.push({
      round_id: round.id,
      broker_id: brokerId,
      contact_id: round.prospecting_contact_id,
      attempt_number: attemptNumber,
      message_text: messageText,
      scheduled_for: minutesTodayToIso(scheduleMinutes[i], today),
      status: "pending"
    });
  }
  if (!rows.length) return 0;

  const { error: insertError } = await db().from("daily_goal_auto_queue").insert(rows);
  if (insertError && insertError.code !== "23505") throw insertError;
  return rows.length;
}

function minutesTodayToIso(minutes, todayPlainDate) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
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

  const { data: item, error: claimError } = await db().rpc("claim_next_daily_goal_auto_item", { p_broker_id: brokerId });
  if (claimError) throw claimError;
  if (!item) return { skipped: "fila_vazia" };

  // Revalidação no momento do envio (item 6): a rodada ainda precisa estar
  // exatamente esperando a tentativa deste item (round.attempt_count + 1 ==
  // item.attempt_number) — se avançou por outro caminho entre o agendamento
  // e agora (tentativa manual, conversão, "não contactar"...) o item ficou
  // obsoleto e é descartado, nunca reenviado com número de tentativa errado.
  const { data: round } = await db().from("daily_goal_rounds")
    .select("id, status, attempt_count, contact:prospecting_contacts(status)")
    .eq("id", item.round_id).maybeSingle();
  if (!round || round.status !== "active" || round.attempt_count + 1 !== item.attempt_number) {
    await markItem(item.id, { status: "skipped", skip_reason: "round_nao_esta_mais_ativo" });
    return { skipped: "round_nao_esta_mais_ativo" };
  }
  if (round.contact?.status === "do_not_contact") {
    await markItem(item.id, { status: "skipped", skip_reason: "contato_do_not_contact" });
    return { skipped: "contato_do_not_contact" };
  }

  const today = getTodayInSaoPaulo();
  const { count: attemptedToday } = await db().from("daily_goal_attempts")
    .select("id", { count: "exact", head: true }).eq("round_id", round.id).eq("goal_date", today);
  if (attemptedToday) {
    await markItem(item.id, { status: "skipped", skip_reason: "ja_teve_tentativa_hoje" });
    return { skipped: "ja_teve_tentativa_hoje" };
  }

  const { data: contactRow } = await db().from("prospecting_contacts").select("phone_normalized").eq("id", item.contact_id).maybeSingle();
  if (!contactRow?.phone_normalized) {
    await markItem(item.id, { status: "skipped", skip_reason: "sem_telefone" });
    return { skipped: "sem_telefone" };
  }

  let sendResult;
  try {
    sendResult = await sendIndividualMessage(brokerId, { to: contactRow.phone_normalized, text: item.message_text });
  } catch (sendError) {
    await markItem(item.id, { status: "error", last_error: String(sendError?.message || sendError).slice(0, 500), attempts_count: (item.attempts_count || 0) + 1 });
    const settingsRowNow = await getSettingsRow(brokerId);
    const paused = await pauseBrokerAfterErrors(brokerId, settingsRowNow?.consecutive_errors || 0);
    return { error: "falha_no_envio", paused };
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
    return { error: "falha_ao_registrar_apos_envio" };
  }

  await markItem(item.id, { status: "sent", sent_at: new Date().toISOString(), wa_message_id: sendResult.messageId });
  await db().from("daily_goal_auto_settings").update({ consecutive_errors: 0 }).eq("broker_id", brokerId);
  return { sent: true };
}

// Ponto de entrada do cron (app/api/cron/whatsapp-meta-diaria-dispatch):
// para cada corretor com a automação ligada e não pausada, completa a fila
// do dia (se faltar) e tenta enviar NO MÁXIMO 1 mensagem.
export async function runDailyGoalAutoDispatch() {
  const { data: settingsRows, error } = await db().from("daily_goal_auto_settings")
    .select("*, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name)")
    .eq("enabled", true).eq("paused", false);
  if (error) throw error;

  const results = [];
  for (const row of settingsRows || []) {
    const brokerId = row.broker_id;
    const brokerName = row.broker?.name || "";
    try {
      await enqueueTodayItemsForBroker(brokerId, brokerName, row);
      const result = await dispatchOneForBroker(brokerId, brokerName, row);
      results.push({ brokerId, ...result });
    } catch (brokerError) {
      console.error(`Falha na automação da Meta Diária do corretor ${brokerId}:`, brokerError?.message || brokerError);
      results.push({ brokerId, error: String(brokerError?.message || brokerError) });
    }
  }
  return { processed: results.length, results };
}
