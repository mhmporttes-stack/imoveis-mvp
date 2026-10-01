import { formatDateTimeSaoPaulo } from "./date-utils";
import {
  digitsOnly as phoneDigitsOnly,
  formatBrazilianPhone,
  isValidBrazilianMobile,
  normalizeBrazilianMobileNational
} from "./phone-utils";

// Constantes, formatação e labels do cadastro de simulação SEM dependência de
// zod — extraído de simulation-registration-schema.js (achado da 2ª rodada da
// auditoria de performance 2026-10-01): várias telas do CRM (cards de
// cliente, listas, detalhes) só precisam de formatação/labels, mas
// importavam do arquivo que carrega zod + o schema inteiro (avaliado em
// toda carga do módulo) — zod ia pro bundle do cliente à toa em componentes
// que nunca fazem validação nenhuma. simulation-registration-schema.js
// continua reexportando tudo daqui, então nada do lado servidor muda.
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

// Cadastros criados sem o formulário de simulação (manual, Chat/WhatsApp, roleta) gravam valores
// padrão só para satisfazer o banco (nascimento 1900-01-01, "autônomo sem registro", "solteiro",
// "Não"…). Esses valores NÃO são informações do cliente: as telas não devem exibi-los como se
// ele tivesse preenchido. O nascimento 1900-01-01 é o marcador confiável (o formulário público
// exige data real); renda/recurso > 0 também prova preenchimento.
export const SIMULATION_PLACEHOLDER_BIRTH_DATE = "1900-01-01";

export function realBirthDate(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && text !== SIMULATION_PLACEHOLDER_BIRTH_DATE ? text : "";
}

export function hasSimulationData(registration) {
  if (!registration) return false;
  return Boolean(realBirthDate(registration.oldestBirthDate))
    || Number(registration.primaryMonthlyIncome || 0) > 0
    || Number(registration.secondaryMonthlyIncome || 0) > 0
    || Number(registration.availablePurchaseResource || 0) > 0;
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

export function isFutureDate(value) {
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return Number.isNaN(date.getTime()) || date > today;
}
