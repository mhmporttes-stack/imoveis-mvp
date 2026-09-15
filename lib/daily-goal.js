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

// Mensagens efetivas de UM corretor: começa da mensagem padrão da imobiliária
// (Gestão > Meta Diária > Mensagens) e, para quem tem "Permitir personalização"
// ligado, troca pelo texto que ELE MESMO editou da última vez (daily_goal_
// broker_messages) — se ele nunca editou, ou se a Gestão desligou a
// personalização daquela mensagem, cai de volta no padrão geral. O padrão da
// imobiliária nunca é sobrescrito para os outros corretores.
async function getEffectiveDailyGoalMessages(brokerId) {
  const [messages, overrides] = await Promise.all([getDailyGoalMessages(), getBrokerMessageOverrides(brokerId)]);
  const result = {};
  for (const key of ["message1", "message2", "message3"]) {
    const base = messages[key];
    result[key] = base.allowPersonalization && overrides[key] ? { text: overrides[key], allowPersonalization: true } : base;
  }
  return result;
}

async function getBrokerMessageOverrides(brokerId) {
  const { data, error } = await db().from("daily_goal_broker_messages").select("message_key, text").eq("broker_id", brokerId);
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.message_key] = row.text;
  return map;
}

// Antes de salvar a edição do corretor como seu novo padrão, devolve as
// variáveis já substituídas (nome do cliente, saudação etc.) de volta para a
// forma de template ({primeiro_nome}, {saudacao}...) — sem isso, o nome do
// PRIMEIRO cliente em que ele editou ficaria fixo no texto de todos os
// próximos clientes. Substitui os valores mais longos primeiro para não
// truncar uma substituição maior por engano.
function extractTemplateFromEditedText(renderedText, vars) {
  let template = renderedText;
  const entries = Object.entries(vars)
    .filter(([, value]) => value)
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  for (const [key, value] of entries) {
    template = template.split(String(value)).join(`{${key}}`);
  }
  return template;
}

async function saveBrokerMessageOverride(brokerId, messageKey, template) {
  const { error } = await db().from("daily_goal_broker_messages").upsert({
    broker_id: brokerId,
    message_key: messageKey,
    text: template,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
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
    // Vínculo também no sentido inverso (simulation_registrations ->
    // prospecting_contact_id): é o sinal que a automação "Novo cliente
    // cadastrado" usa para nunca disparar para quem veio da Prospecção.
    await runUpdate(db().from("simulation_registrations").update({ prospecting_contact_id: contact.id }).eq("id", registrationId));
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

  const [messages, brokerProfile] = await Promise.all([getEffectiveDailyGoalMessages(brokerId), db().from("admin_users").select("name").eq("id", brokerId).maybeSingle().then((res) => res.data)]);
  const brokerName = cleanText(brokerProfile?.name, 80);

  // Busca a janela dos últimos 3 dias (para a contabilidade de cada coorte,
  // que continua sendo por dia exato — ver abaixo) E, à parte, TODA rodada
  // ainda ativa do corretor, de qualquer idade — sem o segundo critério, uma
  // rodada que "perdesse o dia certo" (corretor não abriu a Meta Diária
  // naquele dia específico, por exemplo) ficava de fora da busca inteira e,
  // por consequência, invisível para sempre: não contava mais como "nova"
  // (exigia iniciada hoje) nem como "2º/3º contato" (exigia exatamente
  // ontem/anteontem), mesmo continuando atribuída e ativa. Confirmado em
  // produção: dezenas de rodadas presas em vários corretores (Eduardo,
  // ketlin, o próprio dono) sem aparecer em nenhuma das 3 categorias.
  const { data: rounds, error: roundsError } = await db()
    .from("daily_goal_rounds")
    .select("id, attempt_count, round_started_at, status, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code)")
    .eq("broker_id", brokerId)
    .or(`round_started_at.in.(${today},${yesterday},${dayBeforeYesterday}),status.eq.active`);
  if (roundsError) throw roundsError;

  const newCohort = (rounds || []).filter((round) => round.round_started_at === today);
  const secondCohort = (rounds || []).filter((round) => round.round_started_at === yesterday && round.attempt_count >= 1);
  const thirdCohort = (rounds || []).filter((round) => round.round_started_at === dayBeforeYesterday && round.attempt_count >= 2);

  // "done" exige tentativa real (attempt_count) OU conversão genuína
  // (status "converted", quando o cliente virou "Em atendimento" de fato) —
  // NUNCA só por a rodada ter deixado de estar ativa. Uma rodada encerrada
  // por reconciliação externa (ended_no_conversion) sem nenhuma tentativa
  // não representa trabalho do corretor e não pode contar como concluída
  // (antes contava, causando divergência com o painel gerencial, que só
  // soma tentativas reais registradas em daily_goal_attempts).
  const doneNew = newCohort.filter((round) => round.status === "converted" || round.attempt_count >= 1).length;
  const doneSecond = secondCohort.filter((round) => round.status === "converted" || round.attempt_count >= 2).length;
  const doneThird = thirdCohort.filter((round) => round.status === "converted" || round.attempt_count >= 3).length;

  // Pendentes (cards mostrados pra agir) NUNCA ficam restritos ao dia exato
  // da coorte — pegam QUALQUER rodada ainda ativa que já esteja no ponto
  // certo da cadência (aguardando 1ª/2ª/3ª mensagem), não importa há quantos
  // dias. É isso que garante que nada suma de vista: um cliente atrasado
  // acumula na lista em vez de desaparecer. "Pelo menos N dias" (<=), não
  // mais "exatamente N dias" — só isso muda o comportamento de quem está em
  // dia (continua vendo exatamente os mesmos cards de antes).
  const pendingFirstRounds = (rounds || []).filter((round) => round.status === "active" && round.attempt_count === 0);
  const pendingSecondRounds = (rounds || []).filter((round) => round.status === "active" && round.attempt_count === 1 && round.round_started_at <= yesterday);
  const pendingThirdRounds = (rounds || []).filter((round) => round.status === "active" && round.attempt_count === 2 && round.round_started_at <= dayBeforeYesterday);

  const groups = {
    // "second"/"third": total = concluídas + ainda pendentes, nunca a contagem
    // bruta da coorte. Uma rodada de 2º/3º contato pode ser encerrada por
    // reconciliação externa (ex.: cliente virou "Não contactar"/arquivado por
    // outro caminho, sem o corretor sequer ter a chance de mandar a mensagem)
    // — antes isso continuava contando no total sem nunca poder contar como
    // concluída nem aparecer como pendente, tornando 100% matematicamente
    // impossível de alcançar mesmo fazendo tudo que estava ao alcance do
    // corretor. "new" já não tem esse problema: seu total vem da cota
    // congelada na geração do dia (goalRow.new_quota), não da contagem bruta
    // — pode ficar menor que a lista de pendentes se o corretor estiver
    // atrasado (mostra o acúmulo real, sem inflar a meta do dia por isso).
    new: { total: goalRow?.new_quota ?? newCohort.length, done: doneNew, pending: mapRounds(pendingFirstRounds, messages, brokerName) },
    second: { total: doneSecond + pendingSecondRounds.length, done: doneSecond, pending: mapRounds(pendingSecondRounds, messages, brokerName) },
    third: { total: doneThird + pendingThirdRounds.length, done: doneThird, pending: mapRounds(pendingThirdRounds, messages, brokerName) }
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

async function loadDailyGoalRoundForBroker(roundId, brokerId) {
  const { data: round, error } = await db()
    .from("daily_goal_rounds")
    .select("id, attempt_count, status, prospecting_contact_id, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code), contact:prospecting_contacts(phone_normalized)")
    .eq("id", roundId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw error;
  if (!round || round.status !== "active") throw new Error("Este cliente não está mais disponível na sua Meta Diária.");
  return round;
}

function buildDailyGoalVars(round, auth) {
  return {
    saudacao: getTimeGreeting(),
    primeiro_nome: firstName(round.client?.full_name),
    nome_corretor: cleanText(auth.profile?.name, 80),
    codigo_cliente: round.client?.client_code || ""
  };
}

// Salva a edição do corretor como o novo padrão PESSOAL dele para essa
// mensagem — ação explícita e separada do envio (um botão "Salvar" próprio),
// para não depender de enviar-com-texto-editado para persistir e ficar claro
// pra ele quando a edição realmente virou o novo padrão.
export async function saveDailyGoalMessageOverride(roundId, editedText, auth) {
  const brokerId = requireBrokerId(auth);
  const round = await loadDailyGoalRoundForBroker(roundId, brokerId);
  const nextAttempt = round.attempt_count + 1;
  if (nextAttempt > 3) throw new Error("Este cliente já recebeu as 3 tentativas.");
  const messageKey = `message${nextAttempt}`;

  const messages = await getEffectiveDailyGoalMessages(brokerId);
  const config = messages[messageKey] || { text: "", allowPersonalization: false };
  if (!config.allowPersonalization) throw new Error("A personalização não está liberada para esta mensagem.");

  const trimmed = cleanText(editedText, 1000);
  if (!trimmed) throw new Error("Digite um texto antes de salvar.");

  const vars = buildDailyGoalVars(round, auth);
  const template = extractTemplateFromEditedText(trimmed, vars);
  await saveBrokerMessageOverride(brokerId, messageKey, template);

  return { previewMessage: renderTemplate(template, vars) };
}

export async function registerDailyGoalAttempt(roundId, customText, auth) {
  const brokerId = requireBrokerId(auth);
  const round = await loadDailyGoalRoundForBroker(roundId, brokerId);

  const nextAttempt = round.attempt_count + 1;
  if (nextAttempt > 3) throw new Error("Este cliente já recebeu as 3 tentativas.");

  const messageKey = `message${nextAttempt}`;
  const messages = await getEffectiveDailyGoalMessages(brokerId);
  const config = messages[messageKey] || { text: "", allowPersonalization: false };
  const vars = buildDailyGoalVars(round, auth);

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

// Dias corridos entre duas datas "YYYY-MM-DD", incluindo ambas as pontas
// (ex.: mesma data = 1 dia; 7 dias corridos = 7). Usado só para a meta
// prevista de períodos de múltiplos dias — comparação de string de data pura,
// sem fuso, então Date.UTC é seguro aqui.
function countCalendarDaysInclusive(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const diff = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.round(diff / (24 * 60 * 60 * 1000)) + 1;
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

  // Mensagens enviadas pela Prospecção manual (Base da Imobiliária ou Minha
  // Base — mesmo botão WhatsApp, mesmo prospecting_history já existente)
  // também contam como atividade do dia, somadas às tentativas da própria
  // cadência da Meta Diária. "claimed" com details.source="daily_goal" é a
  // criação da rodada pela própria Meta Diária (já contada via
  // daily_goal_attempts) e não entra aqui, para não duplicar.
  let claimsQuery = db().from("prospecting_history").select("user_id, details").eq("event_type", "claimed").gte("created_at", range.startIso).lt("created_at", range.endIso);
  if (scopeIds) claimsQuery = claimsQuery.in("user_id", scopeIds);
  const { data: claimsRaw, error: claimsError } = await claimsQuery;
  if (claimsError) throw claimsError;
  const prospectingClaims = (claimsRaw || []).filter((row) => row.user_id && row.details?.source !== "daily_goal");

  const profiles = await listAdminProfiles();
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  // Períodos de mais de um dia (7/30 dias, personalizado): a soma de
  // daily_goals.total_due só conta os dias em que o corretor efetivamente
  // abriu a tela "Meta Diária" (é quando a linha do dia é criada) — um
  // corretor que trabalhou pela Prospecção manual em dias que não abriu essa
  // tela tem esses dias contados no numerador (realizadas, que vem de
  // prospecting_history independente disso) mas NÃO no denominador, inflando
  // artificialmente o percentual. Para período de 1 dia (Hoje/Ontem) isso não
  // se aplica: a linha do próprio dia, quando existe, já reflete o valor real
  // com a cadência de retorno — mantido como estava. Para mais de 1 dia, o
  // previsto vira meta vigente × dias do período, igual para todo mundo (o
  // mesmo raciocínio de "a meta é a mesma para todos" já usado no percentual
  // individual, só que multiplicado pelos dias — sugestão do próprio dono).
  const daysInRange = countCalendarDaysInclusive(range.startDate, range.endDate);
  const multiDayQuota = daysInRange > 1 ? await getCurrentDailyGoalQuota() : null;

  const previstas = multiDayQuota === null
    ? (goals || []).reduce((sum, row) => sum + (row.total_due || 0), 0)
    : null; // recalculado abaixo, depois que sabemos quais corretores entram no somatório
  const realizadas = (attempts || []).length + prospectingClaims.length;
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
  if (multiDayQuota === null) {
    for (const row of goals || []) bucket(row.broker_id).previstas += row.total_due || 0;
  }
  for (const row of attempts || []) {
    const entry = bucket(row.broker_id);
    entry.realizadas += 1;
    entry.porMensagem[row.attempt_number].abordados += 1;
  }
  for (const row of prospectingClaims) bucket(row.user_id).realizadas += 1;
  for (const row of roundsStarted || []) bucket(row.broker_id).iniciaramCadencia += 1;
  for (const row of converted || []) {
    const entry = bucket(row.broker_id);
    entry.convertidos += 1;
    if (row.converted_attempt) entry.porMensagem[row.converted_attempt].convertidos += 1;
  }

  // Meta prevista uniforme (meta vigente × dias do período) para todo
  // corretor que apareceu em algum sinal do período — só depois de todos os
  // buckets criados acima, senão um corretor que só tem prospectingClaims
  // (nenhuma linha em daily_goals no período) ficaria de fora.
  if (multiDayQuota !== null) {
    for (const entry of byBroker.values()) entry.previstas = multiDayQuota * daysInRange;
  }

  const teamBreakdown = Array.from(byBroker.values()).map((entry) => ({
    ...entry,
    execucao: entry.previstas ? entry.realizadas / entry.previstas : null,
    conversaoTotal: entry.iniciaramCadencia ? entry.convertidos / entry.iniciaramCadencia : null
  })).sort((a, b) => b.execucao - a.execucao || a.brokerName.localeCompare(b.brokerName, "pt-BR"));

  const resolvedPrevistas = multiDayQuota === null
    ? previstas
    : teamBreakdown.reduce((sum, entry) => sum + entry.previstas, 0);

  return {
    range,
    summary: {
      previstas: resolvedPrevistas,
      realizadas,
      execucao: resolvedPrevistas ? realizadas / resolvedPrevistas : null,
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
  const [dailyPerf, overview, profiles, currentQuota] = await Promise.all([
    getDailyGoalPerformance(params, auth),
    getPerformanceOverview(params, auth),
    listAdminProfiles(),
    getCurrentDailyGoalQuota()
  ]);
  return { dailyPerf, overview, profiles, currentQuota };
}

// A população de corretores do painel é a lista de perfis ativos (a mesma
// usada em qualquer outra tela de equipe) — NUNCA os corretores que
// aparecem em dailyPerf.team, que só lista quem já tem linha em
// daily_goals/daily_goal_attempts/daily_goal_rounds hoje (ou seja, quem já
// abriu a própria Meta Diária no período). Um corretor sem nenhuma
// atividade não tem essa linha e ficava invisível — não por algum limite/
// corte de exibição, mas porque a fonte de dados não incluía quem ainda
// não gerou meta. Um corretor sem linha aparece com 0/[meta atual
// configurada], nunca é omitido.
//
// Os totais do resumo superior também são somados sobre essa MESMA lista
// filtrada (nunca sobre dailyPerf.summary bruto) — isso corrige a segunda
// causa do problema relatado: o próprio administrador principal, ao ter
// acessado a Meta Diária antes desta visão gerencial existir, ficou com uma
// linha própria em daily_goals contando nos totais brutos mesmo sendo
// corretamente excluído dos cards (ele não é "corretor da equipe" aqui).
function buildOwnerTeamOverview({ dailyPerf, overview, profiles, currentQuota }) {
  const dailyByBroker = new Map(dailyPerf.team.map((entry) => [entry.brokerId, entry]));
  const funnelByBroker = new Map(overview.team.map((row) => [row.profile.id, row]));
  // Mesma regra de "meta vigente × dias do período" usada em
  // getDailyGoalPerformance, para o corretor sem nenhuma linha (zero
  // atividade no período inteiro) cair no total correto — sem isto ele
  // aparecia com "0/20" mesmo num período de 7/30 dias.
  const daysInRange = countCalendarDaysInclusive(dailyPerf.range.startDate, dailyPerf.range.endDate);

  const brokers = profiles
    .filter((profile) => profile.id && profile.status !== "inactive" && !isOwnerAdminEmail(profile.email))
    .map((profile) => {
      const entry = dailyByBroker.get(profile.id);
      const funnelRow = funnelByBroker.get(profile.id);
      const done = entry?.realizadas || 0;
      const total = entry ? entry.previstas : currentQuota * daysInRange;
      const contatos = done;
      const atendimentos = funnelRow?.service || 0;
      const simulacoes = funnelRow?.simulation || 0;
      // Percentual real, sem teto: bater a meta não é um limite, é um indicador —
      // 40/20 deve mostrar 200%, não travar em 100%. O teto de 100% fica só no
      // anel visual dos componentes que consomem este valor (DailyGoalDashboard.jsx
      // e TeamDailyPerformance.jsx já aplicam Math.min(100, ...) só no desenho do
      // anel, mantendo o texto com o valor real).
      const percent = total ? Math.round((done / total) * 100) : (done > 0 ? 100 : 0);

      return {
        brokerId: profile.id,
        name: profile.name,
        photoUrl: profile.photoUrl || "",
        meta: { done, total, percent },
        funnel: {
          contatos,
          atendimentos,
          simulacoes,
          taxaAtendimento: divideOrNull(atendimentos, contatos),
          taxaSimulacao: divideOrNull(simulacoes, atendimentos)
        },
        conversao: entry?.conversaoTotal ?? null,
        porMensagem: entry?.porMensagem || null,
        iniciaramCadencia: entry?.iniciaramCadencia || 0,
        convertidos: entry?.convertidos || 0
      };
    })
    .sort((a, b) => b.meta.percent - a.meta.percent || b.meta.done - a.meta.done || a.name.localeCompare(b.name, "pt-BR"));

  const teamDone = brokers.reduce((sum, broker) => sum + broker.meta.done, 0);
  const teamTotal = brokers.reduce((sum, broker) => sum + broker.meta.total, 0);
  const teamContatos = brokers.reduce((sum, broker) => sum + broker.funnel.contatos, 0);
  const teamAtendimentos = brokers.reduce((sum, broker) => sum + broker.funnel.atendimentos, 0);
  const teamSimulacoes = brokers.reduce((sum, broker) => sum + broker.funnel.simulacoes, 0);
  const teamIniciaramCadencia = brokers.reduce((sum, broker) => sum + broker.iniciaramCadencia, 0);
  const teamConvertidos = brokers.reduce((sum, broker) => sum + broker.convertidos, 0);

  return {
    range: dailyPerf.range,
    summary: {
      // Meta da equipe também sem teto — mesmo princípio do percentual individual
      // acima: 200 realizadas / 200 previstas em 10 corretores pode legitimamente
      // passar de 100% se algum corretor ultrapassar a própria meta.
      metaPercent: teamTotal ? Math.round((teamDone / teamTotal) * 100) : 0,
      atividadesDone: teamDone,
      atividadesTotal: teamTotal,
      contatos: teamContatos,
      atendimentos: teamAtendimentos,
      simulacoes: teamSimulacoes,
      taxaAtendimento: divideOrNull(teamAtendimentos, teamContatos),
      taxaSimulacao: divideOrNull(teamSimulacoes, teamAtendimentos),
      taxaReativacao: divideOrNull(teamConvertidos, teamIniciaramCadencia)
    },
    brokers: brokers.map(({ iniciaramCadencia, convertidos, ...broker }) => broker)
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
