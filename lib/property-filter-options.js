export const PROPERTY_TYPE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "apartamento", label: "Apartamento", matches: ["apartamento"] },
  { value: "casa", label: "Casa", matches: ["casa"] },
  { value: "terreno", label: "Terreno", matches: ["terreno", "loteamento"] },
  { value: "chacara", label: "Chácara", matches: ["chacara"] },
  { value: "casa-condominio", label: "Casa em condomínio", matches: ["casa-condominio", "condominio"] }
];

export const REGION_FILTER_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "norte", label: "Norte" },
  { value: "sul", label: "Sul" },
  { value: "leste", label: "Leste" },
  { value: "oeste", label: "Oeste" },
  { value: "centro", label: "Centro" }
];

export const ADMIN_REGION_OPTIONS = REGION_FILTER_OPTIONS.filter((option) => option.value);

export function propertyTypeMatches(propertyType, filterType) {
  if (!filterType) return true;
  const option = PROPERTY_TYPE_OPTIONS.find((item) => item.value === filterType);
  if (!option) return true;
  return option.matches.includes(String(propertyType || ""));
}

export function normalizeRegionValue(value = "") {
  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("norte")) return "norte";
  if (normalized.includes("sul")) return "sul";
  if (normalized.includes("leste")) return "leste";
  if (normalized.includes("oeste")) return "oeste";
  if (normalized.includes("centro") || normalized.includes("central")) return "centro";
  return "";
}

export function regionLabel(value = "") {
  const normalized = normalizeRegionValue(value);
  return REGION_FILTER_OPTIONS.find((option) => option.value === normalized)?.label || value || "";
}

export function parsePriceValue(value = "") {
  const cleanText = String(value).replace(/[^\d,.]/g, "");
  if (!cleanText) return null;

  const normalized = cleanText.includes(",")
    ? cleanText.replace(/\./g, "").replace(",", ".")
    : cleanText.replace(/\D/g, "");
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

// Valor em REAIS INTEIROS ("R$ 300.000"), sem centavos: com ",00" no texto, cada tecla relia os centavos como
// dígitos novos e o valor explodia (R$ 30.090.000.000.000.000,00 — bug visto pelo dono no site, 2026-10-15).
// Máscara de reais INTEIROS: "1000" → "R$ 1.000" (filtro do site). Com `{ cents: true }`, "1000" → "R$ 1.000,00" (",00" fixo;
// campos de valor da Estratégia com amortização, PRES-24). Os dígitos são sempre reais inteiros.
export function formatCurrencyInput(value = "", { cents = false } = {}) {
  const digits = String(value).replace(/\D/g, "").replace(/^0+/, "").slice(0, 12);
  if (!digits) return "";

  return Number(digits).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0
  });
}

/**
 * Reais inteiros digitados num campo com a máscara `formatCurrencyInput(…, { cents: true })`. O ",00" é fixo: dígito digitado
 * DEPOIS dele entra no fim dos reais ("R$ 300,005" → 3005); apagar um zero do ",00" apaga o último dígito dos reais
 * ("R$ 300,0" → 30). Sem vírgula, todos os dígitos são reais. Vazio → 0.
 */
export function wholeReaisFromCurrencyInput(text = "") {
  const value = String(text);
  const comma = value.lastIndexOf(",");
  let digits = (comma >= 0 ? value.slice(0, comma) : value).replace(/\D/g, "");
  if (comma >= 0) {
    const decimals = value.slice(comma + 1).replace(/\D/g, "");
    if (decimals.length > 2) digits += decimals.slice(2);
    else if (decimals.length < 2) digits = digits.slice(0, -1);
  }
  digits = digits.replace(/^0+/, "").slice(0, 12);
  return digits ? Number(digits) : 0;
}

export function currencyInputToNumber(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits);
}
