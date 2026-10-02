// Regras PURAS das ações por mensagem no Chat (pedido do dono, 2026-10-02):
// responder, reagir, editar, apagar para todos, mídia (foto, vídeo, GIF,
// figurinha, áudio, documento). Fonte única para o servidor (lib/whatsapp-chat.js,
// lib/whatsapp-individual-inbound.js) e para a tela (components/WhatsappChat.jsx)
// — celular, app de computador e navegador usam exatamente estas regras.
// Testes: tests/whatsapp-message-actions.test.mjs.

// Prazos do próprio WhatsApp (com folga): editar até 15 min; apagar para
// todos até ~2 dias (o WhatsApp aceita ~60 h; usamos 48 h para não falhar no limite).
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const INDIVIDUAL = "whatsapp_individual";

// Identificador da mensagem no WhatsApp, qualquer que seja o canal: Meta
// (meta_message_id) ou sessão individual (metadata.wa_message_id).
export function messageRefId(row) {
  return String(row?.meta_message_id || row?.metadata?.wa_message_id || "");
}

// A qual mensagem esta responde (citação).
export function replyTargetRefId(row) {
  return String(row?.payload?.context?.id || row?.metadata?.replyToMessageId || row?.metadata?.reply_to_wa_id || "");
}

// A qual mensagem esta reação se refere.
export function reactionTargetRefId(row) {
  return String(row?.payload?.reaction?.message_id || row?.metadata?.replyToMessageId || row?.metadata?.reaction_target_wa_id || "");
}

export function isRevoked(row) {
  return Boolean(row?.metadata?.revoked_at);
}

function sentAtMs(row) {
  const value = row?.sent_at || row?.message_at;
  const ms = new Date(value || "").getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

// Editar/apagar só existe para mensagem enviada pela EQUIPE pelo WhatsApp
// individual (o número oficial não tem essas ações pela API), já enviada
// com sucesso, não apagada. Quem pode: quem enviou ou administrador/gestor.
function ownTeamMessage(row, { userId = "", isManager = false } = {}) {
  if (!row || row.direction !== "outbound" || row.sender_type !== "user") return false;
  if (row.channel !== INDIVIDUAL || !row.metadata?.wa_message_id) return false;
  if (row.status === "failed" || isRevoked(row)) return false;
  return isManager || (Boolean(userId) && row.sender_user_id === userId);
}

export function canEditMessage(row, actor = {}, now = Date.now()) {
  if (!ownTeamMessage(row, actor)) return false;
  if (row.message_type !== "text" && !(["image", "video"].includes(row.message_type) && row.body)) return false;
  const sent = sentAtMs(row);
  return !Number.isNaN(sent) && now - sent <= EDIT_WINDOW_MS;
}

export function canDeleteForEveryone(row, actor = {}, now = Date.now()) {
  if (!ownTeamMessage(row, actor)) return false;
  const sent = sentAtMs(row);
  return !Number.isNaN(sent) && now - sent <= DELETE_FOR_EVERYONE_WINDOW_MS;
}

// Responder/reagir: qualquer mensagem real (não interna, não reação, não
// apagada, com id do WhatsApp). No canal individual vale para as mensagens
// do cliente e da equipe; no oficial (Meta) só para as do cliente.
export function canReplyOrReact(row) {
  if (!row || row.direction === "internal" || row.message_type === "reaction" || isRevoked(row)) return false;
  if (row.status === "failed") return false;
  if (row.channel === INDIVIDUAL) return Boolean(row.metadata?.wa_message_id);
  return row.direction === "inbound" && Boolean(row.meta_message_id);
}

// Tipo de mídia da sessão individual -> message_type do Chat. GIF é um vídeo
// com reprodução automática (marcado em metadata.gif).
export function chatTypeForIndividualMedia(kind) {
  if (kind === "gif") return "video";
  return ["image", "video", "sticker", "audio", "document"].includes(kind) ? kind : "document";
}

// Anexo enviado pelo atendente: MIME -> tipo de envio.
export const OUTBOUND_IMAGE_MIMES = ["image/jpeg", "image/png"];
export const OUTBOUND_VIDEO_MIMES = ["video/mp4", "video/3gpp", "video/quicktime"];
export const OUTBOUND_STICKER_MIMES = ["image/webp"];
export const OUTBOUND_GIF_MIMES = ["image/gif"];

export function outboundKindForMime(mime, { asGif = false } = {}) {
  const value = String(mime || "").split(";")[0].trim().toLowerCase();
  if (OUTBOUND_IMAGE_MIMES.includes(value)) return "image";
  if (OUTBOUND_STICKER_MIMES.includes(value)) return "sticker";
  // GIF animado (.gif) não é aceito pelo WhatsApp como animação — vai como
  // arquivo (abre animado). Vídeo MP4 marcado como GIF toca em loop.
  if (OUTBOUND_GIF_MIMES.includes(value)) return "gif_file";
  if (OUTBOUND_VIDEO_MIMES.includes(value)) return asGif && value === "video/mp4" ? "gif" : "video";
  return "";
}
