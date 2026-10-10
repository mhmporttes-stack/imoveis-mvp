// Conversa do WhatsApp pessoal cujo TELEFONE ainda não é conhecido (regra do dono, 2026-10-10: "carregar tudo do
// WhatsApp do corretor no Chat"). O WhatsApp endereça contato novo por LID (`<id>@lid`) sem número; a conversa entra
// no Chat com contact_phone = "lid:<id>" e é juntada à conversa do telefone real assim que ele aparecer
// (mergeLidConversation em lib/whatsapp-individual-inbound.js). Puro — testado em tests/whatsapp-lid-placeholder.test.mjs.

export function isLidPlaceholder(value) {
  return /^lid:\d{5,30}$/.test(String(value || ""));
}

// "247050881003585@lid" / "247050881003585:3@lid" -> "lid:247050881003585"; qualquer outra coisa -> "".
export function lidPlaceholderFromJid(jid) {
  const value = String(jid || "");
  if (!value.endsWith("@lid")) return "";
  const digits = value.slice(0, -4).split(":")[0].replace(/\D/g, "");
  return digits.length >= 5 ? `lid:${digits}` : "";
}
