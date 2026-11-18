// Card/aba "Novos atendimentos" — parte pura (testável). REGRA OFICIAL — dono, 2026-11-18: "Mesmo que seja feito por
// automação, é um novo cliente, ele acabou de preencher o cadastro, então tem que ficar em aba de novos clientes, no topo."
// A leitura no banco fica em getUnattendedClientIds/getUnattendedClientEntries (lib/simulation-list-query.js).
//
// Três origens, uma só régua de atendimento humano (listClientIdsWithHumanAttendance, lib/whatsapp-attendance.js):
//  1. Atendimento automático nunca atendido (regra antiga, sem janela de tempo).
//  2. Cadastro RECÉM-PREENCHIDO que a automação já avançou: "Aguardando simulação" (pending) ou "Simulação automática"
//     (auto_simulation) — criado há no máximo NEW_CLIENT_WINDOW_DAYS dias, sem atendimento humano desde sempre
//     (o que vier primeiro: o primeiro atendimento humano ou o fim da janela).
//  3. Transferido ainda não atendido por quem recebeu (CLI-7b, lib/transferred-awaiting-core.mjs) — inalterado.
import { CLIENT_STATUS } from "./client-status.js";

export const NEW_CLIENT_WINDOW_DAYS = 7;
export const NEW_CLIENT_WINDOW_MS = NEW_CLIENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Estados que SÓ a automação coloca num cadastro recém-criado. Cadastro manual do corretor nasce já em atendimento.
export const RECENT_NEW_CLIENT_STATUSES = Object.freeze([CLIENT_STATUS.PENDING, CLIENT_STATUS.AUTO_SIMULATION]);

function time(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

// Trocou de responsável depois do cadastro: deixa de ser "cadastro novo" e segue a regra do transferido (CLI-7b).
export function wasTransferredToCurrentResponsible(client) {
  return Boolean(client?.previous_responsible_user_id && client.responsible_changed_at
    && client.previous_responsible_user_id !== client.responsible_user_id);
}

export function isRecentNewClientCandidate(client, now = Date.now()) {
  if (!client?.id || client.private_contact_at) return false;
  if (!RECENT_NEW_CLIENT_STATUSES.includes(client.status)) return false;
  const created = time(client.created_at);
  if (!created || now - created > NEW_CLIENT_WINDOW_MS) return false;
  return !wasTransferredToCurrentResponsible(client);
}

// Instante usado na ordenação: transferido = data da troca de responsável; novo = data do cadastro/novo envio do formulário.
export function newClientSortAt(client, { transferred = false } = {}) {
  return transferred && client.responsible_changed_at
    ? client.responsible_changed_at
    : (client.list_order_at || client.last_form_submitted_at || client.created_at || null);
}

// Mais recentes no topo; empate estável por id desc (mesma ordem da lista).
export function compareNewClientEntries(a, b) {
  return (time(b.sortAt) - time(a.sortAt)) || String(b.id).localeCompare(String(a.id));
}

// automatedClients: Atendimento automático (já filtrado por escopo/private_contact_at); recentClients: candidatos de
// isRecentNewClientCandidate; transferredClients: isTransferredCandidate. attendedEver: ids com atendimento humano
// em qualquer momento; attendedSinceReceipt: ids dos transferidos atendidos desde o recebimento.
export function buildUnattendedEntries({ automatedClients = [], recentClients = [], transferredClients = [], attendedEver = new Set(), attendedSinceReceipt = new Set(), now = Date.now() } = {}) {
  const entries = new Map();
  const add = (client, kind, transferred = false) => {
    if (!entries.has(client.id)) entries.set(client.id, { id: client.id, kind, status: client.status || null, sortAt: newClientSortAt(client, { transferred }) });
  };
  for (const client of transferredClients) if (!attendedSinceReceipt.has(client.id)) add(client, "transferred", true);
  for (const client of automatedClients) if (!attendedEver.has(client.id)) add(client, "new");
  for (const client of recentClients) if (isRecentNewClientCandidate(client, now) && !attendedEver.has(client.id)) add(client, "recent");
  return [...entries.values()].sort(compareNewClientEntries);
}
