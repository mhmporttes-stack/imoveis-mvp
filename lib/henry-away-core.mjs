// "Enquanto você estava fora…" no bom dia do Henry + aprovação por voz do acumulado do Marketplace (HENRY-1 / MKT-2m).
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26] "Não quero que ele diga de onde vieram os clientes; ele soma todos os novos
// clientes de sábado às 13:00 até segunda às 8:00." + "Dos 10, 8 eu já iniciei o atendimento e transferi para seus
// associados; 2 clientes eu estou aguardando sua aprovação para atender." Regras PURAS (sem banco, sem env); leitura em
// lib/henry-morning.js (clientes novos = a mesma contagem do Início, `simulation_registrations.created_at`, sem origem) e
// aprovação em lib/henry-marketplace-approval.js.
import { saoPauloDateKey, saoPauloNow } from "./alexa-config-core.mjs";
import { contagem } from "./pt-br-concordancia.mjs";
import { normalizeSpeechText } from "./henry-voice-core.mjs";

// Janela do fim de semana (São Paulo): sábado 13:00 (inclusive) até segunda 08:00 (exclusive). Só no bom dia de SEGUNDA:
// nos outros dias não há "expediente anterior" óbvio definido pelo dono → sem a frase.
export const HENRY_AWAY_START_MINUTES = 13 * 60;
export const HENRY_AWAY_END_MINUTES = 8 * 60;
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
  if (saoPauloNow(now).weekday !== 1) return null;
  const monday = saoPauloDateKey(now);
  return { startIso: saoPauloWallToIso(addDaysKey(monday, -2), HENRY_AWAY_START_MINUTES), endIso: saoPauloWallToIso(monday, HENRY_AWAY_END_MINUTES) };
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

// "Enquanto você estava fora entraram 10 clientes novos; 8 já estão em atendimento com a equipe e 2 estão aguardando sua
// aprovação para atender." Sem origem (dono). Partes com zero ficam de fora. Nada entrou → "".
export function buildHenryAwaySentence(summary = null) {
  const total = Number(summary?.total) || 0;
  if (total <= 0) return "";
  const head = `Enquanto você estava fora ${verb(total, "entrou", "entraram")} ${contagem(total, "cliente novo", "clientes novos")}`;
  const parts = [];
  const n = (value) => Number(value) || 0;
  if (n(summary.withTeam)) parts.push(`${n(summary.withTeam) === 1 ? "um" : n(summary.withTeam)} já ${verb(n(summary.withTeam), "está", "estão")} em atendimento com a equipe`);
  if (n(summary.inQueue)) parts.push(`${n(summary.inQueue) === 1 ? "um" : n(summary.inQueue)} ${verb(n(summary.inQueue), "está", "estão")} na fila da roleta`);
  if (n(summary.withOwner)) parts.push(`${n(summary.withOwner) === 1 ? "um" : n(summary.withOwner)} ${verb(n(summary.withOwner), "ficou", "ficaram")} com você`);
  if (n(summary.awaitingApproval)) parts.push(`${n(summary.awaitingApproval) === 1 ? "um" : n(summary.awaitingApproval)} ${verb(n(summary.awaitingApproval), "está", "estão")} aguardando sua aprovação para atender`);
  const sentence = parts.length ? `${head}; ${joinPt(parts)}.` : `${head}.`;
  return n(summary.awaitingApproval) ? `${sentence} É só dizer "pode atender" que eu libero.` : sentence;
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
