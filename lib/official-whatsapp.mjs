// Número OFICIAL do WhatsApp (API da Meta): para onde TODO link voltado ao CLIENTE leva (dono, 2026-10-09). O atendimento
// segue pelo Chat do CRM, pelo corretor sorteado/responsável. Não depende de ambiente: é o número exibido da conta.
export const OFFICIAL_WHATSAPP_DIGITS = "5514991056706";

export function officialWhatsappUrl(text = "") {
  const value = String(text || "").trim();
  return `https://wa.me/${OFFICIAL_WHATSAPP_DIGITS}${value ? `?text=${encodeURIComponent(value)}` : ""}`;
}
