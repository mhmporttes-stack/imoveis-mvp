import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager, assertOwnerAdmin } from "./admin-access";
import { isGeneralAdminAuth, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { CLIENT_STATUS } from "./client-status";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { getPerformanceOverview } from "./performance-overview";
import { getTodayInSaoPaulo, addDaysToPlainDate, zonedPlainDateToUtcIso, normalizePlainDate, formatPlainDateBR, getTimeGreeting } from "./daily-report";
import { getDailyGoalWalletStatus, getDailyGoalWalletConfig, updateDailyGoalWalletConfig, getDailyGoalTarget } from "./daily-goal-wallet";
import { dailyGoalOverallProgress, dailyGoalPercent } from "./daily-goal-progress.mjs";
import { freezeDailyGoalPendingForActiveBrokers, getDailyGoalPendingProgress } from "./daily-goal-pending";

export { updateDailyGoalWalletConfig, freezeDailyGoalPendingForActiveBrokers };

// As pendências são um acréscimo à meta: se a consulta falhar, a Meta Diária continua
// funcionando como antes (só prospecção) em vez de quebrar a tela do corretor.
async function safePendingProgress(brokerId, day, options) {
  try {
    return await getDailyGoalPendingProgress(brokerId, day, options);
  } catch (error) {
    console.error("Falha ao calcular as pendências da Meta Diária.", error?.message || error);
    return null;
  }
}

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
  const [quota, messages, wallet] = await Promise.all([getCurrentDailyGoalQuota(), getDailyGoalMessages(), getDailyGoalWalletConfig(auth)]);
  return { quota, messages, wallet };
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

  // Fecha qualquer dia anterior ainda aberto ANTES de tudo: garante que a
  // meta nunca carrega progresso/contatos de um dia para o outro, mesmo que
  // o cron de fechamento (rede de segurança) ainda não tenha rodado.
  await closeStaleDailyGoalsForBroker(brokerId, today);
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
  const availableAfter = addDaysIso(now, 30);

  const convertedRounds = [];
  const endedRounds = [];
  for (const round of activeRounds) {
    const status = statusByClient.get(round.client_id);
    if (!status || status === CLIENT_STATUS.AWAITING_RETURN) continue;
    if (status === CLIENT_STATUS.IN_SERVICE) convertedRounds.push(round);
    else endedRounds.push({ round, status });
  }
  if (!convertedRounds.length && !endedRounds.length) return;

  // Antes: uma UPDATE + um INSERT (às vezes dois) por rodada divergente, em
  // sequência — em dia ruim, dezenas de idas ao banco uma atrás da outra só
  // pra abrir a Meta Diária. Agora: agrupado em lote (no máximo alguns
  // grupos, nunca um por rodada) e em paralelo — mesmo resultado, poucas
  // idas ao banco.
  const convertedByAttempt = new Map();
  for (const round of convertedRounds) {
    const list = convertedByAttempt.get(round.attempt_count) || [];
    list.push(round.id);
    convertedByAttempt.set(round.attempt_count, list);
  }
  const endedIds = endedRounds.map(({ round }) => round.id);
  const contactIdsToRelease = endedRounds
    .filter(({ status }) => status !== CLIENT_STATUS.DO_NOT_CONTACT)
    .map(({ round }) => round.prospecting_contact_id)
    .filter(Boolean);
  // Qualquer rodada que saiu de "active" por outro caminho (conversão,
  // arquivamento, "não contactar"...) não pode mais ter um envio automático
  // pendente esperando na fila (daily_goal_auto_queue) — cancela junto.
  const roundIdsToCancelQueue = [...convertedRounds.map((round) => round.id), ...endedIds];

  await Promise.all([
    ...[...convertedByAttempt.entries()].map(([attempt, ids]) =>
      runUpdate(db().from("daily_goal_rounds").update({ status: "converted", converted_attempt: attempt, converted_at: now }).in("id", ids).eq("status", "active"))
    ),
    endedIds.length
      ? runUpdate(db().from("daily_goal_rounds").update({ status: "ended_no_conversion", ended_at: now }).in("id", endedIds).eq("status", "active"))
      : null,
    contactIdsToRelease.length
      ? runUpdate(db().from("prospecting_contacts").update({ status: "recent_attempt", assigned_user_id: null, available_after: availableAfter, queue_sort_at: availableAfter, updated_at: now }).in("id", contactIdsToRelease).neq("status", "do_not_contact"))
      : null,
    roundIdsToCancelQueue.length
      ? runUpdate(db().from("daily_goal_auto_queue").update({ status: "canceled", skip_reason: "round_reconciled", updated_at: now }).in("round_id", roundIdsToCancelQueue).eq("status", "pending"))
      : null
  ].filter(Boolean));

  const historyRows = [
    ...convertedRounds.map((round) => ({ contact_id: round.prospecting_contact_id, registration_id: round.client_id || null, user_id: brokerId || null, event_type: "daily_goal_converted", details: { attempt: round.attempt_count } })),
    ...endedRounds.map(({ round, status }) => ({ contact_id: round.prospecting_contact_id, registration_id: round.client_id || null, user_id: brokerId || null, event_type: "daily_goal_round_ended", details: { attempt: round.attempt_count, reason: "external_status_change", status } }))
  ];
  if (historyRows.length) {
    const { error: historyError } = await db().from("prospecting_history").insert(historyRows);
    if (historyError) throw historyError;
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

  // A rodada (daily_goal_rounds) já é criada DENTRO da própria RPC, na mesma
  // transação que faz a checagem de espaço da carteira ativa — necessário
  // para a trava de concorrência (pg_advisory_xact_lock) realmente valer:
  // antes, a rodada só era criada depois, em JS separado, então a contagem
  // que a trava lia nunca mudava entre chamadas concorrentes e o limite podia
  // ser ultrapassado (confirmado em teste ao vivo: 5 chamadas simultâneas com
  // limite 3 concediam 5). Ver migration 20260919143000.
  //
  // [REGRA OFICIAL 2026-09-24] O corretor começa o dia com EXATAMENTE `quota`
  // (20) contatos aguardando 1º contato — nem mais, nem menos: se sobraram N
  // sem 1º contato de dias anteriores, entram só quota - N novos ("fez 10,
  // amanhã entram mais 10"). Antes entravam sempre 20 novos por cima do que
  // sobrou e a pilha crescia sem limite (ex.: 34 sem 1º contato).
  const { count: pendingFirstContacts, error: pendingError } = await db()
    .from("daily_goal_rounds")
    .select("id", { count: "exact", head: true })
    .eq("broker_id", brokerId)
    .eq("status", "active")
    .eq("attempt_count", 0);
  if (pendingError) throw pendingError;
  const toClaim = Math.max(0, quota - (pendingFirstContacts || 0));
  const { data: claimed, error: claimError } = toClaim > 0
    ? await db().rpc("claim_daily_goal_contacts", { p_broker_id: brokerId, p_quota: toClaim, p_today: today })
    : { data: [], error: null };
  if (claimError) throw claimError;

  let assignedCount = 0;
  for (const contact of claimed || []) {
    try {
      await logHistory(contact.id, null, brokerId, "claimed", { source: "daily_goal" });
      assignedCount += 1;
    } catch (historyError) {
      console.error("Falha ao registrar histórico da Meta Diária:", historyError?.message || historyError);
      await runUpdate(db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, updated_at: new Date().toISOString() }).eq("id", contact.id).eq("assigned_user_id", brokerId));
      await runUpdate(db().from("daily_goal_rounds").update({ status: "ended_no_conversion", ended_at: new Date().toISOString() }).eq("prospecting_contact_id", contact.id).eq("broker_id", brokerId).eq("status", "active"));
    }
  }
  if (assignedCount) {
    await runUpdate(db().from("daily_goals").update({ new_assigned_count: assignedCount }).eq("broker_id", brokerId).eq("goal_date", today));
  }
}

// Mesma pessoa pode ter mais de uma linha em prospecting_contacts (telefones
// diferentes, legado de importação/base compartilhada) — marcar "não
// contactar novamente" ou fechar venda sempre atualiza só a linha/cliente
// que o corretor tocou, nunca as outras. Checa pela PESSOA de verdade (por
// registration_id OU telefone), mesma trava já usada nos RPCs de
// reivindicar contato (claim_daily_goal_contacts/claim_single_prospecting_contact,
// migration 20260928200000_daily_goal_claim_guards.sql) — achado real,
// 2026-09-30 (pente-fino): sem isso, uma rodada da Meta Diária presa numa
// dessas outras linhas (ainda sem 1º toque, client_id nulo) nunca era
// reconciliada e podia mandar mensagem de verdade pra quem já pediu pra
// parar, ou reabrir contato com quem já fechou venda.
export async function isContactBlockedFromOutreach({ registrationId, phoneNormalized }) {
  if (!registrationId && !phoneNormalized) return false;
  const blockedStatuses = [CLIENT_STATUS.DO_NOT_CONTACT, CLIENT_STATUS.SALE_COMPLETED];
  const checks = [];
  if (registrationId) {
    checks.push(db().from("simulation_registrations").select("id").eq("id", registrationId).in("status", blockedStatuses).maybeSingle());
  }
  if (phoneNormalized) {
    checks.push(db().from("simulation_registrations").select("id").eq("phone_normalized", phoneNormalized).in("status", blockedStatuses).limit(1).maybeSingle());
  }
  const results = await Promise.all(checks);
  return results.some((result) => Boolean(result.data));
}

// Cria/vincula o cliente real (simulation_registrations) na hora do PRIMEIRO
// toque de verdade — mesma lógica que materializeRound usava, só que agora
// disparada pela ação do corretor, não pela reserva em lote da fila.
async function materializeClientOnFirstAttempt(round, auth, now) {
  const brokerId = auth.profile.id;
  const contactId = round.prospecting_contact_id;
  let registrationId = round.contact?.registration_id;

  if (!registrationId) {
    const registration = await ensureManualSimulationRegistration({
      fullName: round.contact?.name,
      phone: round.contact?.phone_normalized,
      status: CLIENT_STATUS.AWAITING_RETURN,
      adminEmail: auth.user?.email
    }, auth);
    registrationId = registration.id;
    const { error: linkError } = await db().from("prospecting_contacts").update({ registration_id: registrationId }).eq("id", contactId);
    if (linkError) throw linkError;
    await runUpdate(db().from("simulation_registrations").update({ prospecting_contact_id: contactId }).eq("id", registrationId));
  } else {
    // Reforço (item 2 do achado): nunca sobrescreve um status "final" (não
    // contactar / venda concluída) de volta para "aguardando retorno" — os
    // pontos de chamada já bloqueiam antes de chegar aqui, isto é só a
    // última trava caso algo mude no meio do caminho.
    const { data: currentClient } = await db().from("simulation_registrations").select("status").eq("id", registrationId).maybeSingle();
    if (currentClient && [CLIENT_STATUS.DO_NOT_CONTACT, CLIENT_STATUS.SALE_COMPLETED].includes(currentClient.status)) {
      throw new Error("Este cliente não pode mais ser contactado (status: " + currentClient.status + ").");
    }
    const { error: updateError } = await db().from("simulation_registrations").update({
      responsible_user_id: brokerId,
      status: CLIENT_STATUS.AWAITING_RETURN,
      prospecting_contact_id: contactId,
      last_status_change_at: now
    }).eq("id", registrationId);
    if (updateError) throw updateError;
  }

  await runUpdate(db().from("daily_goal_rounds").update({ client_id: registrationId }).eq("id", round.id));
  return registrationId;
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
    .select("id, attempt_count, round_started_at, status, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code), contact:prospecting_contacts(name, phone_normalized)")
    .eq("broker_id", brokerId)
    .or(`round_started_at.in.(${today},${yesterday},${dayBeforeYesterday}),status.eq.active`);
  if (roundsError) throw roundsError;

  // Sugestão do dono (2026-09-21): o card de um cliente que acabou de receber
  // uma tentativa REAL hoje não deve sumir da tela nem pular direto pra
  // próxima etapa — ele fica visível na MESMA seção com um "realizado hoje" e
  // só migra pra etapa seguinte no dia seguinte (a data de corte
  // round_started_at<=ontem/anteontem abaixo já garante isso pra quando ele
  // fica ACIONÁVEL; isto aqui só resolve ele ficar VISÍVEL enquanto isso).
  // daily_goal_attempts é a fonte de verdade de "qual tentativa foi feita
  // hoje" (goal_date), não round_started_at — uma rodada atrasada pode ter
  // sua 2ª/3ª tentativa feita hoje mesmo tendo começado dias atrás.
  const { data: attemptsToday, error: attemptsTodayError } = await db()
    .from("daily_goal_attempts")
    .select("round_id, client_id")
    .eq("broker_id", brokerId)
    .eq("goal_date", today);
  if (attemptsTodayError) throw attemptsTodayError;
  // Cliente que já recebeu tentativa hoje vale como prospecção — não pode contar
  // de novo como pendência resolvida (mesma consulta acima, sem custo extra).
  const attemptClientIdsToday = new Set((attemptsToday || []).map((row) => row.client_id).filter(Boolean));
  // Um corretor atrasado pode registrar mais de uma tentativa (2ª e 3ª, por
  // exemplo) da MESMA rodada no mesmo dia — por isso um Set de round_ids, não
  // um Map por attempt_number: o card "realizado hoje" sempre mostra o
  // ESTÁGIO ATUAL da rodada (round.attempt_count, sempre o mais avançado),
  // nunca um número de tentativa específico que poderia estar desatualizado.
  const roundIdsWithAttemptToday = new Set((attemptsToday || []).map((row) => row.round_id));

  // A 3ª tentativa encerra a rodada (status deixa de ser "active") e pode ter
  // round_started_at fora da janela de 3 dias buscada acima (rodada
  // atrasada) — sem isso ela ficaria invisível no card "realizado hoje" de
  // Última tentativa.
  let allRounds = rounds || [];
  const missingRoundIds = [...roundIdsWithAttemptToday].filter((id) => !allRounds.some((round) => round.id === id));
  if (missingRoundIds.length) {
    const { data: extraRounds, error: extraError } = await db()
      .from("daily_goal_rounds")
      .select("id, attempt_count, round_started_at, status, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code), contact:prospecting_contacts(name, phone_normalized)")
      .in("id", missingRoundIds);
    if (extraError) throw extraError;
    allRounds = [...allRounds, ...(extraRounds || [])];
  }
  const roundById = new Map(allRounds.map((round) => [round.id, round]));
  const doneTodayCards = { first: [], second: [], third: [] };
  for (const roundId of roundIdsWithAttemptToday) {
    const round = roundById.get(roundId);
    if (!round || !round.attempt_count) continue;
    const key = round.attempt_count === 1 ? "first" : round.attempt_count === 2 ? "second" : "third";
    doneTodayCards[key].push(mapDoneRound(round, round.attempt_count));
  }

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
  // Só para o card "Novos contatos" separar visualmente o que é da cota de
  // hoje do que é carregado de dias anteriores (ver comentário do fetch
  // acima) — não é "atrasado"/cobrança, é só contexto de composição, já que
  // a meta (total) fica presa na cota do dia e a lista de pendentes pode
  // ficar maior que ela. "2º contato"/"Última tentativa" não precisam disso:
  // ali, pendente de dias anteriores É o funcionamento normal da cadência de
  // 3 toques, não uma exceção a explicar.
  const pendingFirstToday = pendingFirstRounds.filter((round) => round.round_started_at === today).length;
  const pendingFirstCarriedOver = pendingFirstRounds.length - pendingFirstToday;
  // [REGRA OFICIAL 2026-09-24] Quem recebeu uma tentativa HOJE fica verde na
  // etapa em que acabou de ser feito e só desce para a próxima à meia-noite —
  // por isso rodada com tentativa hoje NUNCA entra como pendente da etapa
  // seguinte (antes, rodada atrasada com 1ª tentativa feita hoje já aparecia
  // também como pendente de 2ª tentativa no mesmo dia, pois o corte era só
  // round_started_at).
  const pendingSecondRounds = (rounds || []).filter((round) => round.status === "active" && round.attempt_count === 1 && round.round_started_at <= yesterday && !roundIdsWithAttemptToday.has(round.id));
  const pendingThirdRounds = (rounds || []).filter((round) => round.status === "active" && round.attempt_count === 2 && round.round_started_at <= dayBeforeYesterday && !roundIdsWithAttemptToday.has(round.id));

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
    new: {
      total: goalRow?.new_quota ?? newCohort.length,
      done: doneNew,
      pending: mapRounds(pendingFirstRounds, messages, brokerName),
      doneToday: doneTodayCards.first,
      pendingToday: pendingFirstToday,
      pendingCarriedOver: pendingFirstCarriedOver
    },
    second: { total: doneSecond + pendingSecondRounds.length, done: doneSecond, pending: mapRounds(pendingSecondRounds, messages, brokerName), doneToday: doneTodayCards.second },
    third: { total: doneThird + pendingThirdRounds.length, done: doneThird, pending: mapRounds(pendingThirdRounds, messages, brokerName), doneToday: doneTodayCards.third }
  };

  // Group counters describe the cadence; progress uses the active wallet
  // (carteira ativa + trabalhados hoje que já saíram dela — encerrados OU
  // convertidos; ver .claude/rules/meta-diaria-ranking.md). Este total é o
  // MESMO usado por getDailyGoalTarget (fechamento do dia) e por
  // getDailyGoalCompletionStatus (liberação da prospecção extra): uma única
  // conta para a meta, senão o painel mostra 106% e o bloqueio pede "51 de 60".
  const total = groups.new.total + groups.second.total + groups.third.total;
  const done = groups.new.done + groups.second.done + groups.third.done;
  const wallet = await getDailyGoalWalletStatus(brokerId);
  // dayTarget = carteira ativa + contatos trabalhados hoje que já saíram dela
  // (ex.: "sem interesse" → Não contactar) — confirmado pelo dono 2026-09-23.
  // SEM fallback por "||": wallet.dayTarget é sempre um número (nunca
  // null/undefined), e 0 é um valor LEGÍTIMO (corretor com a carteira do dia
  // inteiramente concluída/encerrada e nada novo gerado ainda). O "||"
  // anterior tratava esse 0 real como "ausente" e voltava pra cota nominal
  // antiga (goalRow.new_quota) — o painel mostrava um alvo maior (ex. 20) que
  // getDailyGoalCompletionStatus (sem esse fallback, sempre usou o dayTarget
  // real), fazendo o card aparentar 100%/quase-100% enquanto a Prospecção
  // Extra continuava bloqueada com "0 atividades" — bug real (corretora
  // Bruna, 2026-09-29). Ver o comentário acima: é exatamente o "painel mostra
  // 106%, bloqueio pede 51 de 60" que esta função já existia pra evitar.
  const quota = wallet.dayTarget;
  const [realizedToday, pendingProgress] = await Promise.all([
    computeDailyGoalRealizedToday(brokerId, today),
    safePendingProgress(brokerId, today, { attemptClientIds: attemptClientIdsToday })
  ]);
  // [REGRA OFICIAL 2026-09-25] Os 100% = prospecção (quota) + pendentes
  // congelados no início do dia; depois dos 100%, só prospecção excedente soma.
  const progress = dailyGoalOverallProgress({
    prospectingDone: realizedToday,
    prospectingTarget: quota,
    pendingDone: pendingProgress?.done,
    pendingTotal: pendingProgress?.total
  });
  const percent = progress.percent;

  if (goalRow && goalRow.total_due !== quota) {
    await runUpdate(db().from("daily_goals").update({ total_due: quota }).eq("broker_id", brokerId).eq("goal_date", today));
  }

  return {
    date: today,
    total,
    done,
    quota,
    realizedToday,
    percent,
    // Detalhe das duas obrigações para o card (Prospecção x/y, Pendentes x/y).
    // `pending` é null enquanto o congelamento não está disponível no banco.
    prospecting: progress.prospecting,
    pending: pendingProgress ? progress.pending : null,
    totalRequired: progress.required,
    wallet,
    groups: {
      new: {
        total: groups.new.total,
        done: groups.new.done,
        clients: groups.new.pending,
        doneToday: groups.new.doneToday,
        pendingToday: groups.new.pendingToday,
        pendingCarriedOver: groups.new.pendingCarriedOver
      },
      second: { total: groups.second.total, done: groups.second.done, clients: groups.second.pending, doneToday: groups.second.doneToday },
      third: { total: groups.third.total, done: groups.third.done, clients: groups.third.pending, doneToday: groups.third.doneToday }
    }
  };
}

// Fonte ÚNICA de "trabalho real de hoje": tentativas de qualquer número
// (1ª/2ª/3ª, todas contam igual — regra explícita do pente-fino) mais
// reivindicações manuais reais (Base da Imobiliária/Minha Base). A
// reivindicação automática da própria Meta Diária ("claimed" com
// details.source="daily_goal") é a RESERVA do contato, não uma ação —
// excluída aqui pelo mesmo motivo que já era excluída de
// getDailyGoalPerformance, para nunca contar como produtividade. Reaproveitada
// pelo percentual da Meta Diária, pelo bônus do ranking
// (performance-overview.js) e pelo fechamento diário — um único cálculo,
// nunca três fórmulas divergentes.
export async function computeDailyGoalRealizedToday(brokerId, day) {
  const dayStartIso = zonedPlainDateToUtcIso(day);
  const dayEndIso = zonedPlainDateToUtcIso(addDaysToPlainDate(day, 1));

  const [{ count: attemptsCount, error: attemptsError }, { data: claims, error: claimsError }] = await Promise.all([
    db().from("daily_goal_attempts").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("goal_date", day),
    db().from("prospecting_history").select("id, details").eq("user_id", brokerId).eq("event_type", "claimed").gte("created_at", dayStartIso).lt("created_at", dayEndIso)
  ]);
  if (attemptsError) throw attemptsError;
  if (claimsError) throw claimsError;

  const realClaims = (claims || []).filter((row) => row.details?.source !== "daily_goal").length;
  return (attemptsCount || 0) + realClaims;
}

// Card "realizado hoje" (sem ação/mensagem, só a etiqueta) — mesma origem de
// nome/telefone do mapRounds abaixo, mas attemptNumber é a tentativa que
// ACABOU de ser feita (não attempt_count+1, que apontaria pra próxima etapa).
function mapDoneRound(round, attemptNumber) {
  const fullName = round.client?.full_name || round.contact?.name || "Cliente";
  return {
    roundId: round.id,
    clientId: round.client_id,
    fullName,
    clientCode: round.client?.client_code || "",
    attemptNumber,
    completedToday: true
  };
}

// Um cliente ainda não existe para rodadas nunca trabalhadas (client_id nulo
// — ver materializeClientOnFirstAttempt): o nome/telefone vêm então direto
// de prospecting_contacts, a mesma fonte que já alimenta a fila manual.
function mapRounds(rounds, messages, brokerName) {
  return rounds.map((round) => {
    const attemptNumber = round.attempt_count + 1;
    const config = messages[`message${attemptNumber}`] || { text: "", allowPersonalization: false };
    const fullName = round.client?.full_name || round.contact?.name || "Cliente";
    const phone = round.client?.phone_normalized || round.contact?.phone_normalized || "";
    const vars = { saudacao: getTimeGreeting(), primeiro_nome: firstName(fullName), nome_corretor: brokerName, codigo_cliente: round.client?.client_code || "" };
    return {
      roundId: round.id,
      clientId: round.client_id,
      fullName,
      clientCode: round.client?.client_code || "",
      phone,
      attemptNumber,
      previewMessage: renderTemplate(config.text, vars),
      allowPersonalization: Boolean(config.allowPersonalization)
    };
  });
}

async function loadDailyGoalRoundForBroker(roundId, brokerId) {
  const { data: round, error } = await db()
    .from("daily_goal_rounds")
    .select("id, attempt_count, status, prospecting_contact_id, client_id, client:simulation_registrations(id, full_name, phone_normalized, client_code), contact:prospecting_contacts(name, phone_normalized, registration_id)")
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
    primeiro_nome: firstName(round.client?.full_name || round.contact?.name),
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

// A Meta Diária virou automática pra quem já está com a automação rodando
// de verdade (ligada, sem pausa, WhatsApp individual conectado) — pedido do
// dono, 2026-09-30, depois de validar entrega real ponta a ponta. Consulta
// direta (sem importar lib/daily-goal-auto.js — evitaria import circular,
// já que aquele arquivo importa deste) só com as 2 tabelas necessárias.
// Corretor sem automação rodando (nunca ligou, pausado, ou desconectado)
// continua podendo mandar manual — bloquear ele também o deixaria sem
// nenhum jeito de prospectar.
async function isAutoDispatchActiveForBroker(brokerId) {
  const { data: settings } = await db().from("daily_goal_auto_settings").select("enabled, paused").eq("broker_id", brokerId).maybeSingle();
  if (!settings?.enabled || settings.paused) return false;
  const { data: session } = await db().from("whatsapp_individual_sessions").select("status").eq("user_id", brokerId).maybeSingle();
  return session?.status === "connected";
}

export async function registerDailyGoalAttempt(roundId, customText, auth) {
  const brokerId = requireBrokerId(auth);
  if (await isAutoDispatchActiveForBroker(brokerId)) {
    throw new Error("Sua Meta Diária agora roda automaticamente pelo seu WhatsApp individual — não precisa mais enviar manualmente.");
  }
  const round = await loadDailyGoalRoundForBroker(roundId, brokerId);

  if (await isContactBlockedFromOutreach({ registrationId: round.client_id || round.contact?.registration_id, phoneNormalized: round.contact?.phone_normalized })) {
    throw new Error("Este cliente pediu para não ser mais contactado (ou já fechou venda) — a tentativa foi cancelada.");
  }

  const nextAttempt = round.attempt_count + 1;
  if (nextAttempt > 3) throw new Error("Este cliente já recebeu as 3 tentativas.");

  const now = new Date().toISOString();
  const today = getTodayInSaoPaulo();

  // Uma tentativa por contato por dia: a próxima só é liberada depois da
  // meia-noite (a tela já esconde o botão; isto barra chamada duplicada/antiga).
  const { count: attemptsTodayForRound, error: sameDayError } = await db()
    .from("daily_goal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("round_id", round.id)
    .eq("goal_date", today);
  if (sameDayError) throw sameDayError;
  if (attemptsTodayForRound) throw new Error("Este cliente já recebeu uma tentativa hoje. A próxima só é liberada amanhã.");

  // Primeiro toque real: só aqui o contato vira cliente de fato (ver
  // materializeClientOnFirstAttempt) — disponibilizar para a Meta Diária
  // nunca cria cliente sozinho.
  if (!round.client_id) {
    round.client_id = await materializeClientOnFirstAttempt(round, auth, now);
  }

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

  const { error: attemptError } = await db().from("daily_goal_attempts").insert({
    round_id: round.id,
    client_id: round.client_id,
    broker_id: brokerId,
    attempt_number: nextAttempt,
    goal_date: today,
    message_used: finalText,
    is_personalized: isPersonalized,
    origin: "manual"
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

  // O fim da terceira tentativa encerra só a rodada da Meta Diária — NÃO
  // libera o contato/cliente na hora. Liberar imediatamente tirava o
  // responsável do corretor no exato instante em que a última mensagem
  // saía, antes de o cliente ter qualquer chance de responder (pedido do
  // dono, 2026-09-30, depois de um caso real onde a cliente respondeu à 3ª
  // tentativa e o card já tinha voltado pro dono). O corretor continua
  // responsável, com o cliente em "Tentando contato", até ele mesmo mudar o
  // status — ou até a rotina de inatividade de 7 dias (prospecting-auto-return.js)
  // liberar por abandono de verdade.

  await logHistory(round.prospecting_contact_id, round.client_id, brokerId, willEnd ? "daily_goal_round_ended" : "daily_goal_attempt", {
    attempt: nextAttempt,
    message: finalText.slice(0, 300),
    personalized: isPersonalized,
    channel: "whatsapp"
  });

  const phone = round.client?.phone_normalized || round.contact?.phone_normalized || "";
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Cliente sem WhatsApp válido cadastrado.");

  // Sempre o WhatsApp de verdade, nunca o Chat interno (decisão do dono,
  // 2026-09-29): o Chat hoje é a sessão individual de cada corretor (QR
  // code), que no celular não fica conectada de forma confiável — mandar
  // pra lá em vez do WhatsApp real deixava o botão "sem fazer nada" pro
  // corretor em boa parte dos cliques.
  const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(finalText)}`;

  return { attemptNumber: nextAttempt, whatsappUrl, ended: willEnd };
}

// USO EXCLUSIVO do cron da automação da Meta Diária
// (app/api/cron/whatsapp-meta-diaria-dispatch) — nunca chamar a partir de uma
// rota de usuário. O "auth" é sintético (monta a partir do admin_users do
// corretor, não de sessão de navegador) e só é aceitável aqui porque quem
// chama já validou o CRON_SECRET antes. Cobre 1ª, 2ª e 3ª tentativa (pedido
// do dono, 2026-09-29) — materializa o cliente se for o 1º toque, grava a
// tentativa com origin='auto', avança attempt_count e, na 3ª, encerra a
// rodada com os MESMOS efeitos colaterais do fluxo manual (liberar o
// contato, voltar o cliente para "aguardando retorno"). O texto já vem
// pronto do dispatcher (variação sorteada na 1ª, mensagem configurada em
// Gestão nas seguintes). Assume que o envio pelo WhatsApp individual JÁ foi
// confirmado por quem chama — nunca reenvia mensagem, só registra o que já
// foi mandado.
export async function registerDailyGoalAttemptAutomated({ roundId, brokerId, brokerName, text }) {
  const auth = { ok: true, profile: { id: brokerId, name: brokerName || "" } };
  const round = await loadDailyGoalRoundForBroker(roundId, brokerId);
  const nextAttempt = round.attempt_count + 1;
  if (nextAttempt > 3) throw new Error("Este cliente já recebeu as 3 tentativas.");

  const now = new Date().toISOString();
  const today = getTodayInSaoPaulo();

  const { count: attemptsTodayForRound, error: sameDayError } = await db()
    .from("daily_goal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("round_id", round.id)
    .eq("goal_date", today);
  if (sameDayError) throw sameDayError;
  if (attemptsTodayForRound) throw new Error("Este cliente já recebeu uma tentativa hoje.");

  if (!round.client_id) {
    round.client_id = await materializeClientOnFirstAttempt(round, auth, now);
  }

  const finalText = cleanText(text, 1000);
  if (!finalText) throw new Error("Mensagem vazia.");

  const { error: attemptError } = await db().from("daily_goal_attempts").insert({
    round_id: round.id,
    client_id: round.client_id,
    broker_id: brokerId,
    attempt_number: nextAttempt,
    goal_date: today,
    message_used: finalText,
    is_personalized: false,
    origin: "auto"
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

  // Mesmo raciocínio de registerDailyGoalAttempt (manual): a 3ª tentativa só
  // encerra a rodada, não libera o cliente na hora — senão o corretor perde
  // o responsável no instante em que a última mensagem automática sai, antes
  // de a cliente ter qualquer chance de responder.

  await logHistory(round.prospecting_contact_id, round.client_id, brokerId, willEnd ? "daily_goal_round_ended" : "daily_goal_attempt", {
    attempt: nextAttempt,
    message: finalText.slice(0, 300),
    personalized: false,
    channel: "whatsapp",
    origin: "auto"
  });

  return { attemptNumber: nextAttempt, ended: willEnd };
}

// Banco de mensagens da AUTOMAÇÃO (WhatsApp individual) — SEPARADO das
// mensagens manuais (message1/2/3 acima): pedido do dono, 2026-09-29, de
// variar o texto entre várias opções pra reduzir o padrão repetitivo que
// costuma derrubar número no WhatsApp. 4 variações por tentativa (1ª/2ª/3ª),
// cadastradas em Gestão > Meta Diária > Automação, sorteadas sem repetir a
// última usada (ver pickMessageVariant em lib/daily-goal-auto-core.mjs). A 1ª
// tentativa é o PRIMEIRO contato de verdade com quem está na fila de
// prospecção (pode ser lead novo ou cliente já atendido antes — o corretor
// nunca sabe qual dos dois de antemão) — por isso fica só uma saudação
// simples, sem se apresentar nem mencionar atendimento anterior (pedido do
// dono, 2026-09-30, revertendo uma tentativa anterior de tom de
// pós-atendimento que não servia pra esse caso genérico). 2ª/3ª tentativa
// (reforço) já eram sobre atendimento anterior, mantidas como estão.
// {nome_corretor}/{associado_associada} também são suportadas por
// renderAutoMessage (lib/daily-goal-auto-core.mjs), mas não usadas nos
// modelos padrão abaixo.
const AUTO_MESSAGES_SETTINGS_ID = "daily_goal_auto_messages";

const DEFAULT_AUTO_MESSAGES = {
  message1: [
    "Oi {primeiro_nome}",
    "Olá, {primeiro_nome}, Tudo bem?",
    "{primeiro_nome}, tudo certo?",
    "{primeiro_nome}, tudo bem?"
  ],
  message2: [
    "Oi, {primeiro_nome}. Passando novamente para saber se deu tudo certo com seu atendimento e com a compra do imóvel.\n\n(Responda PARAR para não receber mais mensagens.)",
    "{primeiro_nome}, tudo bem? Queria só confirmar se você conseguiu avançar com a compra do seu imóvel.\n\n(Responda PARAR para não receber mais mensagens.)",
    "Olá, {primeiro_nome}. Conseguiu dar continuidade na compra do seu imóvel? Deu tudo certo com o atendimento?\n\n(Responda PARAR para não receber mais mensagens.)",
    "{primeiro_nome}, passando para saber como ficou seu atendimento e se conseguiu avançar com o imóvel.\n\n(Responda PARAR para não receber mais mensagens.)"
  ],
  message3: [
    "Oi, {primeiro_nome}, tudo bem? Passando novamente só para saber se deu tudo certo com seu atendimento e com a compra do imóvel.\n\n(Responda PARAR para não receber mais mensagens.)",
    "{primeiro_nome}, tudo bem? Queria apenas confirmar se você conseguiu avançar com a compra do seu imóvel e se ficou tudo certo no atendimento.\n\n(Responda PARAR para não receber mais mensagens.)",
    "Olá, {primeiro_nome}. Estou passando mais uma vez para saber como ficou a compra do seu imóvel e se precisa de alguma ajuda.\n\n(Responda PARAR para não receber mais mensagens.)",
    "Oi, {primeiro_nome}. Só queria confirmar se deu tudo certo com seu imóvel. Caso ainda precise de alguma orientação, fico à disposição por aqui.\n\n(Responda PARAR para não receber mais mensagens.)"
  ]
};

// Sem checagem de auth — lido pelo cron da automação (best-effort, cai nos
// padrões se algo faltar), mesmo padrão de getCurrentDailyGoalQuota.
export async function getDailyGoalAutoMessages() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", AUTO_MESSAGES_SETTINGS_ID).maybeSingle();
  if (error) throw error;
  const stored = data?.setting_value || {};
  const pick = (key) => (Array.isArray(stored[key]) && stored[key].length ? stored[key] : DEFAULT_AUTO_MESSAGES[key]);
  return { message1: pick("message1"), message2: pick("message2"), message3: pick("message3") };
}

export async function updateDailyGoalAutoMessages(payload, auth) {
  assertGeneralAdmin(auth);
  const next = {};
  for (const key of ["message1", "message2", "message3"]) {
    const texts = (Array.isArray(payload?.[key]) ? payload[key] : [])
      .map((text) => cleanText(text, 1000))
      .filter(Boolean)
      .slice(0, 4);
    if (!texts.length) throw new Error(`Informe ao menos 1 variação para a ${key === "message1" ? "1ª" : key === "message2" ? "2ª" : "3ª"} tentativa.`);
    for (const text of texts) if (/[<>]/.test(text)) throw new Error("Use apenas texto simples nas mensagens (sem HTML).");
    next[key] = texts;
  }
  const { error } = await db().from("crm_settings").upsert({
    id: AUTO_MESSAGES_SETTINGS_ID,
    setting_value: next,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return next;
}

/* ------------------------- Fechamento diário da meta ----------------------- */

// Fecha em definitivo o dia `day` de um corretor: só CONGELA o resultado
// final (realizado/percentual/bateu-ou-não, mesma fórmula de
// computeDailyGoalRealizedToday) em daily_goals — nunca mais mexe nas rodadas
// nem nos contatos. Regra explícita do pente-fino: "clientes pendentes não
// somem, clientes pendentes não avançam sozinhos" — uma rodada de 1ª tentativa
// nunca trabalhada continua ativa e visível como pendente pra sempre, até que
// o corretor realmente aja (tentativa, conversão, arquivamento, "não
// contactar") ou até virar cliente e seguir a cadência normal. Isso é
// exatamente o que antes NÃO acontecia: releaseUnworkedRoundsForDay devolvia
// a rodada de 1ª tentativa à fila geral só por o dia ter fechado, fazendo o
// cliente "sumir" da carteira sem nenhuma ação real — contrariando a regra
// nova. Idempotente por construção: o UPDATE só afeta a linha se closed_at
// ainda for nulo.
async function closeDailyGoalDay(brokerId, day, quota) {
  quota = await getDailyGoalTarget(brokerId, day);
  const done = await computeDailyGoalRealizedToday(brokerId, day);
  // [REGRA OFICIAL 2026-09-25] Bater a meta = prospecção + pendentes congelados
  // do dia. done_count/total_due continuam sendo só a prospecção (não mudam);
  // percent e goal_met passam a refletir os 100% completos. Sem pendentes (ou
  // sem a tabela de congelamento) o resultado é idêntico ao de antes.
  const pendingProgress = await safePendingProgress(brokerId, day, { createIfMissing: false });
  const progress = dailyGoalOverallProgress({ prospectingDone: done, prospectingTarget: quota, pendingDone: pendingProgress?.done, pendingTotal: pendingProgress?.total });
  const percent = progress.percent;
  const goalMet = progress.required > 0 && percent >= 100;

  const { data: closed, error } = await db()
    .from("daily_goals")
    .update({ total_due: quota, done_count: done, percent, goal_met: goalMet, closed_at: new Date().toISOString() })
    .eq("broker_id", brokerId)
    .eq("goal_date", day)
    .is("closed_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!closed) return null; // já fechado antes — idempotente, nada a fazer

  return { day, quota, done, percent, goalMet };
}

// Chamado a cada acesso do próprio corretor à Meta Diária: fecha qualquer
// dia anterior ainda aberto DELE antes de gerar a meta de hoje — cobre o
// caso de ele nunca ter aberto a tela no dia seguinte ao cron rodar (o cron
// abaixo é a rede de segurança para quem nem abre a tela).
async function closeStaleDailyGoalsForBroker(brokerId, today) {
  const { data: openRows, error } = await db()
    .from("daily_goals")
    .select("goal_date, new_quota")
    .eq("broker_id", brokerId)
    .is("closed_at", null)
    .lt("goal_date", today);
  if (error) throw error;
  for (const row of openRows || []) {
    await closeDailyGoalDay(brokerId, row.goal_date, row.new_quota);
  }
}

// Rede de segurança diária (cron, ver supabase/migrations/20260916_daily_goal_closing.sql
// e app/api/cron/daily-goal-close/route.js): fecha TODOS os dias anteriores
// ainda abertos de TODOS os corretores, mesmo quem não abriu a Meta Diária
// no dia seguinte — sem isso, um corretor que fica alguns dias sem acessar a
// tela ficaria com contatos presos indefinidamente.
export async function closeAllOpenDailyGoals() {
  const today = getTodayInSaoPaulo();
  const { data: openRows, error } = await db()
    .from("daily_goals")
    .select("broker_id, goal_date, new_quota")
    .is("closed_at", null)
    .lt("goal_date", today);
  if (error) throw error;

  // Cada linha é um (corretor, dia) independente — paralelizado em vez de
  // sequencial (achado de performance, pente-fino 2026-09-30): com o cron
  // tendo só 55s de orçamento (ver comentário em app/api/cron/daily-goal-close/
  // route.js) e ~20-30 corretores ativos, rodar um por vez arriscava estourar
  // o tempo conforme a equipe cresce.
  const results = await Promise.all((openRows || []).map((row) => closeDailyGoalDay(row.broker_id, row.goal_date, row.new_quota)));
  const closedCount = results.filter(Boolean).length;
  return { checked: openRows?.length || 0, closed: closedCount };
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

  let goalsQuery = db().from("daily_goals").select("broker_id, goal_date, new_quota, new_assigned_count, total_due, done_count, percent, goal_met, closed_at").gte("goal_date", range.startDate).lte("goal_date", range.endDate);
  if (scopeIds) goalsQuery = goalsQuery.in("broker_id", scopeIds);
  const { data: goals, error: goalsError } = await goalsQuery;
  if (goalsError) throw goalsError;

  let attemptsQuery = db().from("daily_goal_attempts").select("broker_id, attempt_number, goal_date, origin").gte("goal_date", range.startDate).lte("goal_date", range.endDate);
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

  // Closed days keep their saved full target; legacy days fall back to quota.

  const realizadas = (attempts || []).length + prospectingClaims.length;
  const automaticas = (attempts || []).filter((attempt) => attempt.origin === "auto").length;
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
        automaticas: 0,
        iniciaramCadencia: 0,
        convertidos: 0,
        porMensagem: { 1: { abordados: 0, convertidos: 0 }, 2: { abordados: 0, convertidos: 0 }, 3: { abordados: 0, convertidos: 0 } },
        diasComMetaFechada: 0,
        diasBatidos: 0,
        diasNaoBatidos: 0
      });
    }
    return byBroker.get(brokerId);
  }
  for (const row of goals || []) {
    const entry = bucket(row.broker_id);
    entry.previstas += row.total_due || row.new_quota || 0;
    if (row.closed_at) {
      entry.diasComMetaFechada += 1;
      if (row.goal_met) entry.diasBatidos += 1;
      else entry.diasNaoBatidos += 1;
    }
  }

  // Sequência atual de dias consecutivos batendo a meta, contando de trás
  // para frente a partir do dia fechado mais recente do período — só usa
  // dias já FECHADOS (goal_met não é nulo), nunca o dia corrente em aberto.
  const goalsByBroker = new Map();
  for (const row of goals || []) {
    if (!row.closed_at) continue;
    if (!goalsByBroker.has(row.broker_id)) goalsByBroker.set(row.broker_id, []);
    goalsByBroker.get(row.broker_id).push(row);
  }
  const streakByBroker = new Map();
  for (const [brokerId, rows] of goalsByBroker) {
    const sorted = [...rows].sort((a, b) => (a.goal_date < b.goal_date ? 1 : -1));
    let streak = 0;
    for (const row of sorted) {
      if (!row.goal_met) break;
      streak += 1;
    }
    streakByBroker.set(brokerId, streak);
  }

  for (const row of attempts || []) {
    const entry = bucket(row.broker_id);
    entry.realizadas += 1;
    if (row.origin === "auto") entry.automaticas += 1;
    entry.porMensagem[row.attempt_number].abordados += 1;
  }
  for (const row of prospectingClaims) bucket(row.user_id).realizadas += 1;
  for (const row of roundsStarted || []) bucket(row.broker_id).iniciaramCadencia += 1;
  for (const row of converted || []) {
    const entry = bucket(row.broker_id);
    entry.convertidos += 1;
    if (row.converted_attempt) entry.porMensagem[row.converted_attempt].convertidos += 1;
  }

  if (range.startDate === getTodayInSaoPaulo() && range.endDate === range.startDate) {
    await Promise.all(Array.from(byBroker.values()).map(async (entry) => {
      entry.previstas = await getDailyGoalTarget(entry.brokerId, range.startDate);
    }));
  }

  const teamBreakdown = Array.from(byBroker.values()).map((entry) => ({
    ...entry,
    execucao: entry.previstas ? dailyGoalPercent(entry.realizadas, entry.previstas) / 100 : null,
    conversaoTotal: entry.iniciaramCadencia ? entry.convertidos / entry.iniciaramCadencia : null,
    sequenciaAtual: streakByBroker.get(entry.brokerId) || 0
  })).sort((a, b) => b.execucao - a.execucao || a.brokerName.localeCompare(b.brokerName, "pt-BR"));

  const resolvedPrevistas = teamBreakdown.reduce((sum, entry) => sum + entry.previstas, 0);

  return {
    range,
    summary: {
      previstas: resolvedPrevistas,
      realizadas,
      automaticas,
      execucao: resolvedPrevistas ? dailyGoalPercent(realizadas, resolvedPrevistas) / 100 : null,
      iniciaramCadencia,
      convertidos,
      taxaReativacao: iniciaramCadencia ? convertidos / iniciaramCadencia : null,
      porMensagem: byMessage,
      diasBatidos: teamBreakdown.reduce((sum, entry) => sum + entry.diasBatidos, 0),
      diasNaoBatidos: teamBreakdown.reduce((sum, entry) => sum + entry.diasNaoBatidos, 0)
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
  // Carteira ativa é sempre "agora" (não faz sentido histórico — é o estoque
  // pendente ATUAL), independente do período escolhido no filtro do painel.
  const brokerIds = profiles.filter((profile) => profile.id).map((profile) => profile.id);
  const walletEntries = await Promise.all(brokerIds.map((id) => getDailyGoalWalletStatus(id).then((status) => [id, status])));
  const walletByBroker = new Map(walletEntries);

  // [REGRA OFICIAL 2026-09-25] Hoje, a meta de cada corretor também inclui os
  // pendentes congelados no início do dia. Só para o dia corrente (períodos
  // passados/agregados continuam pelo que foi fechado) e só para quem aparece
  // na lista (mesmo filtro de buildOwnerTeamOverview).
  const today = getTodayInSaoPaulo();
  const isTodayView = dailyPerf.range.startDate === today && dailyPerf.range.endDate === today;
  const shownBrokerIds = isTodayView ? profiles.filter((profile) => profile.id && profile.status !== "inactive" && !isOwnerAdminEmail(profile.email)).map((profile) => profile.id) : [];
  const pendingEntries = await Promise.all(shownBrokerIds.map((id) => safePendingProgress(id, today).then((progress) => [id, progress])));
  const pendingByBroker = new Map(pendingEntries);
  return { dailyPerf, overview, profiles, currentQuota, walletByBroker, pendingByBroker };
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
function buildOwnerTeamOverview({ dailyPerf, overview, profiles, currentQuota, walletByBroker, pendingByBroker }) {
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
      // No cartao do corretor, a meta representa a carteira ativa real dele.
      // A cota global continua controlando quantos contatos novos entram na
      // fila, mas nao deve aparecer como denominador de 9/36 atividades.
      const isToday = dailyPerf.range.startDate === getTodayInSaoPaulo() && daysInRange === 1;
      const total = isToday ? (walletByBroker?.get(profile.id)?.dayTarget ?? currentQuota) : (entry ? entry.previstas : currentQuota * daysInRange);
      const contatos = done;
      const atendimentos = funnelRow?.service || 0;
      const simulacoes = funnelRow?.simulation || 0;
      // Each prospect beyond the completed target adds one percentage point.
      // Hoje: prospecção + pendentes congelados (sem pendentes, o resultado é o
      // mesmo de sempre). `contatos` abaixo continua sendo só a prospecção.
      const pendingProgress = isToday ? pendingByBroker?.get(profile.id) || null : null;
      const progress = dailyGoalOverallProgress({ prospectingDone: done, prospectingTarget: total, pendingDone: pendingProgress?.done, pendingTotal: pendingProgress?.total });
      const percent = progress.percent;

      return {
        brokerId: profile.id,
        name: profile.name,
        photoUrl: profile.photoUrl || "",
        meta: { done: progress.done, total: progress.required, percent, prospecting: progress.prospecting, pending: pendingProgress ? progress.pending : null },
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
        convertidos: entry?.convertidos || 0,
        wallet: walletByBroker?.get(profile.id) || null
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
      metaPercent: dailyGoalPercent(teamDone, teamTotal),
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

  // Só para o dia de hoje: QUAIS clientes pendentes ainda faltam (a lista congelada
  // no início do dia menos os já resolvidos). Consulta só deste corretor.
  const today = getTodayInSaoPaulo();
  const isTodayView = overview.range.startDate === today && overview.range.endDate === today;
  const pendingDetail = isTodayView ? await safePendingProgress(brokerId, today, { withClients: true }) : null;

  return {
    range: overview.range,
    isToday: isTodayView,
    pendingDetail,
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
