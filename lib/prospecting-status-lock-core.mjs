// Trava de status da Prospecção (pedido do dono, 2026-10-02) — regras PURAS,
// testadas em tests/prospecting-status-lock-core.test.mjs. A leitura do banco
// fica em lib/prospecting-status-lock.js.
//
// Cliente em "Tentando contato" que entrou na cadência de DISPARO automático
// (1ª tentativa pela fila extra/"Disparar" ou qualquer tentativa enviada pela
// automação da Meta Diária) não pode ser avançado à mão enquanto não houver
// RESPOSTA REAL do cliente. "Resposta real" não é definida aqui: é a mesma
// fonte de verdade da automação de resposta (lib/prospecting-reply.js) — a
// pendência "Cliente respondeu" (prospecting_reply_alerts, kind 'reply') ou a
// rodada encerrada como 'converted' por essa automação. Mensagem do corretor,
// envio automático, entregue/lido, reação ou mudança manual de status nunca
// liberam (nenhum deles gera essas marcas).

export const PROSPECTING_STATUS_LOCK_MESSAGE = "Aguardando resposta do cliente para avançar o atendimento.";

// Só rodadas criadas a partir daqui: antes, respostas de conversas @lid não
// chegavam ao CRM (incidente de 2026-10-02) e não há como saber se o cliente
// respondeu — a trava nunca é aplicada às cegas em rodada antiga.
export const STATUS_LOCK_SINCE = "2026-10-02T09:00:00Z";

const AWAITING_RETURN = "awaiting_return";

// Destinos que NÃO são avanço: continuar em prospecção, "Não contactar"
// (ação legítima preservada) e arquivar.
export const STATUS_LOCK_ALLOWED_TARGETS = new Set([AWAITING_RETURN, "do_not_contact", "archived"]);

// round: a rodada mais recente do cliente { status, created_at }.
// automatedOutreach: a rodada tem tentativa enviada pela automação
// (daily_goal_attempts.origin = 'auto') ou item da fila extra.
// replied: há pendência "Cliente respondeu" desde o início da rodada.
export function decideProspectingStatusLock({ clientStatus, round, automatedOutreach = false, replied = false, since = STATUS_LOCK_SINCE }) {
  if (clientStatus !== AWAITING_RETURN) return false;
  if (!round || !automatedOutreach || replied) return false;
  if (round.status === "converted") return false;
  const createdMs = new Date(round.created_at || "").getTime();
  if (Number.isNaN(createdMs) || createdMs < new Date(since).getTime()) return false;
  return true;
}

// Decisão da gestora/dono num caso de cliente frio (FUN-15, `decideCooledCase`): os status negativos são o desfecho do
// caso, não um avanço de atendimento — a trava não vale para eles (pedido do dono, 2026-10-24: a gestora recebia erro ao
// escolher Restrição/Reprovado/Comprometimento de renda). Arquivado/Não contactar já são livres para todos.
export const COOLED_DECISION_STATUS_SOURCE = "cooled_client_decision";
export const COOLED_DECISION_EXEMPT_TARGETS = new Set(["restriction", "rejected", "income_commitment"]);

export function isStatusAdvance({ currentStatus, nextStatus, statusSource = "" }) {
  if (currentStatus !== AWAITING_RETURN) return false;
  if (!nextStatus || nextStatus === currentStatus) return false;
  if (statusSource === COOLED_DECISION_STATUS_SOURCE && COOLED_DECISION_EXEMPT_TARGETS.has(nextStatus)) return false;
  return !STATUS_LOCK_ALLOWED_TARGETS.has(nextStatus);
}
