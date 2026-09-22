import { SIMULATION_MODEL_TYPES, normalizeSimulationModels } from "./simulation-models";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";

export function normalizeMoneyValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, roundMoney(value));
  if (typeof value !== "string") return 0;

  const text = value.trim();
  if (!text) return 0;

  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : 0;
}

export function formatMoneyBR(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(normalizeMoneyValue(value));
}

export function calculatePurchasePower({ financing = 0, ownResource = 0, subsidy = 0 } = {}) {
  return roundMoney(
    normalizeMoneyValue(financing) +
    normalizeMoneyValue(ownResource) +
    normalizeMoneyValue(subsidy)
  );
}

export function hasOwnResource(value) {
  return normalizeMoneyValue(value) > 0;
}

export function getOwnResourceValue(simulation = {}) {
  const source = simulation || {};
  return roundMoney(
    normalizeMoneyValue(source.downPaymentValue) +
    normalizeMoneyValue(source.fgtsValue)
  );
}

export function getSimulationListSummary(simulation = {}) {
  const source = simulation || {};
  const ownResource = getOwnResourceValue(source);
  const models = normalizeSimulationModels(source.simulationModels, source);
  const validModels = SIMULATION_MODEL_TYPES.map(({ key }) => {
    const model = models[key] || {};
    const financing = normalizeMoneyValue(model.financingValue);
    const subsidy = normalizeMoneyValue(model.subsidyValue);
    const purchasePower = calculatePurchasePower({ financing, ownResource, subsidy });

    return {
      financing,
      ownResource,
      subsidy,
      purchasePower
    };
  }).filter((model) => model.financing > 0 || model.subsidy > 0);

  if (!validModels.length) {
    return {
      completed: false,
      financing: 0,
      ownResource: 0,
      subsidy: 0,
      purchasePower: 0,
      components: []
    };
  }

  const primary = validModels[0];
  return {
    completed: true,
    ...primary,
    components: buildFinancialComponents(primary)
  };
}

export function hasCompletedSimulation(simulation = {}) {
  return getSimulationListSummary(simulation || {}).completed;
}

export function extractSimulationPhone(simulation = {}) {
  const source = simulation || {};
  const note = String(source.internalNote || "");
  const match = note.match(/WhatsApp do cadastro:\s*([+\d\s().-]+)/i);
  return normalizePhone(match?.[1] || "");
}

export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildFinancialComponents(summary) {
  return [
    summary.financing > 0 ? `Financiamento: ${formatMoneyBR(summary.financing)}` : "",
    hasOwnResource(summary.ownResource) ? `Recurso próprio: ${formatMoneyBR(summary.ownResource)}` : "",
    summary.subsidy > 0 ? `Subsídio: ${formatMoneyBR(summary.subsidy)}` : ""
  ].filter(Boolean);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

// Movido de components/AdminSimulationList.jsx (era local ao componente) para
// ser reaproveitado também pela consulta server-side da listagem
// (lib/simulation-list-query.js), sem duplicar a regra de resolução de status.
export function resolveClientStatus(registration, summary) {
  const storedStatus = normalizeClientStatus(registration?.status);
  if (registration?.status && storedStatus !== CLIENT_STATUS.PENDING) return storedStatus;
  return summary?.completed ? CLIENT_STATUS.COMPLETED : CLIENT_STATUS.PENDING;
}

export function isCompletedClientStatus(status) {
  return [
    CLIENT_STATUS.COMPLETED,
    CLIENT_STATUS.SIMULATION_SENT,
    CLIENT_STATUS.IN_SERVICE,
    CLIENT_STATUS.AWAITING_RETURN,
    CLIENT_STATUS.DOCUMENTATION,
    CLIENT_STATUS.DOCUMENTS_PENDING,
    CLIENT_STATUS.APPROVAL_PENDING,
    CLIENT_STATUS.SHIELDING,
    CLIENT_STATUS.APPROVED,
    CLIENT_STATUS.REJECTED,
    CLIENT_STATUS.SALE_COMPLETED,
    CLIENT_STATUS.SALE_FORMS,
    CLIENT_STATUS.SALE_RESERVATION,
    CLIENT_STATUS.SALE_CONTRACT,
    CLIENT_STATUS.SALE_CAIXA_SIGNATURE,
    CLIENT_STATUS.SALE_ITBI,
    CLIENT_STATUS.SALE_REGISTRY,
    CLIENT_STATUS.SALE_PAYMENT
  ].includes(status);
}
