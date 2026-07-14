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

export function formatCurrencyInput(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";

  return Number(digits).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export function currencyInputToNumber(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits);
}
