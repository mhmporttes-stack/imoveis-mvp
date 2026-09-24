import { buildWhatsAppUrl } from "./phone-utils.js";

// Para onde o botão "WhatsApp" do card do cliente leva (usado nos 3 cards:
// Clientes, Oportunidades e o painel de detalhe).
//  - cliente DENTRO da janela de 24h -> Chat (número oficial);
//  - FORA da janela (ou qualquer falha ao consultar) -> WhatsApp do próprio
//    corretor (wa.me): sempre consegue mandar mensagem, ao contrário do Chat, que
//    fora das 24h só aceita modelo aprovado.
// Só decide o destino; registrar o contato continua sendo feito pelo chamador.
export async function resolveClientWhatsappDestination(clientId, phoneValue) {
  try {
    const response = await fetch(`/api/admin/whatsapp-chat/window?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.windowOpen) {
      return { channel: "chat", url: `/admin/chat?client=${encodeURIComponent(clientId)}` };
    }
  } catch {
    // sem resposta: cai no WhatsApp do corretor
  }
  return { channel: "personal", url: buildWhatsAppUrl(phoneValue) };
}
