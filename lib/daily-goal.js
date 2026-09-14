import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager, assertOwnerAdmin } from "./admin-access";
import { isGeneralAdminAuth, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { CLIENT_STATUS } from "./client-status";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { getPerformanceOverview } from "./performance-overview";
import { getTodayInSaoPaulo, addDaysToPlainDate, zonedPlainDateToUtcIso, normalizePlainDate, formatPlainDateBR } from "./daily-report";

// Meta Diária: consome a fila compartilhada de prospecção (prospecting_contacts)
// de forma estruturada (FIFO + cadência de até 3 tentativas), reaproveitando o
// mesmo modelo de cliente, status (awaiting_return/in_service/archived/
// do_not_contact), trava de 30 dias e histórico (prospecting_history) já usados
// pela Prospecção manual — não é um pool de clientes paralelo.

const MESSAGES_SETTINGS_ID = "daily_goal_messages";

const DEFAULT_MESSAGES = {
  message1: { text: "{saudacao}, {primeiro_nome}, tudo bem?", allowPersonalization: false },
  message2: {
    text: "Olá, {primeiro_nome}! Sou {nome_corretor}, associado do corretor Matheus Machado. Vi que há um tempo você recebeu um atendimento nosso sobre a compra do seu imóvel. Estou entrando em contato para saber como foi seu atendimento e se conseguiu avançar com a compra.",
    allowPersonalization: true
  },
  message3: {
    text: "Oi, {primeiro_nome}! Passando rapidinho para saber se posso te ajudar em algo sobre a compra do seu imóvel. Se quiser retomar essa conversa, estou à disposição.",
    allowPersonalization: true
  }
};

export function canLoadDailyGoal() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// supabase-js nunca rejeita a Promise por si só — um update malsucedido (ex.:
// violação de constraint) só aparece em `.error`. Vários updates abaixo são
// "fire-and-forget" (não usam o retorno), então sem essa checagem um erro
// passaria em silêncio, como se a atualização tivesse funcionado.
async function runUpdate(query) {
  const { error } = await query;
  if (error) throw error;
}

function requireBrokerId(auth) {
  const id = auth?.profile?.id;
  if (!auth?.ok || !id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function firstName(fullName) {
  return cleanText(fullName, 80).split(" ")[0] || "";
}

function addDaysIso(iso, days) {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Mesma lógica de saudação por horário (fuso America/Sao_Paulo) já usada em
// lib/prospecting.js (buildGreetingUrl) — reimplementada aqui em vez de
// importada para não acoplar a Meta Diária ao módulo de prospecção manual.
function getTimeGreeting() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 360 && minutes < 720 ? "Bom dia" : minutes >= 720 && minutes < 1120 ? "Boa tarde" : "Boa noite";
}

// Template seguro: só substitui as variáveis conhecidas, nunca interpreta
// HTML/scripts do texto cadastrado.
function renderTemplate(text, vars) {
  return String(text || "").replace(/\{(saudacao|primeiro_nome|nome_corretor|codigo_cliente)\}/g, (_, key) => String(vars[key] ?? ""));
}

/* ----------------------------- Configurações ----------------------------- */

// Quantidade vigente agora (mesmo padrão de vigência de scoring-rules.js,
// simplificado: só precisamos do valor "atual", não de uma linha do tempo
// completa, pois a meta gerada já congela seu próprio valor em daily_goals).
export async function getCurrentDailyGoalQuota() {
  const { data, error } = await db().from("daily_goal_quota_versions").select("quota").is("effective_to", null).maybeSingle();
  if (error) throw error;
  return data?.quota || 30;
}

export async function getDailyGoalSettings(auth) {
  assertGeneralAdminOrManager(auth);
  const [quota, messages] = await Promise.all([getCurrentDailyGoalQuota(), getDailyGoalMessages()]);
  return { quota, messages };
}

export async function updateDailyGoalQuota(quota, auth) {
  assertGeneralAdmin(auth);
  const normalized = Number(quota);
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 500) {
    throw new Error("Informe uma quantidade inteira entre 1 e 500.");
  }
  const { error } = await db().rpc("set_daily_goal_quota", { p_quota: normalized, p_changed_by: auth?.profile?.id || null });
  if (error) throw error;
  return getDailyGoalSettings(auth);
}

export async function getDailyGoalMessages() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", MESSAGES_SETTINGS_ID).maybeSingle();
  if (error) throw error;
  const stored = data?.setting_value || {};
  return {
    message1: { ...DEFAULT_MESSAGES.message1, ...stored.message1 },
    message2: { ...DEFAULT_MESSAGES.message2, ...stored.message2 },
    message3: { ...DEFAULT_MESSAGES.message3, ...stored.message3 }
  };
}

export async function updateDailyGoalMessages(payload, auth) {
  assertGeneralAdmin(auth);
  const next = {};
  for (const key of ["message1", "message2", "message3"]) {
    const text = cleanText(payload?.[key]?.text, 1000);
    if (!text) throw new Error("Preencha o texto das três mensagens.");
    if (/[<>]/.test(text)) throw new Error("Use apenas texto simples nas mensagens (sem HTML).");
    next[key] = { text, allowPersonalization: Boolean(payload?.[key]?.allowPersonalization) };
  }
  const { error } = await db().from("crm_settings").upsert({
    id: MESSAGES_SETTINGS_ID,
    setting_value: next,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return next;
}

/* ------------------------------- Corretor -------------------------------- */

export async function getBrokerDailyGoal(auth) {
  const brokerId = requireBrokerId(auth);
  const today = getTodayInSaoPaulo();

  await reconcileDailyGoalRounds(brokerId);
  await ensureDailyGoalGenerated(auth, today);

  return buildDailyGoalSnapshot(brokerId, today);
}

// Rodadas ativas cujo cliente já saiu da cadência por outro caminho (virou
// "Em atendimento" = conversão; ou qualquer outro status = "Não contactar",
// arquivamento manual etc. = saída válida) — verificado a cada acesso, sem
// depender de cron externo.
async function reconcileDailyGoalRounds(brokerId) {
  const { data: activeRounds, error } = await db()
    .from("daily_goal_rounds")
    .select("id, prospecting_contact_id, client_id, attempt_count")
    .eq("broker_id", brokerId)
    .eq("status", "active");
  if (error) throw error;
  const clientIds = (activeRounds || []).map((round) => round.client_id).filter(Boolean);
  if (!clientIds.length) return;

  const { data: clients, error: clientsError } = await db().from("simulation_registrations").select("id, status").in("id", clientIds);
  if (clientsError) throw clientsError;
  const statusByClient = new Map((clients || []).map((row) => [row.id, row.status]));
  const now = new Date().toISOString();

  for (const round of activeRounds) {
    const status = statusByClient.get(round.client_id);
    if (!status || status === CLIENT_STATUS.AWAITING_RETURN) continue;

    if (status === CLIENT_STATUS.IN_SERVICE) {
      await runUpdate(db().from("daily_goal_rounds").update({ status: "converted", converted_attempt: round.attempt_count, converted_at: now }).eq("id", round.id).eq("status", "active"));
      await logHistory(round.prospecting_contact_id, round.client_id, brokerId, "daily_goal_converted", { attempt: round.attempt_count });
      continue;
    }

    await runUpdate(db().from("daily_goal_rounds").update({ status: "ended_no_conversion", ended_at: now }).eq("id", round.id).eq("status", "active"));
    if (status !== CLIENT_STATUS.DO_NOT_CONTACT) {
      const availableAfter = addDaysIso(now, 30);
      await runUpdate(db().from("prospecting_contacts").update({ status: "recent_attempt", assigned_user_id: null, available_after: availableAfter, queue_sort_at: availableAfter, updated_at: now }).eq("id", round.prospecting_contact_id).neq("status", "do_not_contact"));
    }
    await logHistory(round.prospecting_contact_id, round.client_id, brokerId, "daily_goal_round_ended", { attempt: round.attempt_count, reason: "external_status_change", status });
  }
}

// Idempotente: uma linha em daily_goals para (corretor, dia) já indica que a
// meta foi gerada — atualizar a página, trocar de aparelho etc. nunca gera
// outra carga. A concorrência entre corretores é resolvida em duas camadas:
// o upsert com ignoreDuplicates decide quem "ganha" a geração daquele dia, e
// o RPC claim_daily_goal_contacts (FOR UPDATE SKIP LOCKED) garante que dois
// corretores nunca reivindiquem o mesmo contato da fila.
async function ensureDailyGoalGenerated(auth, today) {
  const brokerId = requireBrokerId(auth);
  const quota = await getCurrentDailyGoalQuota();

  const { data: won, error } = await db()
    .from("daily_goals")
    .upsert({ broker_id: brokerId, goal_date: today, new_quota: quota, new_assigned_count: 0, total_due: 0 }, { onConflict: "broker_id,goal_date", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!won) return;

  const { data: claimed, error: claimError } = await db().rpc("claim_daily_goal_contacts", { p_broker_id: brokerId, p_quota: quota });
  if (claimError) throw claimError;

  let assignedCount = 0;
  for (const contact of claimed || []) {
    try {
      await materializeRound(contact, auth, today);
      assignedCount += 1;
    } catch (materializeError) {
      console.error("Falha ao materializar rodada da Meta Diária:", materializeError?.message || materializeError);
      await runUpdate(db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, updated_at: new Date().toISOString() }).eq("id", contact.id).eq("assigned_user_id", brokerId));
    }
  }
  if (assignedCount) {
    await runUpdate(db().from("daily_goals").update({ new_assigned_count: assignedCount }).eq("broker_id", brokerId).eq("goal_date", today));
  }
}

async function materializeRound(contact, auth, today) {
  const brokerId = auth.profile.id;
  const now = new Date().toISOString();
  let registrationId = contact.registration_id;

  if (!registrationId) {
    const registration = await ensureManualSimulationRegistration({
      fullName: contact.name,
      phone: contact.phone_normalized,
      status: CLIENT_STATUS.AWAITING_RETURN,
      adminEmail: auth.user?.email
    }, auth);
    registrationId = registration.id;
    const { error: linkError } = await db().from("prospecting_contacts").update({ registration_id: registrationId }).eq("id", contact.id);
    if (linkError) throw linkError;
  } else {
    const { error: updateError } = await db().from("simulation_registrations").update({
      responsible_user_id: brokerId,
      status: CLIENT_STATUS.AWAITING_RETURN,
      prospecting_contact_id: contact.id,
      last_status_change_at: now
    }).eq("id", registrationId);
    if (updateError) throw updateError;
  }

  const { error: roundError } = await db().from("daily_goal_rounds").insert({
    prospecting_contact_id: contact.id,
    client_id: registrationId,
    broker_id: brokerId,
    round_started_at: today,
    attempt_count: 0,
    status: "active"
  });
  if (roundError) throw roundError;

  await logHistory(contact.id, registrationId, brokerId, "claimed", { source: "daily_goal" });
}

async function logHistory(contactId, registrationId, userId, eventType, details = {}) {
  const { error } = await db().from("prospecting_history").insert({ contact_id: contactId, registration_id: registrationId || null, user_id: userId || null, event_type: eventType, details });
  if (error) throw error;
}

// Monta a tela do corretor: os três grupos (novos/2º/3º), com total e
// percentual congelados naturalmente pelo modelo de dados (round_started_at
// nunca muda, attempt_count só avança por clique real) — ver comentário na
// migration 20260914_daily_goal.sql.
async function buildDailyGoalSnapshot(brokerId, today) {
  const yesterday = addDaysToPlainDate(today, -1);
  const dayBeforeYesterday = addDaysToPlainDate(today, -2);

  const { data: goalRow, error: goalError } = await db().from("daily_goals").select("*").eq("broker_id", brokerId).eq("goal_date", today).maybeSingle();
  if (goalError) throw goalError;

  const [messages, brokerProfile] = await Promise.all([getDailyGoalMessages(), db().from("admin_users").select("name").eq("id", brokerId).maybeSingle().then((res) => res.data)]);
  const brokerName = cleanText(brokerProfile?.name, 80);

  const { data: rounds, error: roundsError } = await db()
    .from("daily_goal_rounds")
    .select("id, attempt_count, round_started_at, status, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code)")
    .eq("broker_id", brokerId)
    .in("round_started_at", [today, yesterday, dayBeforeYesterday]);
  if (roundsError) throw roundsError;

  const newCohort = (rounds || []).filter((round) => round.round_started_at === today);
  const secondCohort = (rounds || []).filter((round) => round.round_started_at === yesterday && round.attempt_count >= 1);
  const thirdCohort = (rounds || []).filter((round) => round.round_started_at === dayBeforeYesterday && round.attempt_count >= 2);

  const doneNew = newCohort.filter((round) => round.status !== "active" || round.attempt_count >= 1).length;
  const doneSecond = secondCohort.filter((round) => round.status !== "active" || round.attempt_count >= 2).length;
  const doneThird = thirdCohort.filter((round) => round.status !== "active" || round.attempt_count >= 3).length;

  const groups = {
    new: { total: goalRow?.new_quota ?? newCohort.length, done: doneNew, pending: mapRounds(newCohort.filter((round) => round.status === "active" && round.attempt_count === 0), messages, brokerName) },
    second: { total: secondCohort.length, done: doneSecond, pending: mapRounds(secondCohort.filter((round) => round.status === "active" && round.attempt_count === 1), messages, brokerName) },
    third: { total: thirdCohort.length, done: doneThird, pending: mapRounds(thirdCohort.filter((round) => round.status === "active" && round.attempt_count === 2), messages, brokerName) }
  };

  const total = groups.new.total + groups.second.total + groups.third.total;
  const done = groups.new.done + groups.second.done + groups.third.done;
  const percent = total ? Math.round((done / total) * 100) : 0;

  if (goalRow && goalRow.total_due !== total) {
    await runUpdate(db().from("daily_goals").update({ total_due: total }).eq("broker_id", brokerId).eq("goal_date", today));
  }

  return {
    date: today,
    total,
    done,
    percent,
    groups: {
      new: { total: groups.new.total, done: groups.new.done, clients: groups.new.pending },
      second: { total: groups.second.total, done: groups.second.done, clients: groups.second.pending },
      third: { total: groups.third.total, done: groups.third.done, clients: groups.third.pending }
    }
  };
}

function mapRounds(rounds, messages, brokerName) {
  return rounds.map((round) => {
    const attemptNumber = round.attempt_count + 1;
    const config = messages[`message${attemptNumber}`] || { text: "", allowPersonalization: false };
    const vars = { saudacao: getTimeGreeting(), primeiro_nome: firstName(round.client?.full_name), nome_corretor: brokerName, codigo_cliente: round.client?.client_code || "" };
    return {
      roundId: round.id,
      clientId: round.client_id,
      fullName: round.client?.full_name || "Cliente",
      clientCode: round.client?.client_code || "",
      phone: round.client?.phone_normalized || "",
      attemptNumber,
      previewMessage: renderTemplate(config.text, vars),
      allowPersonalization: Boolean(config.allowPersonalization)
    };
  });
}

export async function registerDailyGoalAttempt(roundId, customText, auth) {
  const brokerId = requireBrokerId(auth);
  const { data: round, error } = await db()
    .from("daily_goal_rounds")
    .select("id, attempt_count, status, prospecting_contact_id, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code), contact:prospecting_contacts(phone_normalized)")
    .eq("id", roundId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw error;
  if (!round || round.status !== "active") throw new Error("Este cliente não está mais disponível na sua Meta Diária.");

  const nextAttempt = round.attempt_count + 1;
  if (nextAttempt > 3) throw new Error("Este cliente já recebeu as 3 tentativas.");

  const messages = await getDailyGoalMessages();
  const config = messages[`message${nextAttempt}`] || { text: "", allowPersonalization: false };
  const vars = {
    saudacao: getTimeGreeting(),
    primeiro_nome: firstName(round.client?.full_name),
    nome_corretor: cleanText(auth.profile?.name, 80),
    codigo_cliente: round.client?.client_code || ""
  };

  let finalText = renderTemplate(config.text, vars);
  let isPersonalized = false;
  const trimmedCustom = typeof customText === "string" ? cleanText(customText, 1000) : "";
  if (config.allowPersonalization && trimmedCustom && trimmedCustom !== finalText) {
    finalText = trimmedCustom;
    isPersonalized = true;
  }
  if (!finalText) throw new Error("Mensagem vazia — configure o texto padrão em Gestão.");

  const now = new Date().toISOString();
  const today = getTodayInSaoPaulo();

  const { error: attemptError } = await db().from("daily_goal_attempts").insert({
    round_id: round.id,
    client_id: round.client_id,
    broker_id: brokerId,
    attempt_number: nextAttempt,
    goal_date: today,
    message_used: finalText,
    is_personalized: isPersonalized
  });
  if (attemptError) {
    if (attemptError.code === "23505") throw new Error("Esta tentativa já foi registrada.");
    throw attemptError;
  }

  const willEnd = nextAttempt >= 3;
  const roundUpdate = { attempt_count: nextAttempt };
  if (willEnd) { roundUpdate.status = "ended_no_conversion"; roundUpdate.ended_at = now; }
  await runUpdate(db().from("daily_goal_rounds").update(roundUpdate).eq("id", round.id));

  await runUpdate(db().from("simulation_registrations").update({ last_whatsapp_contact_at: now }).eq("id", round.client_id));
  await runUpdate(db().from("prospecting_contacts").update({ last_attempt_at: now, updated_at: now }).eq("id", round.prospecting_contact_id));

  if (willEnd) {
    const availableAfter = addDaysIso(now, 30);
    await runUpdate(db().from("prospecting_contacts").update({ status: "recent_attempt", assigned_user_id: null, available_after: availableAfter, queue_sort_at: availableAfter, updated_at: now }).eq("id", round.prospecting_contact_id));
    await runUpdate(db().from("simulation_registrations").update({ responsible_user_id: null, status: CLIENT_STATUS.ARCHIVED, last_status_change_at: now }).eq("id", round.client_id));
  }

  await logHistory(round.prospecting_contact_id, round.client_id, brokerId, willEnd ? "daily_goal_round_ended" : "daily_goal_attempt", {
    attempt: nextAttempt,
    message: finalText.slice(0, 300),
    personalized: isPersonalized,
    channel: "whatsapp"
  });

  const phone = round.client?.phone_normalized || round.contact?.phone_normalized || "";
  const digits = phone.replace(/\D/g, "");
  const whatsappUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(finalText)}` : "";
  if (!whatsappUrl) throw new Error("Cliente sem WhatsApp válido cadastrado.");

  return { attemptNumber: nextAttempt, whatsappUrl, ended: willEnd };
}

/* -------------------------------- Gestão ---------------------------------- */

const PERFORMANCE_PERIODS = { TODAY: "today", YESTERDAY: "yesterday", LAST_7_DAYS: "last7", LAST_30_DAYS: "last30", CUSTOM: "custom" };

function resolveDailyGoalRange(params = {}) {
  const today = getTodayInSaoPaulo();
  const period = Object.values(PERFORMANCE_PERIODS).includes(params.period) ? params.period : PERFORMANCE_PERIODS.TODAY;
  let startDate = today;
  let endDate = today;
  if (period === PERFORMANCE_PERIODS.YESTERDAY) { startDate = addDaysToPlainDate(today, -1); endDate = startDate; }
  else if (period === PERFORMANCE_PERIODS.LAST_7_DAYS) startDate = addDaysToPlainDate(today, -6);
  else if (period === PERFORMANCE_PERIODS.LAST_30_DAYS) startDate = addDaysToPlainDate(today, -29);
  else if (period === PERFORMANCE_PERIODS.CUSTOM) {
    startDate = normalizePlainDate(params.startDate) || today;
    endDate = normalizePlainDate(params.endDate) || startDate;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  }
  const endExclusive = addDaysToPlainDate(endDate, 1);
  return {
    period,
    startDate,
    endDate,
    startIso: zonedPlainDateToUtcIso(startDate),
    endIso: zonedPlainDateToUtcIso(endExclusive),
    label: period === PERFORMANCE_PERIODS.TODAY ? "Hoje" : period === PERFORMANCE_PERIODS.YESTERDAY ? "Ontem" : period === PERFORMANCE_PERIODS.LAST_7_DAYS ? "Últimos 7 dias" : period === PERFORMANCE_PERIODS.LAST_30_DAYS ? "Últimos 30 dias" : `${formatPlainDateBR(startDate)} a ${formatPlainDateBR(endDate)}`
  };
}

export async function getDailyGoalPerformance(params, auth) {
  assertGeneralAdminOrManager(auth);
  const range = resolveDailyGoalRange(params);
  const scopeIds = isGeneralAdminAuth(auth) ? null : (auth.profile.managedUserIds || [auth.profile.id]);

  let goalsQuery = db().from("daily_goals").select("broker_id, goal_date, new_quota, new_assigned_count, total_due").gte("goal_date", range.startDate).lte("goal_date", range.endDate);
  if (scopeIds) goalsQuery = goalsQuery.in("broker_id", scopeIds);
  const { data: goals, error: goalsError } = await goalsQuery;
  if (goalsError) throw goalsError;

  let attemptsQuery = db().from("daily_goal_attempts").select("broker_id, attempt_number, goal_date").gte("goal_date", range.startDate).lte("goal_date", range.endDate);
  if (scopeIds) attemptsQuery = attemptsQuery.in("broker_id", scopeIds);
  const { data: attempts, error: attemptsError } = await attemptsQuery;
  if (attemptsError) throw attemptsError;

  let roundsQuery = db().from("daily_goal_rounds").select("broker_id, round_started_at, status, converted_attempt, converted_at").gte("round_started_at", range.startDate).lte("round_started_at", range.endDate);
  if (scopeIds) roundsQuery = roundsQuery.in("broker_id", scopeIds);
  const { data: roundsStarted, error: roundsError } = await roundsQuery;
  if (roundsError) throw roundsError;

  let convertedQuery = db().from("daily_goal_rounds").select("broker_id, converted_attempt").eq("status", "converted").gte("converted_at", range.startIso).lt("converted_at", range.endIso);
  if (scopeIds) convertedQuery = convertedQuery.in("broker_id", scopeIds);
  const { data: converted, error: convertedError } = await convertedQuery;
  if (convertedError) throw convertedError;

  const profiles = await listAdminProfiles();
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const previstas = (goals || []).reduce((sum, row) => sum + (row.total_due || 0), 0);
  const realizadas = (attempts || []).length;
  const iniciaramCadencia = (roundsStarted || []).length;
  const convertidos = (converted || []).length;

  const byMessage = [1, 2, 3].map((number) => {
    const abordados = (attempts || []).filter((attempt) => attempt.attempt_number === number).length;
    const convertidosNaMensagem = (converted || []).filter((round) => round.converted_attempt === number).length;
    return { attemptNumber: number, abordados, convertidos: convertidosNaMensagem, taxa: abordados ? convertidosNaMensagem / abordados : null };
  });

  const byBroker = new Map();
  function bucket(brokerId) {
    if (!byBroker.has(brokerId)) {
      byBroker.set(brokerId, {
        brokerId,
        brokerName: profileById.get(brokerId)?.name || "Corretor",
        previstas: 0,
        realizadas: 0,
        iniciaramCadencia: 0,
        convertidos: 0,
        porMensagem: { 1: { abordados: 0, convertidos: 0 }, 2: { abordados: 0, convertidos: 0 }, 3: { abordados: 0, convertidos: 0 } }
      });
    }
    return byBroker.get(brokerId);
  }
  for (const row of goals || []) bucket(row.broker_id).previstas += row.total_due || 0;
  for (const row of attempts || []) {
    const entry = bucket(row.broker_id);
    entry.realizadas += 1;
    entry.porMensagem[row.attempt_number].abordados += 1;
  }
  for (const row of roundsStarted || []) bucket(row.broker_id).iniciaramCadencia += 1;
  for (const row of converted || []) {
    const entry = bucket(row.broker_id);
    entry.convertidos += 1;
    if (row.converted_attempt) entry.porMensagem[row.converted_attempt].convertidos += 1;
  }

  const teamBreakdown = Array.from(byBroker.values()).map((entry) => ({
    ...entry,
    execucao: entry.previstas ? entry.realizadas / entry.previstas : null,
    conversaoTotal: entry.iniciaramCadencia ? entry.convertidos / entry.iniciaramCadencia : null
  })).sort((a, b) => b.execucao - a.execucao || a.brokerName.localeCompare(b.brokerName, "pt-BR"));

  return {
    range,
    summary: {
      previstas,
      realizadas,
      execucao: previstas ? realizadas / previstas : null,
      iniciaramCadencia,
      convertidos,
      taxaReativacao: iniciaramCadencia ? convertidos / iniciaramCadencia : null,
      porMensagem: byMessage
    },
    team: teamBreakdown
  };
}

/* ------------------- Painel gerencial (exclusivo do dono) ------------------ */

// Reaproveita 100% do cálculo já existente: getDailyGoalPerformance (execução
// da meta/conversão de cadência) e getPerformanceOverview (funil real de
// atendimento/simulação, mesma fonte da tela Desempenho > Funil). Nenhum dado
// é recalculado do zero aqui — só combinamos os dois por corretor.
//
// "Respostas" não vira uma métrica própria: o sistema não tem como saber se um
// cliente respondeu a uma mensagem de WhatsApp pessoal (wa.me) — só existe
// confirmação de entrega/leitura para o número oficial da Meta (WhatsApp
// Master), que não é o canal usado na Meta Diária. Por isso o funil aqui usa
// só estágios com dado real: Contatos (tentativas registradas) → Atendimentos
// (status "Em atendimento") → Simulações.
async function loadOwnerTeamData(params, auth) {
  assertOwnerAdmin(auth);
  const [dailyPerf, overview, profiles] = await Promise.all([
    getDailyGoalPerformance(params, auth),
    getPerformanceOverview(params, auth),
    listAdminProfiles()
  ]);
  return { dailyPerf, overview, profiles };
}

function buildOwnerTeamOverview({ dailyPerf, overview, profiles }) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const funnelByBroker = new Map(overview.team.map((row) => [row.profile.id, row]));

  const brokers = dailyPerf.team
    .filter((entry) => {
      const profile = profileById.get(entry.brokerId);
      return profile && profile.status !== "inactive" && !isOwnerAdminEmail(profile.email);
    })
    .map((entry) => {
      const profile = profileById.get(entry.brokerId);
      const funnelRow = funnelByBroker.get(entry.brokerId);
      const contatos = entry.realizadas;
      const atendimentos = funnelRow?.service || 0;
      const simulacoes = funnelRow?.simulation || 0;
      const percent = entry.previstas ? Math.min(100, Math.round((entry.realizadas / entry.previstas) * 100)) : (entry.realizadas > 0 ? 100 : 0);

      return {
        brokerId: entry.brokerId,
        name: profile?.name || entry.brokerName,
        photoUrl: profile?.photoUrl || "",
        meta: { done: entry.realizadas, total: entry.previstas, percent },
        funnel: {
          contatos,
          atendimentos,
          simulacoes,
          taxaAtendimento: divideOrNull(atendimentos, contatos),
          taxaSimulacao: divideOrNull(simulacoes, atendimentos)
        },
        conversao: entry.conversaoTotal,
        porMensagem: entry.porMensagem || null
      };
    })
    .sort((a, b) => b.meta.percent - a.meta.percent || b.meta.done - a.meta.done || a.name.localeCompare(b.name, "pt-BR"));

  const teamContatos = dailyPerf.summary.realizadas;
  const teamAtendimentos = brokers.reduce((sum, broker) => sum + broker.funnel.atendimentos, 0);
  const teamSimulacoes = brokers.reduce((sum, broker) => sum + broker.funnel.simulacoes, 0);

  return {
    range: dailyPerf.range,
    summary: {
      metaPercent: dailyPerf.summary.previstas ? Math.min(100, Math.round((dailyPerf.summary.realizadas / dailyPerf.summary.previstas) * 100)) : 0,
      atividadesDone: dailyPerf.summary.realizadas,
      atividadesTotal: dailyPerf.summary.previstas,
      contatos: teamContatos,
      atendimentos: teamAtendimentos,
      simulacoes: teamSimulacoes,
      taxaAtendimento: divideOrNull(teamAtendimentos, teamContatos),
      taxaSimulacao: divideOrNull(teamSimulacoes, teamAtendimentos),
      taxaReativacao: dailyPerf.summary.taxaReativacao
    },
    brokers
  };
}

export async function getOwnerTeamDailyOverview(params, auth) {
  const data = await loadOwnerTeamData(params, auth);
  return buildOwnerTeamOverview(data);
}

export async function getOwnerBrokerDailyDetail(brokerId, params, auth) {
  const data = await loadOwnerTeamData(params, auth);
  const overview = buildOwnerTeamOverview(data);
  const broker = overview.brokers.find((row) => row.brokerId === brokerId) || null;
  if (!broker) throw new Error("Corretor não encontrado.");

  return {
    range: overview.range,
    broker,
    teamRates: {
      taxaAtendimento: overview.summary.taxaAtendimento,
      taxaSimulacao: overview.summary.taxaSimulacao,
      conversao: overview.summary.taxaReativacao
    }
  };
}

function divideOrNull(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

export function formatDailyGoalError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("daily_goal") || normalized.includes("prospecting_contacts")) {
    return "As tabelas da Meta Diária ainda não existem no Supabase. Execute as migrations supabase/migrations/20260914_daily_goal*.sql.";
  }
  return message || "Não foi possível concluir a operação da Meta Diária.";
}
