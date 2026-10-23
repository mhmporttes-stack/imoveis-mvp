// VISUALIZAÇÃO ÚNICA no Chat (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23, WA-35): "nas conversas aponte quando foi
// enviado algo de visualização única para eu não ficar perdido". O WhatsApp não entrega o conteúdo de foto/vídeo/áudio
// de visualização única a aparelhos conectados; o microsserviço manda só o marcador (evento `message` com
// messageType "view_once" e viewOnce: { media }), nos dois sentidos. O CRM grava uma linha message_type "view_once"
// com texto fixo — NUNCA o arquivo (respeita o "ver uma vez"). Conta como as mídias comuns: do contato = resposta do
// cliente; do celular do corretor = contato humano. Puro; testes em tests/whatsapp-view-once.test.mjs.

export const VIEW_ONCE_MESSAGE_TYPE = "view_once";
const VIEW_ONCE_MEDIA = new Set(["image", "video", "audio"]);

// Payload do serviço -> { media } normalizado, ou null quando não é visualização única.
export function normalizeViewOnce(value) {
  if (!value || typeof value !== "object") return null;
  return { media: VIEW_ONCE_MEDIA.has(value.media) ? value.media : "" };
}

// Texto do balão (fica no corpo da mensagem: lista, prévia, push e busca mostram o mesmo).
export function viewOnceText(media = "") {
  if (media === "audio") return "🎤 Áudio de visualização única — só pode ser ouvido no celular";
  if (media === "image" || media === "video") return "📷 Foto/vídeo de visualização única — só pode ser aberto no celular";
  // O WhatsApp às vezes só avisa que era visualização única, sem dizer o tipo.
  return "📷 Foto, vídeo ou áudio de visualização única — só pode ser aberto no celular";
}
