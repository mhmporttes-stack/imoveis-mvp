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

// ---------------------------------------------------------------------------
// Estratégia CENTRAL de comparação/normalização de telefone do ecossistema
// WhatsApp (webhook, Chat, roleta, Fluxos, automações, Disparo, busca e
// vinculação de cliente). Existe para impedir DUPLICIDADE ACIDENTAL causada só
// pelo formato do número — em especial o 9º dígito: a Meta às vezes entrega
// (wa_id) um celular brasileiro SEM o 9, enquanto o cadastro do CRM tem COM o 9.
// Nunca decide se dois cadastros com o mesmo telefone são "o mesmo cliente"
// (o CRM permite vários atendimentos para o mesmo telefone) — só diz se DOIS
// FORMATOS representam o MESMO NÚMERO.
// ---------------------------------------------------------------------------

// Parte nacional de um número brasileiro (DDD + número), sem 00/55; ou null se
// não parece número brasileiro (10 ou 11 dígitos após remover o DDI).
function brazilianNationalDigits(value) {
  let digits = digitsOnly(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

// Celular brasileiro (com ou sem o 9º dígito) → { ddd, local8 }. Fixo (número
// local começando em 2–5) e qualquer outro formato → null.
function brazilianMobileParts(value) {
  const national = brazilianNationalDigits(value);
  if (!national) return null;
  const ddd = national.slice(0, 2);
  if (national.length === 11 && national[2] === "9") return { ddd, local8: national.slice(3) };
  // Antigo celular de 8 dígitos (sem o 9): o número local começa em 6–9. Fixos começam em 2–5.
  if (national.length === 10 && /^[6-9]/.test(national.slice(2))) return { ddd, local8: national.slice(2) };
  return null;
}

// Formato canônico (E.164) para GUARDAR e comparar: celular brasileiro SEMPRE
// com o 9 (+55DD9XXXXXXXX); fixo brasileiro +55DDXXXXXXXX; qualquer outro
// (número de fora) só com "+" e os dígitos. Vazio quando não há dígitos.
export function canonicalWhatsappPhone(value) {
  const mobile = brazilianMobileParts(value);
  if (mobile) return `+55${mobile.ddd}9${mobile.local8}`;
  const national = brazilianNationalDigits(value);
  if (national && national.length === 10) return `+55${national}`;
  const digits = digitsOnly(value);
  return digits ? `+${digits}` : "";
}

// Chave de comparação: dois formatos do MESMO número têm a mesma chave
// (com/sem 9, com/sem +55, com/sem máscara). Celular e fixo nunca colidem.
export function phoneComparisonKey(value) {
  const mobile = brazilianMobileParts(value);
  if (mobile) return `m${mobile.ddd}${mobile.local8}`;
  const national = brazilianNationalDigits(value);
  if (national && national.length === 10) return `l${national}`;
  return digitsOnly(value);
}

export function isSamePhone(a, b) {
  const keyA = phoneComparisonKey(a);
  return Boolean(keyA) && keyA === phoneComparisonKey(b);
}

// Todas as formas em que este número pode estar GRAVADO no banco (E.164,
// dígitos, nacional; com e sem o 9) — usado em `.in("coluna", candidatos)`.
export function phoneLookupCandidates(value) {
  const digits = digitsOnly(value);
  if (!digits) return [];
  const variants = new Set([digits, `+${digits}`]);
  const mobile = brazilianMobileParts(value);
  if (mobile) {
    for (const local of [`9${mobile.local8}`, mobile.local8]) {
      const national = `${mobile.ddd}${local}`;
      variants.add(national);
      variants.add(`55${national}`);
      variants.add(`+55${national}`);
    }
  } else {
    const national = brazilianNationalDigits(value);
    if (national) {
      variants.add(national);
      variants.add(`55${national}`);
      variants.add(`+55${national}`);
    }
  }
  return Array.from(variants);
}
