// MODO LISTA IMPRESSA — WhatsApp desconectado que NÃO é banimento nem restrição (PRO-15) — regras PURAS, testadas em
// tests/whatsapp-manual-disconnect.test.mjs. Leitura do banco em lib/whatsapp-manual-disconnect.js; barreira das APIs do
// Chat em lib/admin-auth.js (requireAdminApi); páginas do Chat em app/admin/chat e app/chat-app.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-15] Corretor/associado cujo WhatsApp foi desconectado (botão Desconectar do
// CRM, saiu pelo celular/logout 401 ou qualquer outra queda que NÃO seja banimento/recusa 403 nem restrição informada/
// validada) perde o Chat (menu, página e APIs) e a Prospecção pelo CRM e passa ao "modo lista impressa": a lista é gerada
// pela gestão (fluxo "Imprimir lista" de sempre). Nada é apagado: as conversas voltam ao reconectar.
// Fora da regra: número banido/recusado (403 — PRO-11/12/13/14 seguem como hoje), restrição aberta (informada ou
// validada), quem NUNCA conectou ("Aguardando WhatsApp", tratado como antes), estados transitórios de reconexão
// automática, administrador geral e — [PENDENTE DE VALIDAÇÃO] — gestor.
// Não reimplementa PRO-11: a Prospecção pelo CRM continua barrada por lib/prospecting-eligibility*; aqui só se decide
// QUAL aviso o corretor vê e se o Chat some.

export const PRINTED_LIST_MODE_CODE = "WHATSAPP_PRINTED_LIST_MODE";
export const PRINTED_LIST_MODE_LABEL = "Modo lista impressa";
export const PRINTED_LIST_MODE_MESSAGE = "Seu WhatsApp está desconectado: você está no modo lista impressa — peça sua lista à gestão.";
export const PRINTED_LIST_CHAT_MESSAGE = "Seu WhatsApp está desconectado: o Chat fica indisponível no modo lista impressa. Conecte seu WhatsApp para voltar a usar o Chat — suas conversas estão guardadas.";

export const DISCONNECT_KIND = Object.freeze({
  CONNECTED: "connected",
  TRANSIENT: "transient", // reconexão automática em andamento: volta sozinha
  NEVER_CONNECTED: "never_connected",
  BANNED: "banned", // 403 / needs_attention:forbidden depois da última conexão
  RESTRICTED: "restricted", // restrição aberta (informada ou validada)
  MANUAL: "manual" // qualquer outra desconexão de quem já esteve conectado -> modo lista impressa
});

// "reconnecting"/"connecting"/"stored" voltam sozinhos (mesmo critério de lib/client-card-whatsapp-core.mjs).
const TRANSIENT_STATUSES = new Set(["reconnecting", "connecting", "stored"]);

const msOf = (value) => {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : NaN;
};

// A regra vale para o perfil EFETIVO de corretor/associado; administrador geral nunca; gestor fica de fora (PENDENTE).
export function printedListModeAppliesTo({ role = "", isGeneralAdmin = false } = {}) {
  return !isGeneralAdmin && (role === "broker" || role === "associate");
}

// Linha de whatsapp_individual_sessions recusada pelo WhatsApp (403) DEPOIS da última conexão. O código fica gravado
// para sempre em last_disconnect_code, por isso um 403 antigo (anterior a uma reconexão) não conta.
export function isForbiddenSessionRow(row) {
  if (!row) return false;
  if (String(row.last_error || "").toLowerCase().startsWith("needs_attention:forbidden")) return true;
  if (Number(row.last_disconnect_code) !== 403) return false;
  const disconnectMs = msOf(row.last_disconnect_at);
  const connectedMs = msOf(row.last_connected_at);
  if (!Number.isFinite(connectedMs)) return true;
  return Number.isFinite(disconnectMs) && disconnectMs >= connectedMs;
}

const isOpenRestriction = (restriction) => Boolean(restriction) && !restriction.ended_at;

// rows = linhas de whatsapp_individual_sessions do usuário (Número 1 e 2); openRestriction = linha aberta de
// whatsapp_restrictions (ou null). -> um de DISCONNECT_KIND.
export function classifyWhatsappDisconnect({ rows = [], openRestriction = null } = {}) {
  const list = (rows || []).filter(Boolean);
  if (list.some((row) => row.status === "connected")) return DISCONNECT_KIND.CONNECTED;
  if (list.some(isForbiddenSessionRow)) return DISCONNECT_KIND.BANNED;
  if (isOpenRestriction(openRestriction)) return DISCONNECT_KIND.RESTRICTED;
  if (!list.some((row) => Number.isFinite(msOf(row.last_connected_at)))) return DISCONNECT_KIND.NEVER_CONNECTED;
  if (list.some((row) => TRANSIENT_STATUSES.has(row.status))) return DISCONNECT_KIND.TRANSIENT;
  return DISCONNECT_KIND.MANUAL;
}

export function isPrintedListMode({ role = "", isGeneralAdmin = false, rows = [], openRestriction = null } = {}) {
  if (!printedListModeAppliesTo({ role, isGeneralAdmin })) return false;
  return classifyWhatsappDisconnect({ rows, openRestriction }) === DISCONNECT_KIND.MANUAL;
}

// APIs do Chat do corretor que o modo lista impressa recusa no servidor (leitura e envio).
const CHAT_API_PATTERNS = [/^\/api\/admin\/whatsapp-chat(\/|$)/, /^\/api\/admin\/client-documents\/from-chat(\/|$)/];

export function isPrintedListProtectedPath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  return CHAT_API_PATTERNS.some((pattern) => pattern.test(path));
}
