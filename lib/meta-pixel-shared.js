// Utilidades puras (sem "server-only", sem window) para o rastreamento do
// Meta Pixel/Conversions API — usadas tanto pelo componente do pixel
// (browser) quanto pelo envio server-side (lib/meta-conversions-api.js), pra
// nunca ter duas definições da mesma regra (telefone normalizado, faixa de
// renda) divergindo entre cliente e servidor.

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "";

// Telefone no formato que a Meta espera para hashear: só dígitos, com DDI,
// sem "+"/espaços/parênteses. Nunca envie o valor em texto puro para a Meta —
// só o hash (ver lib/meta-conversions-api.js e lib/meta-pixel-client.js).
export function normalizePhoneForMeta(phone) {
  return String(phone || "").replace(/\D/g, "");
}

// Renda NUNCA é enviada em valor exato — só a faixa (decisão explícita do
// dono do CRM, para não expor dado financeiro individual às ferramentas de
// negócio da Meta). Faixas arredondadas, sem granularidade que permita
// reconstruir o valor real.
export function incomeBracketLabel(totalMonthlyIncome) {
  const value = Number(totalMonthlyIncome) || 0;
  if (value <= 0) return "";
  if (value < 2000) return "ate_2k";
  if (value < 5000) return "2k_a_5k";
  if (value < 10000) return "5k_a_10k";
  if (value < 20000) return "10k_a_20k";
  return "acima_20k";
}
