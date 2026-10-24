// Conversa do WhatsApp pessoal com o PRÓPRIO número da sessão (2026-10-24, caso do dono: conversa "+55 14 99840-7380"
// na Particular cheia de "Mensagem enviada pelo celular — o CRM não conseguiu ler o conteúdo."). O celular manda à própria
// conta mensagens de protocolo (resposta ao pedido de reenvio do conteúdo, sincronização) e as do "Mensagens para você
// mesmo"; quando não decifram chegam como saída do corretor endereçada ao próprio LID, e o CRM achava o telefone desse
// LID em OUTRA sessão (findPhoneForLidInOtherSessions: o dono conversa com os corretores) -> conversa com ele mesmo.
// Regra: o número da própria sessão nunca vira conversa no Chat (nem por mensagem, nem por histórico, nem juntando
// "Número não identificado"). Primeira barreira no microsserviço (isSelfChatMessage, message-extract.js); esta é a do
// CRM. Puro — testes em tests/whatsapp-self-chat.test.mjs.

import { isSamePhone } from "./phone-utils.js";
import { isLidPlaceholder } from "./whatsapp-lid-placeholder.mjs";

// phone = telefone resolvido da conversa; sessionPhone = whatsapp_individual_sessions.phone_number (número conectado).
export function isSessionOwnPhone(phone, sessionPhone) {
  if (!phone || !sessionPhone || isLidPlaceholder(phone)) return false;
  return isSamePhone(phone, sessionPhone);
}
