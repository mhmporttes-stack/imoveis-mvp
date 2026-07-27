export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeBrazilianMobileNational(value) {
  let digits = digitsOnly(value);

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);

  return digits.slice(0, 11);
}

export function isValidBrazilianMobile(value) {
  const national = normalizeBrazilianMobileNational(value);
  return /^\d{2}9\d{8}$/.test(national);
}

export function toBrazilianE164(value) {
  const national = normalizeBrazilianMobileNational(value);
  return isValidBrazilianMobile(national) ? `+55${national}` : "";
}

export function toWhatsAppDigits(value) {
  const national = normalizeBrazilianMobileNational(value);
  return isValidBrazilianMobile(national) ? `55${national}` : "";
}

export function formatBrazilianPhone(value) {
  const digits = normalizeBrazilianMobileNational(value);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function buildWhatsAppUrl(value) {
  const phone = toWhatsAppDigits(value);
  return phone ? `https://wa.me/${phone}` : "";
}
