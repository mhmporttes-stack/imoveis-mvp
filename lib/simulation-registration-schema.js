import { z } from "zod";
import { formatDateTimeSaoPaulo } from "./date-utils";
import { normalizePersonName } from "./name-utils";
import {
  digitsOnly as phoneDigitsOnly,
  formatBrazilianPhone,
  isValidBrazilianMobile,
  normalizeBrazilianMobileNational,
  toBrazilianE164
} from "./phone-utils";

export const SIMULATION_TYPE_VALUES = ["individual", "joint"];
export const INCOME_TYPE_VALUES = ["registered_employment", "income_tax_declarant", "self_employed_unregistered"];
export const MARITAL_STATUS_VALUES = ["married", "single", "divorced", "stable_union", "widowed"];
export const MINIMUM_SIMULATION_AGE = 18;

export const SIMULATION_TYPE_OPTIONS = [
  { value: "individual", label: "Apenas no meu nome", icon: "user" },
  { value: "joint", label: "Com mais uma pessoa", icon: "users" }
];

export const PRIMARY_INCOME_OPTIONS = [
  { value: "registered_employment", label: "Regime CLT", description: "Registrado - holerite" },
  { value: "income_tax_declarant", label: "Declaro Imposto de Renda" },
  { value: "self_employed_unregistered", label: "Autônomo", description: "Sem registro em carteira e sem imposto de renda" }
];

export const SECONDARY_INCOME_OPTIONS = [
  { value: "registered_employment", label: "Regime CLT", description: "Registrado - holerite" },
  { value: "income_tax_declarant", label: "Declara Imposto de Renda" },
  { value: "self_employed_unregistered", label: "Autônomo", description: "Sem registro em carteira e sem imposto de renda" }
];

export const MARITAL_STATUS_OPTIONS = [
  { value: "married", label: "Casado(a)" },
  { value: "single", label: "Solteiro(a)" },
  { value: "divorced", label: "Divorciado(a)" },
  { value: "stable_union", label: "União estável / morando junto" },
  { value: "widowed", label: "Viúvo(a)" }
];

const incomeTypeLabels = Object.fromEntries(PRIMARY_INCOME_OPTIONS.map((option) => [option.value, option.label]));
const maritalStatusLabels = Object.fromEntries(MARITAL_STATUS_OPTIONS.map((option) => [option.value, option.label]));
const simulationTypeLabels = {
  individual: "Apenas no nome",
  joint: "Com mais uma pessoa"
};

export function getDefaultSimulationRegistration(initialType = "") {
  return {
    simulationType: SIMULATION_TYPE_VALUES.includes(initialType) ? initialType : "",
    fullName: "",
    phone: "",
    oldestBirthDate: "",
    primaryIncomeType: "",
    primaryMonthlyIncome: "",
    secondaryIncomeType: "",
    secondaryMonthlyIncome: "",
    hasOverThreeYearsRegisteredWork: null,
    hasChildrenUnder18: null,
    primaryMaritalStatus: "",
    secondaryMaritalStatus: "",
    hasResidentialProperty: null,
    availablePurchaseResource: formatCurrency(0)
  };
}

export function buildRegistrationSteps(values = {}) {
  const isJoint = values.simulationType === "joint";
  const steps = [
    {
      id: "simulationType",
      kind: "choice",
      title: "Você deseja fazer a simulação apenas no seu nome ou com mais uma pessoa?",
      options: SIMULATION_TYPE_OPTIONS
    },
    {
      id: "fullName",
      kind: "text",
      title: "Qual é o seu nome completo?",
      autoComplete: "name",
      inputMode: "text",
      placeholder: "Digite seu nome completo"
    },
    {
      id: "phone",
      kind: "phone",
      title: "Qual é o seu número de celular?",
      autoComplete: "tel",
      inputMode: "numeric",
      placeholder: "(14) 99999-9999"
    },
    {
      id: "oldestBirthDate",
      kind: "date",
      title: isJoint ? "Qual é a data de nascimento da pessoa mais velha?" : "Qual é a sua data de nascimento?"
    },
    {
      id: "primaryIncomeType",
      kind: "choice",
      title: "Qual é o seu tipo de renda?",
      options: PRIMARY_INCOME_OPTIONS
    },
    {
      id: "primaryMonthlyIncome",
      kind: "currency",
      title: "Qual é o valor da sua renda mensal?",
      placeholder: "R$ 3.800,00"
    }
  ];

  if (isJoint) {
    steps.push(
      {
        id: "secondaryIncomeType",
        kind: "choice",
        title: "Qual é o tipo de renda da segunda pessoa?",
        options: SECONDARY_INCOME_OPTIONS
      },
      {
        id: "secondaryMonthlyIncome",
        kind: "currency",
        title: "Qual é o valor da renda mensal da segunda pessoa?",
        placeholder: "R$ 2.500,00"
      }
    );
  }

  steps.push(
    {
      id: "hasOverThreeYearsRegisteredWork",
      kind: "boolean",
      title: isJoint
        ? "Somando todos os períodos de trabalho com carteira assinada, você ou a segunda pessoa possuem mais de 3 anos de registro?"
        : "Somando todos os seus períodos de trabalho com carteira assinada, você possui mais de 3 anos de registro?"
    },
    {
      id: "hasChildrenUnder18",
      kind: "boolean",
      title: isJoint ? "Algum de vocês possui filhos com menos de 18 anos?" : "Você possui filhos com menos de 18 anos?"
    },
    {
      id: "primaryMaritalStatus",
      kind: "choice",
      title: "Qual é o seu estado civil?",
      options: MARITAL_STATUS_OPTIONS
    }
  );

  if (isJoint) {
    steps.push({
      id: "secondaryMaritalStatus",
      kind: "choice",
      title: "Qual é o estado civil da segunda pessoa?",
      options: MARITAL_STATUS_OPTIONS
    });
  }

  steps.push(
    {
      id: "hasResidentialProperty",
      kind: "boolean",
      title: isJoint
        ? "Algum de vocês possui um imóvel residencial em seu nome?"
        : "Você possui algum imóvel residencial em seu nome?"
    },
    {
      id: "availablePurchaseResource",
      kind: "currency",
      title: isJoint
        ? "Vocês possuem algum valor disponível para utilizar na compra do imóvel?"
        : "Você possui algum valor disponível para utilizar na compra do imóvel?",
      help: "Considere dinheiro próprio, FGTS ou outro recurso que possa ser usado como entrada ou documentação. Você pode informar R$ 0,00.",
      placeholder: "R$ 0,00"
    }
  );

  return steps;
}

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

export function validateStepValue(step, values) {
  const value = values?.[step.id];

  if (step.kind === "choice") {
    return step.options?.some((option) => option.value === value) ? "" : "Escolha uma opção para continuar.";
  }

  if (step.kind === "boolean") {
    return typeof value === "boolean" ? "" : "Escolha uma opção para continuar.";
  }

  if (step.kind === "phone") {
    return isValidBrazilianMobile(value) ? "" : "Informe um celular válido com DDD.";
  }

  if (step.kind === "date") {
    if (!String(value || "").trim()) return "Informe uma data.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Informe uma data válida.";
    if (isFutureDate(value)) return "A data não pode ser futura.";
    if (!isAtLeastMinimumAge(value)) return "É necessário ter pelo menos 18 anos.";
    return "";
  }

  if (step.kind === "currency") {
    const parsed = parseCurrencyNumber(value);
    if (!Number.isFinite(parsed) || parsed < 0) return "Informe um valor válido.";
    if ((step.id === "primaryMonthlyIncome" || step.id === "secondaryMonthlyIncome") && parsed < 1000) {
      return "renda não compativel";
    }
    return "";
  }

  const text = sanitizeText(value);
  if (!text) return "Campo obrigatório.";
  if (!/[A-Za-zÀ-ÿ]/.test(text)) return "Informe uma resposta válida.";
  return "";
}

export function sanitizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value) {
  return normalizeBrazilianMobileNational(value);
}

export function digitsOnly(value) {
  return phoneDigitsOnly(value);
}

export function formatPhone(value) {
  return formatBrazilianPhone(value);
}

export function parseCurrencyNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;

  const clean = text.replace(/[^\d,.-]/g, "");
  if (!clean) return Number.NaN;

  if (clean.includes(",")) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }

  const dotParts = clean.split(".");
  if (dotParts.length > 2) {
    return Number(dotParts.join(""));
  }

  return Number(clean);
}

export function formatCurrencyFromDigits(value) {
  const digits = digitsOnly(value);
  const cents = Number(digits || "0") / 100;
  return formatCurrency(cents);
}

export function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatDateBR(value) {
  if (!value) return "Não informado";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

export function formatDateTimeBR(value) {
  return formatDateTimeSaoPaulo(value);
}

export function simulationTypeLabel(value) {
  return simulationTypeLabels[value] || "Não informado";
}

export function incomeTypeLabel(value) {
  return incomeTypeLabels[value] || "Não informado";
}

export function maritalStatusLabel(value) {
  return maritalStatusLabels[value] || "Não informado";
}

export function booleanLabel(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "Não informado";
}

export function calculateFamilyIncome(registration = {}) {
  return Number(registration.primaryMonthlyIncome || 0) + Number(registration.secondaryMonthlyIncome || 0);
}

export function getMaximumBirthDateForMinimumAge(minimumAge = MINIMUM_SIMULATION_AGE) {
  const today = new Date();
  const maxDate = new Date(today.getFullYear() - minimumAge, today.getMonth(), today.getDate());
  const year = String(maxDate.getFullYear()).padStart(4, "0");
  const month = String(maxDate.getMonth() + 1).padStart(2, "0");
  const day = String(maxDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isAtLeastMinimumAge(value, minimumAge = MINIMUM_SIMULATION_AGE) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;

  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDifference = today.getMonth() + 1 - month;
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < day)) {
    age -= 1;
  }

  return age >= minimumAge;
}

function isFutureDate(value) {
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return Number.isNaN(date.getTime()) || date > today;
}
