// "Carregar mensagens anteriores do celular" — regras PURAS das rodadas (pedido do dono, 2026-10-12: até 15 dias,
// incluindo vídeos). Usado pela tela (components/WhatsappChat.jsx, PhoneHistoryButton) e pelo servidor
// (lib/whatsapp-chat.js). Testes: tests/whatsapp-older-history.test.mjs.
//
// Cada rodada pede até 50 mensagens ao celular, ancorada na mais antiga que o celular devolveu na rodada anterior.
// Para quando: a mensagem mais antiga recebida já passou de 15 dias atrás, o celular não devolveu nada (fim do
// histórico), ou bateu o limite de rodadas. Entre rodadas há uma pausa (sem rajada).

export const OLDER_HISTORY_TARGET_DAYS = 15;
export const OLDER_HISTORY_MAX_ROUNDS = 12; // 12 x 50 = até 600 mensagens por toque
export const OLDER_HISTORY_ROUND_GAP_MS = 4000;
export const OLDER_HISTORY_POLL_MS = 2500;
// Sem nenhum sinal do celular neste tempo = "o celular não respondeu".
export const OLDER_HISTORY_WAIT_MS = 45000;
// Depois do 1º lote, espera este silêncio para considerar a rodada terminada (a resposta pode vir em partes).
export const OLDER_HISTORY_SETTLE_MS = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

// Id do pedido devolvido pelo serviço (id de mensagem do WhatsApp): só letras/números.
export function isValidOlderHistoryRequestId(value) {
  return /^[A-Za-z0-9]{8,64}$/.test(String(value || ""));
}

// O celular já respondeu e o serviço está baixando fotos/vídeos: espera mais, até este teto.
export const OLDER_HISTORY_RECEIVING_MAX_MS = 4 * 60 * 1000;

// status (do serviço) -> "waiting" | "receiving" | "settled" | "timeout"
export function roundPhase(status, { waitMs = OLDER_HISTORY_WAIT_MS, settleMs = OLDER_HISTORY_SETTLE_MS, receivingMaxMs = OLDER_HISTORY_RECEIVING_MAX_MS } = {}) {
  const state = status?.state;
  if (state === "received") {
    return Number(status.quietMs) >= settleMs ? "settled" : "receiving";
  }
  if (state === "unknown") return "timeout"; // serviço reiniciou: o pedido se perdeu
  if (state === "receiving") return Number(status?.elapsedMs) >= receivingMaxMs ? "timeout" : "receiving";
  if (Number(status?.elapsedMs) >= waitMs) return "timeout";
  return "waiting";
}

// Depois de uma rodada terminada: continua ou para (e por quê).
// O celular devolveu menos do que o pedido = acabou o histórico dele nesta conversa.
export function planNextRound({ round, received, requested = 50, oldestAt, nowMs = Date.now(), targetDays = OLDER_HISTORY_TARGET_DAYS, maxRounds = OLDER_HISTORY_MAX_ROUNDS }) {
  if (!Number(received)) return { next: false, reason: "end" };
  const oldestMs = oldestAt ? new Date(oldestAt).getTime() : NaN;
  if (Number.isFinite(oldestMs) && oldestMs <= nowMs - targetDays * DAY_MS) return { next: false, reason: "target" };
  if (!Number.isFinite(oldestMs) || Number(received) < Number(requested)) return { next: false, reason: "end" };
  if (Number(round) >= maxRounds) return { next: false, reason: "max_rounds" };
  return { next: true, reason: "continue" };
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}

// Texto do estado REAL para a tela.
export function olderHistoryMessage({ phase, total = 0, oldestAt = null, waitedSeconds = 0, reason = "", round = 1 }) {
  const until = oldestAt ? ` (até ${shortDate(oldestAt)})` : "";
  const got = total === 1 ? "Chegou 1 mensagem" : `Chegaram ${total} mensagens`;
  if (phase === "sent") return round > 1 ? `${got}${until}. Pedindo mais ao celular…` : "Pedido enviado ao celular. Aguardando resposta…";
  if (phase === "receiving") return total ? `Recebendo do celular… ${got.toLowerCase()} até agora${until}.` : "Recebendo do celular…";
  if (phase === "timeout") {
    const base = `O celular não respondeu em ${waitedSeconds} s.`;
    return total
      ? `${got}${until}. ${base} Toque de novo para continuar.`
      : `${base} Confira se o celular está com internet e o WhatsApp aberto, e tente de novo.`;
  }
  if (phase === "done") {
    if (reason === "target") return `Pronto: ${got.toLowerCase()}${until}. Já cobre os últimos ${OLDER_HISTORY_TARGET_DAYS} dias.`;
    if (reason === "max_rounds") return `${got}${until}. Toque de novo para buscar mais.`;
    return total ? `Pronto: ${got.toLowerCase()}${until}. O celular não tem mensagens mais antigas desta conversa.` : "O celular não tem mensagens anteriores desta conversa.";
  }
  return "";
}
