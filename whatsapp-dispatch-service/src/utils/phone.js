// Normaliza para E.164 (+<país><número>). Sem "+" e sem código de país, assume DEFAULT_COUNTRY_CODE (55).
// Brasil: aceita só celular (DDD + 9 + 8 dígitos), mesma régua do CRM (lib/phone-utils.js isValidBrazilianMobile).
export function normalizePhone(value, defaultCountry = "55") {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  const hasPlus = raw.startsWith("+") || raw.startsWith("00");
  if (!hasPlus && digits.length <= 11) digits = `${defaultCountry}${digits}`;
  if (digits.startsWith("55")) {
    const national = digits.slice(2);
    if (!/^\d{2}9\d{8}$/.test(national)) return null;
    return `+55${national}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

// Número nacional brasileiro (10–11 dígitos), formato de simulation_registrations.phone_normalized do CRM.
export function brazilianNational(e164) {
  const s = String(e164 || "");
  return s.startsWith("+55") ? s.slice(3) : null;
}

export function digitsOf(e164) {
  return String(e164 || "").replace(/\D/g, "");
}
