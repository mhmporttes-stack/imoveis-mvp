export const DEFAULT_FEATURE_ICON = "sparkles";

export const FEATURE_ICON_OPTIONS = [
  { value: "sparkles", label: "Destaque" },
  { value: "home", label: "Casa" },
  { value: "bed", label: "Quartos" },
  { value: "ruler", label: "Metragem" },
  { value: "wallet", label: "Financiamento" },
  { value: "percent", label: "Descontos" },
  { value: "trees", label: "Lazer" },
  { value: "shield", label: "Segurança" },
  { value: "car", label: "Vagas" },
  { value: "waves", label: "Piscina" },
  { value: "dumbbell", label: "Academia" },
  { value: "building", label: "Condomínio" },
  { value: "calendar", label: "Entrega" },
  { value: "money", label: "Investimento" }
];

export const SUGGESTED_FEATURES = [
  { text: "2 quartos", icon: "bed" },
  { text: "3 quartos", icon: "bed" },
  { text: "1 suíte", icon: "bed" },
  { text: "2 suítes", icon: "bed" },
  { text: "Varanda gourmet", icon: "home" },
  { text: "Piscina", icon: "waves" },
  { text: "Lazer completo", icon: "trees" },
  { text: "Churrasqueira", icon: "home" },
  { text: "Área de serviço", icon: "home" },
  { text: "Portaria 24 horas", icon: "shield" },
  { text: "Elevador", icon: "building" },
  { text: "Infraestrutura completa", icon: "building" },
  { text: "Aceita financiamento", icon: "wallet" },
  { text: "Entrada facilitada", icon: "wallet" },
  { text: "Descontos especiais", icon: "percent" },
  { text: "2 vagas", icon: "car" },
  { text: "Pronto para construir", icon: "calendar" }
];

const VALID_ICON_VALUES = new Set(FEATURE_ICON_OPTIONS.map((option) => option.value));

export function normalizePropertyFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.map(normalizePropertyFeature).filter(Boolean);
}

export function normalizePropertyFeature(feature) {
  if (typeof feature === "string") {
    const text = feature.trim();
    if (!text || /^\d+$/.test(text)) return null;
    return { text, icon: inferFeatureIcon(text) };
  }

  if (feature && typeof feature === "object") {
    const text = String(feature.text || feature.label || feature.name || "").trim();
    if (!text || /^\d+$/.test(text)) return null;
    const icon = normalizeFeatureIcon(feature.icon) || inferFeatureIcon(text);
    return { text, icon };
  }

  return null;
}

export function normalizeFeatureIcon(icon) {
  return VALID_ICON_VALUES.has(icon) ? icon : "";
}

export function featureText(feature) {
  return normalizePropertyFeature(feature)?.text || "";
}

export function inferFeatureIcon(text = "") {
  const value = text.toLowerCase();

  if (value.includes("quarto") || value.includes("suite") || value.includes("suíte")) return "bed";
  if (value.includes("m2") || value.includes("m²") || value.includes("metro")) return "ruler";
  if (value.includes("financi") || value.includes("entrada") || value.includes("credito") || value.includes("crédito")) return "wallet";
  if (value.includes("desconto") || value.includes("subsidio") || value.includes("subsídio")) return "percent";
  if (value.includes("piscina")) return "waves";
  if (value.includes("lazer") || value.includes("jardim")) return "trees";
  if (value.includes("portaria") || value.includes("seguran")) return "shield";
  if (value.includes("vaga") || value.includes("garagem")) return "car";
  if (value.includes("academia")) return "dumbbell";
  if (value.includes("elevador") || value.includes("infraestrutura") || value.includes("condominio") || value.includes("condomínio")) return "building";
  if (value.includes("entrega") || value.includes("pronto") || value.includes("obra") || value.includes("lancamento") || value.includes("lançamento")) return "calendar";
  if (value.includes("invest") || value.includes("r$")) return "money";

  return DEFAULT_FEATURE_ICON;
}
