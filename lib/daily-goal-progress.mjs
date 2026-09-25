import { ACTIVE_CLIENT_STATUS_VALUES, CLIENT_STATUS, isClientAwaitingAction, normalizeClientStatus } from "./client-status.js";

// Bater a meta é 100%; cada contato além dela soma +1 ponto percentual.
export function dailyGoalPercent(done, target) {
  if (target <= 0) return 0;
  if (done >= target) return 100 + Math.floor(done - target);
  return Math.min(99, Math.round((Math.max(0, done) / target) * 100));
}

// [REGRA OFICIAL 2026-09-25] A meta do dia tem DUAS obrigações: a prospecção
// (carteira ativa do dia) e os clientes pendentes congelados no início do dia.
// Os 100% = prospecção + pendentes. Depois dos 100%, só prospecção EXCEDENTE
// aumenta o percentual (+1 ponto cada); pendência nunca gera percentual extra.
// Cada obrigação conta até o próprio teto: fazer muita prospecção não "paga"
// pendente não trabalhado (senão a pendência viraria opcional). Sem pendentes,
// o resultado é idêntico ao dailyGoalPercent(prospectingDone, prospectingTarget).
export function dailyGoalOverallProgress({ prospectingDone = 0, prospectingTarget = 0, pendingDone = 0, pendingTotal = 0 } = {}) {
  const pTarget = Math.max(0, Math.floor(Number(prospectingTarget) || 0));
  const pDone = Math.max(0, Math.floor(Number(prospectingDone) || 0));
  const qTotal = Math.max(0, Math.floor(Number(pendingTotal) || 0));
  const qDone = Math.min(Math.max(0, Math.floor(Number(pendingDone) || 0)), qTotal);

  const required = pTarget + qTotal;
  const counted = Math.min(pDone, pTarget) + qDone;
  const percent = required <= 0 ? 0 : counted >= required ? 100 + Math.max(0, pDone - pTarget) : Math.min(99, Math.round((counted / required) * 100));

  return {
    required,
    done: counted + (counted >= required ? Math.max(0, pDone - pTarget) : 0),
    percent,
    prospecting: { done: pDone, target: pTarget, completed: pTarget > 0 && pDone >= pTarget },
    pending: { done: qDone, total: qTotal, remaining: qTotal - qDone, completed: qTotal > 0 && qDone >= qTotal }
  };
}

// Um cliente entra nas pendências do dia quando, NO INÍCIO do dia (asOfMs),
// é um cliente ativo (mesmo conjunto de "em andamento" do CRM) e cumpre a
// regra já usada em Clientes > "Pendentes" (isClientAwaitingAction): não
// arquivado / "não contactar", sem atividade futura agendada e sem contato há
// mais de 3 dias. `latestActivityAt` = a atividade pendente mais distante
// (legada ou do calendário): há atividade futura se ela é depois de asOfMs.
// Quem completa 3 dias ao longo do dia fica de fora — entra só amanhã.
export function isDailyGoalPendingCandidate(client, asOfMs) {
  if (!client) return false;
  const status = normalizeClientStatus(client.status);
  if (!ACTIVE_CLIENT_STATUS_VALUES.has(status)) return false;
  return isClientAwaitingAction(
    {
      status,
      scheduledActivityAt: client.latestActivityAt || null,
      lastWhatsappContactAt: client.lastWhatsappContactAt || null,
      createdAt: client.createdAt || null
    },
    asOfMs
  );
}

function timeOf(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : null;
}

// Situação ATUAL das pendências congeladas de um corretor. `frozenIds` é a
// lista congelada no início do dia (nunca muda); `clientsById` traz o estado
// de hoje de cada uma. Resolvida (conta 1 atividade) = deixou de ser pendente
// por uma saída válida: contato registrado desde o início do dia, atividade
// futura agendada ou arquivado/"não contactar". Sai da conta (nem exigida nem
// concluída) quem já não é mais do corretor (repassado/excluído) ou quem já
// recebeu tentativa da Meta Diária hoje — essa ação já vale como prospecção e
// não pode contar duas vezes.
export function evaluateDailyGoalPending({ brokerId, frozenIds = [], clientsById = new Map(), dayStartMs, nowMs, attemptClientIds = new Set() }) {
  let total = 0;
  let done = 0;
  const remainingIds = [];
  for (const id of frozenIds) {
    const client = clientsById.get(id);
    if (!client || client.responsibleUserId !== brokerId || attemptClientIds.has(id)) continue;
    total += 1;

    const status = normalizeClientStatus(client.status);
    const archived = status === CLIENT_STATUS.ARCHIVED || status === CLIENT_STATUS.DO_NOT_CONTACT;
    const contactedSinceStart = (timeOf(client.lastWhatsappContactAt) ?? -Infinity) >= dayStartMs;
    const hasFutureActivity = (timeOf(client.latestActivityAt) ?? -Infinity) >= nowMs;
    if (archived || contactedSinceStart || hasFutureActivity) done += 1;
    else remainingIds.push(id);
  }
  return { total, done, remaining: total - done, remainingIds };
}

// Prospecção do dia = carteira ativa agora + contatos TRABALHADOS hoje que já
// saíram dela (encerrados — "não contactar", fim da 3ª tentativa — ou
// CONVERTIDOS em atendimento). Rodada que saiu da carteira sem tentativa do
// corretor no dia (fechada por outro caminho) não é obrigação dele e não conta.
// É o denominador único da meta: painel, liberação da prospecção extra e
// fechamento do dia usam esta mesma conta.
export function walletDayTarget({ activeCount = 0, leftRoundIds = [], attemptRoundIds = new Set() } = {}) {
  const leftWorked = leftRoundIds.filter((id) => attemptRoundIds.has(id)).length;
  return { current: activeCount, leftWorked, dayTarget: activeCount + leftWorked };
}

// Onde a meta de prospecção do dia está: por etapa (1ª/2ª/3ª tentativa), quantos
// contatos já foram feitos e quantos compõem a meta ("19 de 30"). Cada rodada do
// dia (ativa agora ou trabalhada hoje e já fora da carteira) pertence à etapa da
// tentativa que fez hoje; a que ainda não foi feita pertence à próxima etapa
// (attempt_count + 1). A soma dos totais é o mesmo dayTarget de walletDayTarget.
export function dayStageBreakdown({ activeRounds = [], leftRoundIds = [], attemptByRound = new Map() } = {}) {
  const stages = { first: { done: 0, total: 0 }, second: { done: 0, total: 0 }, third: { done: 0, total: 0 } };
  const keyOf = (number) => (number <= 1 ? "first" : number === 2 ? "second" : "third");
  const add = (number, attempted) => {
    const stage = stages[keyOf(number)];
    stage.total += 1;
    if (attempted) stage.done += 1;
  };
  for (const round of activeRounds) {
    const attemptNumber = attemptByRound.get(round.id);
    add(attemptNumber || Math.min(3, (Number(round.attempt_count) || 0) + 1), Boolean(attemptNumber));
  }
  for (const id of leftRoundIds) {
    const attemptNumber = attemptByRound.get(id);
    if (attemptNumber) add(attemptNumber, true);
  }
  return stages;
}
