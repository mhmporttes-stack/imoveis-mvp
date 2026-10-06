import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";
import { DO_NOT_CONTACT_REASONS, getDoNotContactReasonOptions } from "./do-not-contact-reasons";
import { addDaysToPlainDate } from "./daily-report";
import { dailyGoalOverallProgress, dayStageBreakdown, walletDayTarget } from "./daily-goal-progress.mjs";
import { getDailyGoalPendingProgress } from "./daily-goal-pending";
import { isReservationClaim } from "./prospecting-extra-core.mjs";
import { DEFAULT_WALLET_LIMIT, MAX_WALLET_LIMIT } from "./daily-goal-wallet-core.mjs";
import { memoInRequest } from "./request-memo.mjs";

export { getDoNotContactReasonOptions };

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

function isWalletFreezeTableMissing(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /42P01|PGRST205/.test(text) || (/daily_goal_wallet_freeze/.test(text) && /does not exist|could not find/i.test(text));
}

async function readWalletFreeze(brokerId, day) {
  const { data, error } = await db().from("daily_goal_wallet_freeze").select("*").eq("broker_id", brokerId).eq("goal_date", day).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Congela (uma única vez por corretor/dia) o CONJUNTO de rodadas que contam
// pra meta de hoje — regra confirmada pelo dono em 2026-10-01: a meta só
// atualiza à meia-noite, nunca durante o dia. Mesmo padrão de
// freezeDailyGoalPendingIfMissing (daily-goal-pending.js): idempotente via
// chave primária (broker_id, goal_date); contato novo que entrar na carteira
// depois do congelamento não conta na meta de hoje — só a partir de amanhã.
// Devolve null quando o recurso ainda não está disponível (migration não
// aplicada): quem chama cai de volta no comportamento antigo (carteira ativa
// ao vivo, sem congelamento), nunca quebra a tela.
async function freezeDailyGoalWalletIfMissing(brokerId, day, source = "lazy") {
  try {
    const existing = await readWalletFreeze(brokerId, day);
    if (existing) return { row: existing, created: false };

    // Precisa capturar não só quem está ativo NO INSTANTE do congelamento, mas
    // também quem já SAIU hoje antes desse instante (encerrado ou convertido) —
    // senão uma rodada que o corretor já tinha trabalhado hoje de manhã, e que
    // terminou antes do congelamento (lazy, pode rodar horas depois da geração
    // da cota), nunca entra no conjunto congelado e some da meta pro resto do
    // dia (achado real, 2026-10-01: Luan Vitor recebeu a cota cheia de 20 de
    // manhã, 6 já tinham terminado quando o congelamento rodou à tarde, e a
    // meta ficou presa em 14). Rodada nova criada DEPOIS do congelamento (o
    // caso que o congelamento existe pra evitar) continua de fora, porque não
    // existe ainda em nenhum dos dois lados desta consulta.
    const dayStart = new Date(`${day}T00:00:00-03:00`).toISOString();
    const dayEnd = new Date(`${day}T23:59:59.999-03:00`).toISOString();
    const { data: rounds, error: roundsError } = await db().from("daily_goal_rounds").select("id")
      .eq("broker_id", brokerId)
      .or(`status.eq.active,and(ended_at.gte.${dayStart},ended_at.lte.${dayEnd}),and(converted_at.gte.${dayStart},converted_at.lte.${dayEnd})`);
    if (roundsError) throw roundsError;
    const ids = (rounds || []).map((row) => row.id);

    const { data: inserted, error } = await db()
      .from("daily_goal_wallet_freeze")
      .upsert({ broker_id: brokerId, goal_date: day, round_ids: ids, round_total: ids.length, source }, { onConflict: "broker_id,goal_date", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (inserted) return { row: inserted, created: true };

    const row = await readWalletFreeze(brokerId, day);
    return row ? { row, created: false } : null;
  } catch (error) {
    if (isWalletFreezeTableMissing(error)) return null;
    throw error;
  }
}

// Cron diário (junto do congelamento das pendências, daily-goal-close): congela
// a carteira de hoje dos corretores que usam a Meta Diária. Quem ficar de fora
// é congelado no primeiro acesso do dia (plano B, mesmo padrão da pendência).
export async function freezeDailyGoalWalletForActiveBrokers({ budgetMs = 30000, lookbackDays = 14 } = {}) {
  const today = saoPauloDate();
  const { data, error } = await db().from("daily_goals").select("broker_id").gte("goal_date", addDaysToPlainDate(today, -lookbackDays));
  if (error) throw error;
  const brokerIds = [...new Set((data || []).map((row) => row.broker_id))];

  const startedAt = Date.now();
  const summary = { brokers: brokerIds.length, frozen: 0, alreadyFrozen: 0, skipped: 0, unavailable: false };
  for (const brokerId of brokerIds) {
    if (Date.now() - startedAt > budgetMs) { summary.skipped += 1; continue; }
    try {
      const result = await freezeDailyGoalWalletIfMissing(brokerId, today, "cron");
      if (!result) { summary.unavailable = true; break; }
      if (result.created) summary.frozen += 1;
      else summary.alreadyFrozen += 1;
    } catch (freezeError) {
      summary.skipped += 1;
      console.error("Falha ao congelar a carteira da Meta Diária.", freezeError?.message || freezeError);
    }
  }
  return summary;
}

// Números da carteira no dia: rodadas ativas, tentativas do dia e rodadas que
// SAÍRAM da carteira no dia — encerradas (ended_at) ou CONVERTIDAS em
// atendimento (converted_at; antes só as encerradas eram vistas, e o contato
// convertido sumia do total mas continuava contando como feito: 51 de 45 =
// 106% quando o correto era 51 de 51 = 100%). Fonte única do denominador da
// meta: painel, liberação da prospecção extra e fechamento do dia.
//
// O conjunto de rodadas consideradas é o CONGELADO no início do dia (ver
// freezeDailyGoalWalletIfMissing) — contato novo que entrar na carteira hoje
// não conta na meta de hoje, só na de amanhã; uma tentativa feita nele hoje
// ainda soma como trabalho extra (prospecção excedente), só não aparece em
// nenhuma etapa específica do card. Se o congelamento ainda não está
// disponível (migration não aplicada), cai no comportamento antigo (carteira
// ativa ao vivo, sem travar nada) — nunca quebra a tela.
// Mesmos números do dia de um corretor são pedidos por mais de um caminho na MESMA tela (carteira + pendentes):
// dentro de uma requisição com memória (lib/request-memo.js) calcula uma vez só.
function loadWalletDayNumbers(brokerId, day) {
  return memoInRequest(`wallet-day:${brokerId}:${day}`, () => loadWalletDayNumbersUncached(brokerId, day));
}

async function loadWalletDayNumbersUncached(brokerId, day) {
  const dayStart = new Date(`${day}T00:00:00-03:00`).toISOString();
  const dayEnd = new Date(`${day}T23:59:59.999-03:00`).toISOString();

  const frozen = await freezeDailyGoalWalletIfMissing(brokerId, day);
  const frozenIds = frozen ? (frozen.row.round_ids || []) : null;

  let activeQuery = db().from("daily_goal_rounds").select("id, attempt_count").eq("broker_id", brokerId).eq("status", "active");
  let leftQuery = db().from("daily_goal_rounds").select("id").eq("broker_id", brokerId).neq("status", "active")
    .or(`and(ended_at.gte.${dayStart},ended_at.lte.${dayEnd}),and(converted_at.gte.${dayStart},converted_at.lte.${dayEnd})`);
  if (frozenIds) {
    const idsOrNone = frozenIds.length ? frozenIds : [EMPTY_UUID];
    activeQuery = activeQuery.in("id", idsOrNone);
    leftQuery = leftQuery.in("id", idsOrNone);
  }

  const [{ data: rounds, error }, { data: attemptsToday, error: attemptsError }, { data: leftToday, error: leftError }] = await Promise.all([
    activeQuery,
    db().from("daily_goal_attempts").select("round_id, attempt_number").eq("broker_id", brokerId).eq("goal_date", day),
    leftQuery
  ]);
  if (error) throw error;
  if (attemptsError) throw attemptsError;
  if (leftError) throw leftError;
  const attemptRoundIds = new Set((attemptsToday || []).map((row) => row.round_id));
  const attemptByRound = new Map((attemptsToday || []).map((row) => [row.round_id, row.attempt_number]));
  const leftRoundIds = (leftToday || []).map((row) => row.id);
  return {
    rounds: rounds || [],
    attemptRoundIds,
    ...walletDayTarget({ activeCount: (rounds || []).length, leftRoundIds, attemptRoundIds }),
    // Onde a meta está por etapa (1ª/2ª/3ª): feitos e total do dia ("19 de 30").
    stages: dayStageBreakdown({ activeRounds: rounds || [], leftRoundIds, attemptByRound })
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
  return { walletLimit: data?.wallet_limit ?? DEFAULT_WALLET_LIMIT, blockOnLimit: data?.block_on_limit ?? true };
}

export async function updateDailyGoalWalletConfig(payload, auth) {
  assertGeneralAdmin(auth);
  const walletLimit = Number(payload?.walletLimit);
  // [REGRA OFICIAL — dono, 2026-10-04] a carteira ativa tem no máximo 30 por corretor: a configuração só pode reduzir.
  if (!Number.isInteger(walletLimit) || walletLimit <= 0 || walletLimit > MAX_WALLET_LIMIT) {
    throw new Error(`Informe um limite de carteira ativa inteiro entre 1 e ${MAX_WALLET_LIMIT} (a carteira tem no máximo ${MAX_WALLET_LIMIT} clientes por corretor).`);
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
function getEffectiveWalletConfig(brokerId) {
  return memoInRequest(`wallet-config:${brokerId}`, () => getEffectiveWalletConfigUncached(brokerId));
}

async function getEffectiveWalletConfigUncached(brokerId) {
  const { data, error } = await db().rpc("daily_goal_wallet_effective_config", { p_broker_id: brokerId }).maybeSingle();
  if (error) throw error;
  return { walletLimit: data?.wallet_limit ?? DEFAULT_WALLET_LIMIT, blockOnLimit: data?.block_on_limit ?? true };
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
  const { rounds, attemptRoundIds: roundIdsWithAttemptToday, current, leftWorked: endedWorkedToday, dayTarget, stages } = numbers;

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
    dayTarget,
    stages
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
  const realClaims = (claims || []).filter((row) => !isReservationClaim(row.details)).length;
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
