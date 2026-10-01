import { z } from "zod";
import { normalizePersonName } from "./name-utils";
import { toBrazilianE164, isValidBrazilianMobile } from "./phone-utils";
import {
  SIMULATION_TYPE_VALUES,
  INCOME_TYPE_VALUES,
  MARITAL_STATUS_VALUES,
  formatPhone,
  isAtLeastMinimumAge,
  isFutureDate,
  parseCurrencyNumber,
  sanitizeText
} from "./simulation-registration-format";

// Constantes/formatação/labels puras moram em simulation-registration-format.js
// (sem zod) — reexportadas aqui para quem já importa deste caminho continuar
// funcionando sem nenhuma mudança (rotas de API, lib/simulation-registrations.js,
// etc.). Só o schema de validação (que precisa de zod) fica neste arquivo.
// Componentes "use client" que só usam formatação/labels devem importar
// direto de simulation-registration-format.js — ver docs/PERFORMANCE_AUDIT.md.
export * from "./simulation-registration-format";

const sanitizedString = (maxLength) =>
  z.preprocess(
    (value) => sanitizeText(value),
    z
      .string()
      .min(1, "Campo obrigatório.")
      .max(maxLength, `Use no máximo ${maxLength} caracteres.`)
  );

const nameSchema = sanitizedString(160).refine(
  (value) => /[A-Za-zÀ-ÿ]/.test(value) && !/^\d+$/.test(value.replace(/\s+/g, "")),
  "Informe um nome válido."
);

const phoneSchema = z.preprocess(
  (value) => toBrazilianE164(value),
  z.string().refine((value) => isValidBrazilianMobile(value), "Informe um celular com DDD.")
);

const dateSchema = z.preprocess(
  (value) => String(value || "").trim(),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.")
    .refine((value) => !isFutureDate(value), "A data não pode ser futura.")
    .refine((value) => isAtLeastMinimumAge(value), "É necessário ter pelo menos 18 anos.")
);

const moneySchema = z.preprocess(
  (value) => {
    const parsed = parseCurrencyNumber(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  },
  z.number({ error: "Informe um valor válido." }).min(0, "O valor não pode ser negativo.")
);

const incomeMoneySchema = moneySchema.refine((value) => value >= 1000, "renda não compativel");

const optionalMoneySchema = z.preprocess((value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = parseCurrencyNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}, z.number({ error: "Informe um valor válido." }).min(0, "O valor não pode ser negativo.").nullable());

const optionalIncomeMoneySchema = optionalMoneySchema.refine(
  (value) => value === null || value >= 1000,
  "renda não compativel"
);

const booleanSchema = z.preprocess((value) => {
  if (value === true || value === "true" || value === "Sim") return true;
  if (value === false || value === "false" || value === "Não") return false;
  return undefined;
}, z.boolean({ error: "Escolha uma opção." }));

const optionalEnum = (values) =>
  z.preprocess((value) => {
    const text = sanitizeText(value);
    return text || null;
  }, z.enum(values).nullable());

export const simulationRegistrationSchema = z
  .object({
    simulationType: z.enum(SIMULATION_TYPE_VALUES, { error: "Escolha o tipo de simulação." }),
    fullName: nameSchema,
    phone: phoneSchema,
    oldestBirthDate: dateSchema,
    primaryIncomeType: z.enum(INCOME_TYPE_VALUES, { error: "Escolha o tipo de renda." }),
    primaryMonthlyIncome: incomeMoneySchema,
    secondaryIncomeType: optionalEnum(INCOME_TYPE_VALUES),
    secondaryMonthlyIncome: optionalIncomeMoneySchema,
    hasOverThreeYearsRegisteredWork: booleanSchema,
    hasChildrenUnder18: booleanSchema,
    primaryMaritalStatus: z.enum(MARITAL_STATUS_VALUES, { error: "Escolha o estado civil." }),
    secondaryMaritalStatus: optionalEnum(MARITAL_STATUS_VALUES),
    hasResidentialProperty: booleanSchema,
    availablePurchaseResource: moneySchema
  })
  .superRefine((data, context) => {
    const isJointSimulation = data.simulationType === "joint" || data.primaryMaritalStatus === "married";
    if (!isJointSimulation) return;

    if (!data.secondaryIncomeType) {
      context.addIssue({ code: "custom", path: ["secondaryIncomeType"], message: "Escolha o tipo de renda da segunda pessoa." });
    }

    if (data.secondaryMonthlyIncome === null || data.secondaryMonthlyIncome === undefined) {
      context.addIssue({ code: "custom", path: ["secondaryMonthlyIncome"], message: "Informe a renda mensal da segunda pessoa." });
    }

    if (!data.secondaryMaritalStatus) {
      context.addIssue({ code: "custom", path: ["secondaryMaritalStatus"], message: "Escolha o estado civil da segunda pessoa." });
    }
  })
  .transform((data) => {
    const simulationType = data.primaryMaritalStatus === "married" ? "joint" : data.simulationType;

    return {
      ...data,
      simulationType,
      fullName: normalizePersonName(data.fullName),
      phone: formatPhone(data.phone),
      phoneNormalized: toBrazilianE164(data.phone),
      secondaryIncomeType: simulationType === "joint" ? data.secondaryIncomeType : null,
      secondaryMonthlyIncome: simulationType === "joint" ? data.secondaryMonthlyIncome : null,
      secondaryMaritalStatus: simulationType === "joint" ? data.secondaryMaritalStatus : null
    };
  });

export function validateSimulationRegistration(payload) {
  const result = simulationRegistrationSchema.safeParse(payload);
  if (result.success) {
    return { ok: true, data: result.data, fieldErrors: {}, formError: "" };
  }

  const flattened = result.error.flatten();
  return {
    ok: false,
    data: null,
    fieldErrors: flattened.fieldErrors || {},
    formError: flattened.formErrors?.[0] || "Revise as informações antes de continuar."
  };
}
