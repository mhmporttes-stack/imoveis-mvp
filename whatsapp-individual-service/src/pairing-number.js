// Número para o pareamento por código (requestPairingCode do Baileys): o
// WhatsApp exige o formato internacional SÓ COM DÍGITOS (ex.: 5514999990000).
// A tela pede "seu número (com DDD)" — sem o 55 o WhatsApp recusava e
// derrubava a sessão (logged_out) sem mostrar código nenhum (achado real,
// 2026-10-02). Puro, testado em tests/whatsapp-individual-extract.test.mjs.
export function normalizePairingNumber(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`; // DDD + número (BR)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return "";
}
