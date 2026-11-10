// OFERTA AO PRÓXIMO DA ROLETA (serviço reutilizável — dono, 2026-11-10). PURO, testado em tests/roulette-offer-core.test.mjs.
// Estado, envio e banco em lib/roulette-offer.js.
//
// Em vez de empurrar o cliente, o CRM PERGUNTA ao próximo da roleta
// ("tem um cliente, você é o próximo, posso transferir? responda sim ou ok"), pelo número OFICIAL ao WhatsApp do corretor (sem
// modelo da Meta: só com a janela de 24 h dele aberta; senão push + sino). "sim"/"ok" em até `timeoutSec` → transfere; sem
// resposta → oferece ao seguinte, por todos os candidatos; ninguém → o chamador decide (fluxo do anúncio: de noite, aviso ao
// cliente "a partir das 8h"; sempre, o cliente segue segurado com o dono e a WA-18 retoma).
//
// RESPOSTA TARDIA (dono, 2026-11-10): quem já passou da vez e responde sim/ok enquanto a oferta está com OUTRO recebe "deixa eu
// verificar" e fica na fila de aceite tardio (hora + posição na roleta, `late_accepts`). Vencido o prazo do corretor atual:
// ele NÃO respondeu → o tardio de menor posição leva (empate: o que respondeu antes) e os outros ouvem "não está mais
// disponível"; ele respondeu → leva o cliente e todos os tardios ouvem "não está mais disponível". Depois do fim da oferta: sem
// responsável (ninguém aceitou) → transfere a quem respondeu; já transferido → "não está mais disponível". Não há limiar de tempo.

export const OFFER_STATES = Object.freeze({ pending: "pending", accepted: "accepted", exhausted: "exhausted", cancelled: "cancelled" });
export const OFFER_KINDS = Object.freeze({ adFlow: "ad_flow", general: "general" });
export const LATE_REPLY_LOOKBACK_MS = 30 * 60 * 1000; // resposta tardia: só confere ofertas dos últimos 30 min

const AFFIRMATIVE = new Set([
  "sim", "s", "ok", "okay", "oki", "okk", "pode", "pode sim", "pode ser", "pode transferir", "pode mandar", "claro", "claro que sim", "blz", "beleza",
  "positivo", "confirmo", "confirmado", "aceito", "quero", "manda", "mande", "vai", "bora", "fechado", "combinado", "yes", "y", "simm", "sim pode", "ok pode", "ok obrigado", "ok obrigada"
]);

const normalize = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[!.,;:?]+/g, " ").replace(/\s+/g, " ").trim();

/** "sim", "ok", "pode", "👍"… (maiúsculas, acentos e pontuação não importam). Qualquer outra coisa NÃO aceita a oferta. */
export function isAffirmativeReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^(?:\u{1F44D}[\u{1F3FB}-\u{1F3FF}]?\s*)+$/u.test(raw)) return true; // só 👍 (com ou sem tom de pele)
  return AFFIRMATIVE.has(normalize(raw));
}

/** Texto da oferta ao corretor (cliente e etapa; sem dado além do necessário). */
export function buildOfferText({ clientName = "", firstContext = "" } = {}) {
  const name = String(clientName || "").trim();
  return [
    `Tem um cliente${name ? ` (${name})` : ""} esperando${firstContext ? ` — ${firstContext}` : ""} e você é o próximo da roleta.`,
    "Posso transferir para você? Responda *sim* ou *ok* em até 1 minuto."
  ].join("\n");
}

export const ACCEPTED_REPLY_TEXT = "Pronto, o cliente é seu! Abra o Chat e atenda.";
export const CHECKING_REPLY_TEXT = "Deixa eu verificar se o cliente ainda está disponível.";
export const UNAVAILABLE_REPLY_TEXT = "O cliente não está mais disponível para atendimento.";

/** Próximo candidato ainda não consultado (ordem persistida da oferta). */
export function nextOfferCandidate({ order = [], asked = [] } = {}) {
  const done = new Set(asked);
  return order.find((userId) => !done.has(userId)) || null;
}

/** A oferta venceu? (prazo da oferta ao corretor atual) */
export function isOfferExpired(offer, now = new Date()) {
  return !offer?.expires_at || now.getTime() >= new Date(offer.expires_at).getTime();
}

/** Posição do corretor na ordem da roleta desta oferta (0 = o 1º consultado); fora da ordem = Infinity. */
export function offerPosition(offer, userId) {
  const index = (offer?.candidate_order || []).indexOf(userId);
  return index < 0 ? Infinity : index;
}

/** Já passou da vez dele? (foi consultado e não é mais o atual) */
function passedTurn(offer, userId) {
  return (offer.asked_user_ids || []).includes(userId) && offer.current_user_id !== userId;
}

/** Acrescenta um aceite tardio (idempotente: o mesmo corretor não entra duas vezes). */
export function addLateAccept(lateAccepts = [], { userId, phone = "", at, position }) {
  if (lateAccepts.some((item) => item.userId === userId)) return lateAccepts;
  return [...lateAccepts, { userId, phone, at: new Date(at).toISOString(), position }];
}

/** Quem leva entre os aceites tardios: menor posição na roleta; empate pela hora da resposta. */
export function pickLateAccept(lateAccepts = []) {
  return [...lateAccepts].sort((a, b) => (a.position - b.position) || (new Date(a.at) - new Date(b.at)))[0] || null;
}

/**
 * Resposta de um corretor da equipe (`userId`) a uma mensagem sobre `offer` (a mais relevante dele).
 *  - não afirmativa → "ignore";
 *  - pendente, é a vez dele e dentro do prazo → "accept";
 *  - pendente, já passou da vez dele (ou a vez dele já venceu) → "queue" (1ª vez) | "duplicate" (já está na fila);
 *  - aceita → "duplicate" (foi ele) | "unavailable" (foi outro);
 *  - esgotada: sem responsável (`clientAvailable`) → "claim_after_end"; senão "unavailable"; cancelada → "unavailable".
 */
export function decideOfferReply({ offer = null, userId = "", text = "", now = new Date(), clientAvailable = false } = {}) {
  if (!offer || !isAffirmativeReply(text)) return { action: "ignore" };
  if (offer.state === OFFER_STATES.accepted) return { action: offer.accepted_by === userId ? "duplicate" : "unavailable" };
  if (offer.state === OFFER_STATES.exhausted) {
    if ((offer.late_accepts || []).some((item) => item.userId === userId)) return { action: "duplicate" };
    return { action: clientAvailable ? "claim_after_end" : "unavailable" };
  }
  if (offer.state !== OFFER_STATES.pending) return { action: "unavailable" };
  if (offer.current_user_id === userId && !isOfferExpired(offer, now)) return { action: "accept" };
  const mineExpired = offer.current_user_id === userId; // venceu o prazo dele e o cron ainda não passou a vez
  if (mineExpired || passedTurn(offer, userId)) {
    return (offer.late_accepts || []).some((item) => item.userId === userId) ? { action: "duplicate" } : { action: "queue", position: offerPosition(offer, userId) };
  }
  return { action: "ignore" }; // ainda não foi consultado: nem sabe da oferta
}

/**
 * Rodada do cron sobre uma oferta pendente: vencida → (há aceite tardio? leva ele) senão próximo candidato ou esgotada.
 * `late_winner` traz `losers` (os demais tardios, para "não está mais disponível").
 */
export function decideOfferExpiry({ offer = null, now = new Date() } = {}) {
  if (!offer || offer.state !== OFFER_STATES.pending || !isOfferExpired(offer, now)) return { action: "none" };
  const asked = [...new Set([...(offer.asked_user_ids || []), offer.current_user_id].filter(Boolean))];
  const lates = offer.late_accepts || [];
  const winner = pickLateAccept(lates);
  if (winner) return { action: "late_winner", winner, losers: lates.filter((item) => item.userId !== winner.userId), asked };
  const next = nextOfferCandidate({ order: offer.candidate_order || [], asked });
  return next ? { action: "next", userId: next, asked } : { action: "exhausted", asked };
}

/** Quem ouve "não está mais disponível" quando `winnerId` leva a oferta. */
export function lateLosers(offer, winnerId) {
  return (offer?.late_accepts || []).filter((item) => item.userId !== winnerId);
}

export function offerExpiresAt(now, timeoutSec) {
  return new Date(now.getTime() + timeoutSec * 1000).toISOString();
}
