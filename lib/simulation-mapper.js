import {
  extractSimulationModelsFromNote,
  mergeSimulationModelsIntoNote,
  removeSimulationModelsFromNote
} from "./simulation-models";

export const DEFAULT_RECOMMENDATION_REASON =
  "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra e proporcionar o melhor aproveitamento das condições disponíveis.";

export function rowToSimulation(row, properties = []) {
  const internalNote = row.internal_note || "";

  return {
    id: row.id,
    clientName: row.client_name || "",
    simulationType: row.simulation_type || "novo",
    financingValue: numberValue(row.financing_value),
    subsidyValue: numberValue(row.subsidy_value),
    firstInstallment: numberValue(row.first_installment),
    lastInstallment: numberValue(row.last_installment),
    downPaymentValue: numberValue(row.down_payment_value),
    fgtsValue: numberValue(row.fgts_value),
    totalPurchasePower: numberValue(row.total_purchase_power),
    expandedPurchasePower: numberValue(row.expanded_purchase_power),
    showExpandedPower: row.show_expanded_power === true,
    simulationDate: row.simulation_date || "",
    publicNote: row.public_note || "",
    internalNote: removeSimulationModelsFromNote(internalNote),
    simulationModels: extractSimulationModelsFromNote(internalNote),
    outputMode: row.output_mode || "individual",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    properties
  };
}

export function simulationToRecord(simulation, userEmail = "") {
  const financingValue = moneyNumber(simulation.financingValue);
  const subsidyValue = moneyNumber(simulation.subsidyValue);
  const downPaymentValue = moneyNumber(simulation.downPaymentValue);
  const fgtsValue = moneyNumber(simulation.fgtsValue);
  const totalPurchasePower = financingValue + subsidyValue;
  const expandedPurchasePower = totalPurchasePower + downPaymentValue + fgtsValue;

  return {
    client_name: text(simulation.clientName) || "Cliente sem nome",
    simulation_type: ["novo", "usado"].includes(simulation.simulationType) ? simulation.simulationType : "novo",
    financing_value: financingValue,
    subsidy_value: subsidyValue,
    first_installment: moneyNumber(simulation.firstInstallment),
    last_installment: moneyNumber(simulation.lastInstallment),
    down_payment_value: downPaymentValue,
    fgts_value: fgtsValue,
    total_purchase_power: totalPurchasePower,
    expanded_purchase_power: expandedPurchasePower,
    show_expanded_power: simulation.showExpandedPower === true,
    simulation_date: text(simulation.simulationDate) || new Date().toISOString().slice(0, 10),
    public_note: text(simulation.publicNote),
    internal_note: simulation.simulationModels
      ? mergeSimulationModelsIntoNote(text(simulation.internalNote), simulation.simulationModels)
      : text(simulation.internalNote),
    output_mode: simulation.outputMode === "comparativo" ? "comparativo" : "individual",
    created_by: text(simulation.createdBy) || text(userEmail)
  };
}

export function simulationPropertyToRecord(property, simulationId, order = 0) {
  return {
    simulation_id: simulationId,
    property_id: text(property.propertyId),
    display_order: integerValue(property.displayOrder, order),
    custom_name: text(property.customName),
    custom_price: text(property.customPrice),
    custom_location: text(property.customLocation),
    custom_type: text(property.customType),
    custom_area: text(property.customArea),
    custom_bedrooms: text(property.customBedrooms),
    custom_builder: text(property.customBuilder),
    custom_delivery: text(property.customDelivery),
    custom_terms: text(property.customTerms),
    custom_discounts: text(property.customDiscounts),
    custom_sales_text: text(property.customSalesText),
    recommendation_reason: text(property.recommendationReason) || DEFAULT_RECOMMENDATION_REASON,
    image_url: text(property.imageUrl),
    layout_mode: property.layoutMode === "comparativo" ? "comparativo" : "individual"
  };
}

export function rowToSimulationProperty(row, benefits = []) {
  return {
    id: row.id,
    propertyId: row.property_id || "",
    displayOrder: row.display_order ?? 0,
    customName: row.custom_name || "",
    customPrice: row.custom_price || "",
    customLocation: row.custom_location || "",
    customType: row.custom_type || "",
    customArea: row.custom_area || "",
    customBedrooms: row.custom_bedrooms || "",
    customBuilder: row.custom_builder || "",
    customDelivery: row.custom_delivery || "",
    customTerms: row.custom_terms || "",
    customDiscounts: row.custom_discounts || "",
    customSalesText: row.custom_sales_text || "",
    recommendationReason: row.recommendation_reason || DEFAULT_RECOMMENDATION_REASON,
    imageUrl: row.image_url || "",
    layoutMode: row.layout_mode || "individual",
    benefits
  };
}

export function benefitToRecord(benefit, simulationPropertyId, order = 0) {
  const textValue = typeof benefit === "string" ? benefit : benefit?.text;
  return {
    simulation_property_id: simulationPropertyId,
    benefit_text: text(textValue),
    display_order: integerValue(benefit?.displayOrder, order),
    is_custom: benefit?.isCustom === true
  };
}

export function rowToBenefit(row) {
  return {
    id: row.id,
    text: row.benefit_text || "",
    displayOrder: row.display_order ?? 0,
    isCustom: row.is_custom === true
  };
}

export function moneyNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  if (typeof value !== "string") return 0;
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
