// "Enquanto você estava fora…" no bom dia do Henry + aprovação por voz do acumulado do Marketplace (HENRY-1 / MKT-2m).
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26] "Não quero que ele diga de onde vieram os clientes; ele soma todos os novos
// clientes de sábado às 13:00 até segunda às 8:00." + "Dos 10, 8 eu já iniciei o atendimento e transferi para seus
// associados; 2 clientes eu estou aguardando sua aprovação para atender." Regras PURAS (sem banco, sem env); leitura em
// lib/henry-morning.js (clientes novos = a mesma contagem do Início, `simulation_registrations.created_at`, sem origem) e
// aprovação em lib/henry-marketplace-approval.js.
import { saoPauloDateKey, saoPauloNow } from "./alexa-config-core.mjs";
import { contagem } from "./pt-br-concordancia.mjs";
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { CLOSE_HOUR, OPEN_HOUR } from "./whatsapp-after-hours-core.mjs";

// Janela "fora do expediente" (São Paulo; dono, 2026-10-26: "Ele fala todo dia, porém de segunda ele busca desde sábado."):
// - terça a sábado: dia anterior 19:00 → hora do bom dia (play) (expediente seg–sáb 8h–19h, o mesmo da WA-31 — OPEN_HOUR/CLOSE_HOUR);
// - segunda: sábado 13:00 → hora do bom dia (play) (domingo inteiro incluído; sábado 13:00 = fala do dono);
// - domingo: sábado 13:00 → agora.
// Início inclusive, fim exclusive.
export const HENRY_AWAY_SATURDAY_START_MINUTES = 13 * 60;
export const HENRY_AWAY_CLOSE_MINUTES = CLOSE_HOUR * 60;
export const HENRY_AWAY_END_MINUTES = OPEN_HOUR * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function addDaysKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Hora de parede de São Paulo (dia + minutos) → instante UTC (ISO). Usa o fuso real (Intl), sem número de horas fixo.
export function saoPauloWallToIso(dateKey, minutes) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day) + minutes * 60000;
  const wall = saoPauloNow(new Date(guess));
  const wallKey = saoPauloDateKey(new Date(guess));
  const dayShift = wallKey === dateKey ? 0 : wallKey < dateKey ? -1 : 1;
  const offset = dayShift * DAY_MS + (wall.minutes - minutes) * 60000; // quanto SP está "à frente" do palpite
  return new Date(guess - offset).toISOString();
}

export function henryAwayWindow(now = new Date()) {
  const { weekday } = saoPauloNow(now);
  const today = saoPauloDateKey(now);
  if (weekday === 0) return { startIso: saoPauloWallToIso(addDaysKey(today, -1), HENRY_AWAY_SATURDAY_START_MINUTES), endIso: new Date(now).toISOString() };
  // Fim = a hora do bom dia (dono, 2026-10-26: "ele tem que contar até a hora que eu der play no bom dia").
  const endIso = new Date(now).toISOString();
  if (weekday === 1) return { startIso: saoPauloWallToIso(addDaysKey(today, -2), HENRY_AWAY_SATURDAY_START_MINUTES), endIso };
  return { startIso: saoPauloWallToIso(addDaysKey(today, -1), HENRY_AWAY_CLOSE_MINUTES), endIso };
}

export function isInHenryAwayWindow(iso, window) {
  if (!window || !iso) return false;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) && at >= new Date(window.startIso).getTime() && at < new Date(window.endIso).getTime();
}

// clients = cadastros novos da janela ({ responsible_user_id, pending_distribution_at }); awaiting = conversas do
// Marketplace aguardando a aprovação do dono (ainda não viraram cliente). Com a equipe = responsável que não é o dono e fora
// da fila de espera da roleta.
export function summarizeHenryAway({ clients = [], awaiting = [], ownerId = "" } = {}) {
  let withTeam = 0;
  let inQueue = 0;
  let withOwner = 0;
  for (const client of clients || []) {
    if (client?.pending_distribution_at) inQueue += 1;
    else if (client?.responsible_user_id && client.responsible_user_id !== ownerId) withTeam += 1;
    else withOwner += 1;
  }
  const awaitingApproval = (awaiting || []).length;
  return { total: (clients || []).length + awaitingApproval, withTeam, inQueue, withOwner, awaitingApproval };
}

const verb = (n, one, many) => (n === 1 ? one : many);
function joinPt(parts) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// Frase definida pelo dono (2026-10-26, palavras dele, variando só a concordância): "Enquanto você estava fora entraram N
// clientes novos. X eu já iniciei o atendimento e depois transferi para seus associados, e Y estão aguardando sua aprovação
// para atender." "associados" é a palavra escolhida pelo dono para a equipe que recebeu (mesmo quando foram corretores).
// X = com a equipe (withTeam); Y = aguardando aprovação. X = 0 ou Y = 0 → a parte some; 1 → "1 cliente novo", "1 está".
// Sem origem (dono). Na fila da roleta e com o dono contam só no total. Nada entrou → "".
export function buildHenryAwaySentence(summary = null) {
  const n = (value) => Math.max(0, Number(value) || 0);
  const total = n(summary?.total);
  if (total <= 0) return "";
  const head = `Enquanto você estava fora ${verb(total, "entrou", "entraram")} ${total} ${verb(total, "cliente novo", "clientes novos")}.`;
  const started = n(summary.withTeam);
  const awaiting = n(summary.awaitingApproval);
  const startedText = started ? `${started} eu já iniciei o atendimento e depois transferi para seus associados` : "";
  const awaitingText = awaiting ? `${awaiting} ${verb(awaiting, "está", "estão")} aguardando sua aprovação para atender` : "";
  const tail = startedText && awaitingText ? `${startedText}, e ${awaitingText}.` : startedText || awaitingText ? `${startedText || awaitingText}.` : "";
  return tail ? `${head} ${tail}` : head;
}

// --- Aprovação por voz (3ª escrita do Henry, dono 2026-10-26) ------------------------------------------------------------
// "pode atender", "aprova", "libera (o atendimento / os clientes / do Marketplace)". Só uma DICA para o modelo chamar a
// ferramenta; a ferramenta só age sobre conversas que estão aguardando aprovação.
const APPROVAL = /\b(pode (atender|liberar|aprovar)|aprov\w*|liber\w*)\b/;
const APPROVAL_CONTEXT = /\b(atend\w*|client\w*|marketplace|conversa\w*|tod[oa]s?|el[ea]s?|pode|isso|aprovacao)\b/;
export function isMarketplaceApprovalCommand(text) {
  const plain = normalizeSpeechText(text);
  if (!plain || plain.split(/\s+/).length > 14) return false;
  if (/\b(nao|depois|espera|ainda nao)\b/.test(plain)) return false;
  return APPROVAL.test(plain) && (APPROVAL_CONTEXT.test(plain) || plain.split(/\s+/).length <= 2);
}

// Quais aprovar: sem nome = todas; com nome = as que têm esse primeiro nome (ou nome completo).
export function pickAwaitingForApproval(rows = [], name = "") {
  const wanted = normalizeSpeechText(name).replace(/\b(o|a|os|as|do|da|cliente|clientes)\b/g, " ").replace(/\s+/g, " ").trim();
  const list = (rows || []).filter((row) => row?.id);
  if (!wanted || /^(tod[oa]s?|eles|elas|geral)$/.test(wanted)) return list;
  return list.filter((row) => {
    const full = normalizeSpeechText(row.contact_name || "");
    return full === wanted || full.split(/\s+/)[0] === wanted.split(/\s+/)[0];
  });
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Fala depois de aprovar. results = approveAwaitingMarketplaceConversations (lib/marketplace-chat.js).
export function buildHenryApprovalReply(results = [], { training = false, none = false } = {}) {
  if (none) return "Não tem cliente aguardando sua aprovação agora.";
  const list = results || [];
  if (training) return `Modo treino: nada foi liberado de verdade. Eu liberaria ${contagem(list.length, "cliente", "clientes")}.`;
  const approved = list.filter((item) => item.approved);
  if (!approved.length) return "Esses clientes já tinham sido liberados.";
  const toBrokers = approved.filter((item) => item.brokerName);
  const queued = approved.length - toBrokers.length;
  const parts = [];
  if (toBrokers.length && toBrokers.length <= 3) parts.push(toBrokers.map((item) => `${firstName(item.contactName) || "o cliente"} foi para ${firstName(item.brokerName)}`).join(", "));
  else if (toBrokers.length) parts.push(`${toBrokers.length} já foram para os corretores`);
  if (queued) parts.push(`${queued === 1 ? "um entrou" : `${queued} entraram`} na fila da roleta`);
  return `Pronto, liberei ${contagem(approved.length, "cliente", "clientes")}: ${joinPt(parts)}.`;
}

export function buildHenryApprovalDetail(results = [], { training = false } = {}) {
  const list = results || [];
  if (!list.length) return null;
  return {
    title: training ? "Aprovação (modo treino — nada foi liberado)" : "Atendimentos liberados",
    subtitle: "Chat Marketplace",
    sections: [{ title: "Clientes", rows: list.map((item) => ({ label: item.contactName || "Cliente", value: training ? "simulado" : !item.approved ? "já estava liberado" : item.brokerName ? `com ${item.brokerName}` : "na fila da roleta" })) }]
  };
}
