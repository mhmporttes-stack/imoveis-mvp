import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";

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
export async function getDailyGoalWalletStatus(brokerId) {
  const [{ walletLimit, blockOnLimit }, { data: rounds, error }] = await Promise.all([
    getEffectiveWalletConfig(brokerId),
    db().from("daily_goal_rounds").select("attempt_count").eq("broker_id", brokerId).eq("status", "active")
  ]);
  if (error) throw error;

  const byAttempt = { first: 0, second: 0, third: 0 };
  for (const round of rounds || []) {
    if (round.attempt_count === 0) byAttempt.first += 1;
    else if (round.attempt_count === 1) byAttempt.second += 1;
    else byAttempt.third += 1;
  }
  const current = (rounds || []).length;
  const completion = await getDailyGoalCompletionStatus(brokerId, current);

  return {
    current,
    limit: walletLimit,
    blockOnLimit,
    available: Math.max(walletLimit - current, 0),
    atLimit: blockOnLimit && current >= walletLimit,
    byAttempt,
    completedToday: completion.completed,
    requiredToday: completion.required,
    extraUnlocked: completion.unlocked
  };
}

// A prospeccao extra so pode ser iniciada depois que a carteira ativa inteira
// recebeu a obrigacao do dia. A consulta usa as tabelas de fatos (tentativas
// e historico de reivindicacao), nunca um contador visual do frontend.
export async function getDailyGoalCompletionStatus(brokerId, activeWalletCount = null) {
  const required = activeWalletCount == null
    ? await db().from("daily_goal_rounds").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("status", "active").then((result) => {
      if (result.error) throw result.error;
      return result.count || 0;
    })
    : activeWalletCount;
  const day = saoPauloDate();
  const start = new Date(`${day}T00:00:00-03:00`).toISOString();
  const end = new Date(`${day}T23:59:59.999-03:00`).toISOString();
  const [{ count: attempts, error: attemptsError }, { data: claims, error: claimsError }] = await Promise.all([
    db().from("daily_goal_attempts").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("goal_date", day),
    db().from("prospecting_history").select("id, details").eq("user_id", brokerId).eq("event_type", "claimed").gte("created_at", start).lte("created_at", end)
  ]);
  if (attemptsError) throw attemptsError;
  if (claimsError) throw claimsError;
  const realClaims = (claims || []).filter((row) => row.details?.source !== "daily_goal").length;
  const completed = (attempts || 0) + realClaims;
  return { completed, required, unlocked: required > 0 && completed >= required };
}

function saoPauloDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const DO_NOT_CONTACT_REASONS = {
  client_requested: "Cliente solicitou",
  invalid_number: "Número inválido",
  already_purchased: "Já adquiriu imóvel",
  not_interested: "Sem interesse",
  wrong_contact: "Contato incorreto",
  other: "Outro"
};

export function getDoNotContactReasonOptions() {
  return Object.entries(DO_NOT_CONTACT_REASONS).map(([key, label]) => ({ key, label }));
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
