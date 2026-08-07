import { z } from "zod";
import { normalizePersonName } from "./name-utils";
import { formatBrazilianPhone, toBrazilianE164, toWhatsAppDigits } from "./phone-utils";
import { normalizeMoneyValue } from "./simulation-list-utils";

export const CAPTACAO_PROPERTY_TYPES = [
  "casa",
  "apartamento",
  "terreno",
  "chacara",
  "sala_comercial",
  "outro"
];

export const CAPTACAO_STATUS_VALUES = [
  "nova",
  "em_analise",
  "aguardando_contato",
  "avaliada",
  "aprovada_publicacao",
  "publicada",
  "nao_captada"
];

export const CAPTACAO_TYPE_OPTIONS = [
  { value: "casa", label: "Casa" },
  { value: "apartamento", label: "Apartamento" },
  { value: "terreno", label: "Terreno" },
  { value: "chacara", label: "Chacara" },
  { value: "sala_comercial", label: "Sala comercial" },
  { value: "outro", label: "Outro" }
];

export const CAPTACAO_STATUS_OPTIONS = [
  { value: "nova", label: "Nova captacao", tone: "blue" },
  { value: "em_analise", label: "Em analise", tone: "blue" },
  { value: "aguardando_contato", label: "Aguardando contato", tone: "amber" },
  { value: "avaliada", label: "Avaliada", tone: "blue" },
  { value: "aprovada_publicacao", label: "Aprovada para publicar", tone: "green" },
  { value: "publicada", label: "Publicada", tone: "green" },
  { value: "nao_captada", label: "Nao captada", tone: "red" }
];

export const SALE_TIMELINE_OPTIONS = [
  { value: "urgente", label: "Urgente" },
  { value: "30_dias", label: "Ate 30 dias" },
  { value: "90_dias", label: "Ate 90 dias" },
  { value: "sem_pressa", label: "Sem pressa" }
];

export const CURRENT_SITUATION_OPTIONS = [
  { value: "ocupado_proprietario", label: "Moro no imovel" },
  { value: "desocupado", label: "Desocupado" },
  { value: "alugado", label: "Alugado" },
  { value: "em_obras", label: "Em obras" }
];

export const EXCHANGE_OPTIONS = [
  { value: "nao", label: "Nao aceito permuta" },
  { value: "imovel_menor", label: "Aceito imovel menor" },
  { value: "imovel_maior", label: "Aceito imovel maior" },
  { value: "veiculo", label: "Aceito veiculo" },
  { value: "avaliar", label: "Avaliar propostas" }
];

const requiredText = (label, max = 160) =>
  z.preprocess(
    (value) => cleanText(value),
    z.string().min(1, `${label} e obrigatorio.`).max(max, `${label} esta muito longo.`)
  );

const optionalText = (max = 240) =>
  z.preprocess(
    (value) => cleanText(value),
    z.string().max(max, "Texto muito longo.").default("")
  );

const moneyField = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return null;
  const normalized = normalizeMoneyValue(value);
  return normalized > 0 ? normalized : null;
}, z.number().nonnegative().nullable().default(null));

const booleanField = z.preprocess((value) => value === true || value === "true", z.boolean().default(false));

const photoSchema = z.object({
  name: optionalText(180),
  data: z.string().url("Imagem invalida."),
  storagePath: optionalText(500)
});

const captacaoBaseSchema = z.object({
  ownerName: requiredText("Nome", 140).transform(normalizePersonName),
  ownerPhone: z.preprocess((value) => toBrazilianE164(value), z.string().min(1, "WhatsApp invalido.")),
  ownerEmail: optionalText(180).refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "E-mail invalido."),
  propertyType: z.enum(CAPTACAO_PROPERTY_TYPES),
  propertyTypeOther: optionalText(120),
  street: optionalText(180),
  number: optionalText(40),
  neighborhood: optionalText(140),
  city: optionalText(120).transform((value) => value || "Marilia"),
  state: optionalText(2).transform((value) => (value || "SP").toUpperCase()),
  intendedPrice: moneyField,
  requestsEvaluation: booleanField,
  saleTimeline: optionalText(80),
  exchangeAcceptance: optionalText(100),
  currentSituation: optionalText(100),
  saleReason: optionalText(180),
  notes: optionalText(500),
  details: z.record(z.string(), z.unknown()).default({}),
  photos: z.array(photoSchema).max(30, "Envie no maximo 30 fotos.").default([])
});

export const captacaoInputSchema = captacaoBaseSchema.superRefine((data, ctx) => {
  if (data.propertyType === "outro" && !data.propertyTypeOther) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["propertyTypeOther"],
      message: "Informe o tipo do imovel."
    });
  }

  if (!data.requestsEvaluation && data.intendedPrice === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["intendedPrice"],
      message: "Informe o valor pretendido ou solicite avaliacao."
    });
  }
});

export const captacaoAdminUpdateSchema = captacaoBaseSchema.partial().extend({
  status: z.enum(CAPTACAO_STATUS_VALUES).optional()
});

export function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCaptacaoType(value = "", other = "") {
  if (value === "outro" && other) return other;
  return CAPTACAO_TYPE_OPTIONS.find((option) => option.value === value)?.label || "Imovel";
}

export function formatCaptacaoStatus(value = "") {
  return CAPTACAO_STATUS_OPTIONS.find((option) => option.value === value)?.label || "Nova captacao";
}

export function formatCaptacaoMoney(value) {
  const amount = normalizeMoneyValue(value);
  if (!amount) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amount);
}

export function formatCaptacaoPhone(value = "") {
  return formatBrazilianPhone(value) || value;
}

export function getCaptacaoWhatsApp(value = "") {
  const digits = toWhatsAppDigits(value);
  return digits ? `https://wa.me/${digits}` : "";
}

export function captacaoStatusClasses(status = "") {
  const tone = CAPTACAO_STATUS_OPTIONS.find((option) => option.value === status)?.tone || "blue";
  const classes = {
    blue: "border-blue-100 bg-[#E9F2FF] text-navy",
    green: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    red: "border-red-100 bg-red-50 text-red-700"
  };
  return classes[tone] || classes.blue;
}
