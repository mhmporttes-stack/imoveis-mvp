import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";
import { DO_NOT_CONTACT_REASONS, getDoNotContactReasonOptions } from "./do-not-contact-reasons";
import { dailyGoalOverallProgress, walletDayTarget } from "./daily-goal-progress.mjs";
import { getDailyGoalPendingProgress } from "./daily-goal-pending";

export { getDoNotContactReasonOptions };

// Números da carteira no dia: rodadas ativas, tentativas do dia e rodadas que
// SAÍRAM da carteira no dia — encerradas (ended_at) ou CONVERTIDAS em
// atendimento (converted_at; antes só as encerradas eram vistas, e o contato
// convertido sumia do total mas continuava contando como feito: 51 de 45 =
// 106% quando o correto era 51 de 51 = 100%). Fonte única do denominador da
// meta: painel, liberação da prospecção extra e fechamento do dia.
async function loadWalletDayNumbers(brokerId, day) {
  const dayStart = new Date(`${day}T00:00:00-03:00`).toISOString();
  const dayEnd = new Date(`${day}T23:59:59.999-03:00`).toISOString();
  const [{ data: rounds, error }, { data: attemptsToday, error: attemptsError }, { data: leftToday, error: leftError }] = await Promise.all([
    db().from("daily_goal_rounds").select("id, attempt_count").eq("broker_id", brokerId).eq("status", "active"),
    db().from("daily_goal_attempts").select("round_id").eq("broker_id", brokerId).eq("goal_date", day),
    db().from("daily_goal_rounds").select("id").eq("broker_id", brokerId).neq("status", "active")
      .or(`and(ended_at.gte.${dayStart},ended_at.lte.${dayEnd}),and(converted_at.gte.${dayStart},converted_at.lte.${dayEnd})`)
  ]);
  if (error) throw error;
  if (attemptsError) throw attemptsError;
  if (leftError) throw leftError;
  const attemptRoundIds = new Set((attemptsToday || []).map((row) => row.round_id));
  return {
    rounds: rounds || [],
    attemptRoundIds,
    ...walletDayTarget({ activeCount: (rounds || []).length, leftRoundIds: (leftToday || []).map((row) => row.id), attemptRoundIds })
  };
}

// Prospecção obrigatória do dia (carteira + trabalhados que já saíram dela).
export async function getDailyGoalTarget(brokerId, day = saoPauloDate()) {
  return (await loadWalletDayNumbers(brokerId, day)).dayTarget;
}

// "Carteira ativa" = clientes aguardando 1ª+2ª+3ª tentativa combinadas
// (daily_goal_rounds com status='active'), de QUALQUER origem — Meta Diária
// ou prospecção manual (Base da Imobiliária/Minha Base), ambas gravam na
// mesma tabela. O limite é global hoje (Gestão > Meta Diária >
// Configurações), mas a arquitetura (daily_goal_wallet_broker_overrides) já
// permite um limite individual por corretor no futuro sem nova migration —
// só ainda não existe tela para editar override individual.

function db() {
  return getSupabaseAdminClient();
}

export async function getDailyGoalWalletConfig(auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("daily_goal_wallet_config").select("*").eq("id", "default").maybeSingle();
  if (error) throw error;
  return { walletLimit: data?.wallet_limit ?? 100, blockOnLimit: data?.block_on_limit ?? true };
}

export async function updateDailyGoalWalletConfig(payload, auth) {
  assertGeneralAdmin(auth);
  const walletLimit = Number(payload?.walletLimit);
  if (!Number.isInteger(walletLimit) || walletLimit <= 0 || walletLimit > 5000) {
    throw new Error("Informe um limite de carteira ativa inteiro entre 1 e 5000.");
  }
  const blockOnLimit = Boolean(payload?.blockOnLimit);
  const { error } = await db().from("daily_goal_wallet_config").update({
    wallet_limit: walletLimit,
    block_on_limit: blockOnLimit,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }).eq("id", "default");
  if (error) throw error;
  return { walletLimit, blockOnLimit };
}

// Config efetiva de UM corretor (override individual, se existir, senão o
// global) — mesma função SQL usada pelas RPCs de reivindicação, para a tela
// nunca divergir do que o banco realmente aplica.
async function getEffectiveWalletConfig(brokerId) {
  const { data, error } = await db().rpc("daily_goal_wallet_effective_config", { p_broker_id: brokerId }).maybeSingle();
  if (error) throw error;
  return { walletLimit: data?.wallet_limit ?? 100, blockOnLimit: data?.block_on_limit ?? true };
}

// Situação da carteira ativa de UM corretor: total + quebra por tentativa
// (1ª/2ª/3ª), sempre contra o limite CONFIGURADO NO MOMENTO (nunca um valor
// travado), para o indicador nunca mostrar um denominador desatualizado.
//
// A quebra por tentativa respeita a mesma regra de "só migra pra próxima
// etapa amanhã" da lista de cards (lib/daily-goal.js): uma rodada cuja
// tentativa mais recente foi registrada HOJE continua contando na etapa que
// ela ACABOU de concluir (1ª/2ª), não na próxima — senão o indicador some
// do "1ª" a cada contato feito e reaparece só como "2ª", dando a falsa
// impressão de que nenhum primeiro contato está sendo lançado quando na
// verdade eles só foram recontados na coluna seguinte.
export async function getDailyGoalWalletStatus(brokerId) {
  const today = saoPauloDate();
  const [{ walletLimit, blockOnLimit }, numbers] = await Promise.all([getEffectiveWalletConfig(brokerId), loadWalletDayNumbers(brokerId, today)]);
  const { rounds, attemptRoundIds: roundIdsWithAttemptToday, current, leftWorked: endedWorkedToday, dayTarget } = numbers;

  const byAttempt = { first: 0, second: 0, third: 0 };
  for (const round of rounds) {
    const restsInPreviousStage = round.attempt_count > 0 && roundIdsWithAttemptToday.has(round.id);
    const effectiveCount = restsInPreviousStage ? round.attempt_count - 1 : round.attempt_count;
    if (effectiveCount === 0) byAttempt.first += 1;
    else if (effectiveCount === 1) byAttempt.second += 1;
    else byAttempt.third += 1;
  }

  // dayTarget/endedWorkedToday: contatos trabalhados HOJE que já saíram da carteira
  // (ex.: "sem interesse" → Não contactar, fim da 3ª tentativa ou conversão em
  // atendimento) continuam valendo na meta do dia — senão a meta encolhe a cada
  // retorno resolvido e o percentual sobe sem trabalho novo. A liberação da
  // prospecção extra (getDailyGoalCompletionStatus) usa este mesmo total.
  return {
    current,
    limit: walletLimit,
    blockOnLimit,
    available: Math.max(walletLimit - current, 0),
    atLimit: blockOnLimit && current >= walletLimit,
    byAttempt,
    endedWorkedToday,
    dayTarget
  };
}

// A prospecção extra só pode ser iniciada depois que a META DO DIA chegou a 100%:
// o MESMO cálculo do painel (prospecção do dia + clientes pendentes congelados,
// dailyGoalOverallProgress). Antes usava outro total (cota nominal + rodadas
// carregadas, que inclui contato fechado sem tentativa do corretor) e bloqueava
// quem já estava com a meta cumprida no painel. Usa as tabelas de fatos
// (tentativas e histórico de reivindicação), nunca um contador visual.
export async function getDailyGoalCompletionStatus(brokerId) {
  const day = saoPauloDate();
  const start = new Date(`${day}T00:00:00-03:00`).toISOString();
  const end = new Date(`${day}T23:59:59.999-03:00`).toISOString();
  const [numbers, { count: attempts, error: attemptsError }, { data: claims, error: claimsError }, pending] = await Promise.all([
    loadWalletDayNumbers(brokerId, day),
    db().from("daily_goal_attempts").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("goal_date", day),
    db().from("prospecting_history").select("id, details").eq("user_id", brokerId).eq("event_type", "claimed").gte("created_at", start).lte("created_at", end),
    // Pendentes são um acréscimo à meta: se não der para calcular, vale só a prospecção.
    getDailyGoalPendingProgress(brokerId, day).catch((error) => {
      console.error("Falha ao calcular as pendências da Meta Diária.", error?.message || error);
      return null;
    })
  ]);
  if (attemptsError) throw attemptsError;
  if (claimsError) throw claimsError;
  const realClaims = (claims || []).filter((row) => row.details?.source !== "daily_goal").length;
  const progress = dailyGoalOverallProgress({
    prospectingDone: (attempts || 0) + realClaims,
    prospectingTarget: numbers.dayTarget,
    pendingDone: pending?.done,
    pendingTotal: pending?.total
  });
  return { completed: progress.done, required: progress.required, unlocked: progress.required > 0 && progress.percent >= 100 };
}

function saoPauloDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeDoNotContactReason(reasonKey, reasonText) {
  const key = DO_NOT_CONTACT_REASONS[reasonKey] ? reasonKey : "other";
  const text = String(reasonText || "").trim().slice(0, 300);
  if (key === "other" && !text) throw new Error("Descreva o motivo ao selecionar \"Outro\".");
  return { reasonKey: key, reasonText: text || DO_NOT_CONTACT_REASONS[key] };
}

// Trava anti-abuso "inteligente": não bloqueia o uso normal (um corretor
// legitimamente descartando alguns contatos ao longo do dia), só um padrão
// anormal de repetição rápida — 5 "não contactar novamente" do MESMO usuário
// em menos de 10 minutos é muito acima do ritmo humano de avaliar cada
// cliente antes de descartar, e é exatamente o padrão de quem está só
// tentando esvaziar a carteira para forçar novos contatos.
const ABUSE_WINDOW_MINUTES = 10;
const ABUSE_THRESHOLD = 5;

async function checkDoNotContactAbuse(executedBy) {
  if (!executedBy) return;
  const since = new Date(Date.now() - ABUSE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await db().from("daily_goal_do_not_contact_log")
    .select("id", { count: "exact", head: true })
    .eq("executed_by", executedBy)
    .gte("created_at", since);
  if (error) throw error;

  if ((count || 0) >= ABUSE_THRESHOLD) {
    await db().from("daily_goal_abuse_flags").insert({
      user_id: executedBy,
      action_type: "do_not_contact",
      count_detected: count,
      window_minutes: ABUSE_WINDOW_MINUTES,
      details: { threshold: ABUSE_THRESHOLD }
    });
    throw new Error(`Muitas ações de "não contactar novamente" em pouco tempo (${count} nos últimos ${ABUSE_WINDOW_MINUTES} minutos). Por segurança, essa ação foi pausada e sinalizada para a gestão. Continue normalmente em alguns minutos.`);
  }
}

// Registro de auditoria de "não contactar novamente" — chamado pela
// prospecção manual (lib/prospecting.js) sempre que essa ação é executada.
// Faz a trava anti-abuso ANTES de gravar (nunca grava a ação abusiva).
export async function recordDoNotContactAudit({ clientId, contactId, brokerId, reasonKey, reasonText, executedBy, origin }) {
  await checkDoNotContactAbuse(executedBy);
  const normalized = normalizeDoNotContactReason(reasonKey, reasonText);
  const { error } = await db().from("daily_goal_do_not_contact_log").insert({
    client_id: clientId || null,
    contact_id: contactId || null,
    broker_id: brokerId || null,
    reason_key: normalized.reasonKey,
    reason_text: normalized.reasonText,
    executed_by: executedBy || null,
    origin: origin || "prospecting"
  });
  if (error) throw error;
  return normalized;
}
