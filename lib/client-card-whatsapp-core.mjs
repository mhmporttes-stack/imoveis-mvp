// Botão "WhatsApp" do card do cliente — decisão PURA (testada em
// tests/client-card-whatsapp-decision.test.mjs). REGRA OFICIAL (dono, 2026-10-02):
// o destino NUNCA depende do aparelho. ATUALIZADO em 2026-10-09 (dono): o botão abre SEMPRE o Chat do CRM (o atendimento
// segue pelo número oficial quando o WhatsApp pessoal está desconectado ou restrito). Só sai do CRM (WhatsApp Web/app)
// quando o Chat inteiro está desligado pelo dono (chatDisabled). Abrir fora NÃO conecta nada: não mexe em status,
// elegibilidade nem Prospecção.
// Estado desconhecido/carregando, cliente arquivado/"Não contactar", cliente de
// outro responsável ou telefone inválido -> sempre Chat interno (seguro).

import { toWhatsAppDigits } from "./phone-utils.js";

export const CARD_WA_CHAT = "chat";
export const CARD_WA_EXTERNAL = "external";

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-29] "Corretores com WhatsApp conectado não deve abrir o WhatsApp Web, deve
// abrir o chat do CRM." Corretor/associado (perfil efetivo) com o WhatsApp individual CONECTADO abre SEMPRE o Chat do CRM
// (conversa existente ou nova, pelo número dele) — nunca WhatsApp Web/wa.me. Admin geral e gestor seguem como antes.
// Fonte única desta decisão: card (decideCardWhatsapp), Meta Diária (registerDailyGoalAttempt) e 1ª mensagem do Chat
// (isConnectedOwnClientFirstMessageAllowed, lib/distribution-first-message-core.mjs).
export const CONNECTED_CHAT_FIRST_ROLES = new Set(["broker", "associate"]);
export function isConnectedChatFirst({ role = "", sessionStatus = null } = {}) {
  return CONNECTED_CHAT_FIRST_ROLES.has(String(role || "")) && sessionStatus === "connected";
}
export function buildCrmChatUrl(clientId, text = "") {
  if (!clientId) return "";
  const body = String(text || "").trim().slice(0, 2000);
  return `/admin/chat?client=${encodeURIComponent(clientId)}${body ? `&text=${encodeURIComponent(body)}` : ""}`;
}

// Estados em que a sessão está de fato fora do ar. "reconnecting"/"stored" são
// transitórios (voltam sozinhos) e ficam no Chat.
const DOWN_STATUSES = new Set(["disconnected", "failed", "error", "qr_required", "pairing_code_required", "nunca_conectou"]);

export function isSessionDown(sessionStatus) {
  if (sessionStatus === null || sessionStatus === undefined || sessionStatus === "") return true; // nunca configurou sessão
  return DOWN_STATUSES.has(String(sessionStatus));
}

// device: "desktop" | "mobile" (mobile = celular/tablet ou PWA instalado).
export function buildExternalWhatsappUrl(phone, device) {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return "";
  return device === "mobile"
    ? `https://wa.me/${digits}`
    : `https://web.whatsapp.com/send?phone=${digits}`;
}

// Entrada: { stateKnown, sessionStatus, restricted, device, clientStatus, isOwnClient, phone }
// Saída: { action: "chat" | "external", url?, reason }
export function decideCardWhatsapp({ stateKnown = false, sessionStatus = null, restricted = false, device = "desktop", clientStatus = "", isOwnClient = false, phone = "", chatDisabled = false, printedListMode = false } = {}) {
  if (clientStatus === "archived" || clientStatus === "do_not_contact") return { action: CARD_WA_CHAT, reason: "client_blocked" };
  if (!stateKnown) return { action: CARD_WA_CHAT, reason: "state_unknown" };
  if (!isOwnClient) return { action: CARD_WA_CHAT, reason: "not_own_client" };
  // Chat desativado pelo dono (2026-10-05): o corretor atende pelo WhatsApp do celular/Web, nunca pelo Chat do CRM.
  if (chatDisabled && isOwnClient) {
    const url = buildExternalWhatsappUrl(phone, device === "mobile" ? "mobile" : "desktop");
    if (url) return { action: CARD_WA_EXTERNAL, url, reason: "chat_disabled" };
  }
  // Modo lista impressa (PRO-15, dono 2026-10-15): WhatsApp desconectado (não banido/restrito) = sem Chat; o corretor
  // atende pelo WhatsApp do celular/Web, como com o Chat desligado.
  if (printedListMode && isOwnClient) {
    const url = buildExternalWhatsappUrl(phone, device === "mobile" ? "mobile" : "desktop");
    if (url) return { action: CARD_WA_EXTERNAL, url, reason: "printed_list_mode" };
  }
  // Dono, 2026-10-09: o atendimento passa pelo número OFICIAL no Chat. WhatsApp pessoal desconectado ou com restrição
  // NÃO tira mais o corretor do Chat (antes abria o app/WhatsApp Web); a conversa do oficial responde pelo Chat.
  if (sessionStatus === "connected") return { action: CARD_WA_CHAT, reason: "connected" };
  return { action: CARD_WA_CHAT, reason: restricted === true || isSessionDown(sessionStatus) ? "official_chat" : "transitional" };
}

// Dispositivo: celular/tablet (UA) ou PWA instalado. Não decide o destino —
// só escolhe QUAL link externo usar quando o estado real já mandou abrir fora.
export function detectDevice({ userAgent = "", standalone = false, maxTouchPoints = 0 } = {}) {
  if (standalone) return "mobile";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return "mobile";
  if (/Mac/.test(userAgent) && maxTouchPoints > 1) return "mobile"; // iPadOS
  return "desktop";
}
