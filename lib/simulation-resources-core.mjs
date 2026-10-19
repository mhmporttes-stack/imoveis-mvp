// Entrada e FGTS disponíveis da simulação (pedido do dono, 2026-10-19): informados SÓ no cadastro do cliente
// (`simulation_registrations.available_purchase_resource` e `available_fgts_balance`), não mais na aba da simulação.
// A simulação lê do cadastro; simulação antiga com valores PRÓPRIOS (`simulations.down_payment_value`/`fgts_value` > 0)
// continua mostrando os dela (nada se perde). Puro e testado.

function money(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  const normalized = String(value ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

/**
 * { downPaymentValue, fgtsValue, source } — `source`: "simulacao" (valores próprios antigos), "cadastro" ou "nenhum".
 * `simulation` traz os valores GRAVADOS na simulação; `registration` o cadastro (camelCase) ou null.
 */
export function resolveSimulationResources(simulation = {}, registration = null) {
  const ownDown = money(simulation?.downPaymentValue);
  const ownFgts = money(simulation?.fgtsValue);
  if (ownDown > 0 || ownFgts > 0) return { downPaymentValue: ownDown, fgtsValue: ownFgts, source: "simulacao" };
  if (!registration) return { downPaymentValue: 0, fgtsValue: 0, source: "nenhum" };
  return {
    downPaymentValue: money(registration.availablePurchaseResource),
    fgtsValue: money(registration.availableFgtsBalance),
    source: "cadastro"
  };
}

/**
 * Valores a GRAVAR na simulação ao salvar. A aba não manda mais entrada/FGTS (campos só no cadastro): sem os campos no
 * corpo, mantém os gravados. Com os campos (tela antiga aberta) iguais aos que vieram do cadastro, grava zero (a
 * simulação continua lendo do cadastro); diferentes = valor digitado na tela antiga, guardado como próprio.
 */
export function resourcesToStore(payload = {}, current = {}) {
  const sent = payload.downPaymentValue !== undefined || payload.fgtsValue !== undefined;
  const stored = { downPaymentValue: money(current.storedDownPaymentValue ?? current.downPaymentValue), fgtsValue: money(current.storedFgtsValue ?? current.fgtsValue) };
  if (!sent) return stored;
  const next = { downPaymentValue: money(payload.downPaymentValue), fgtsValue: money(payload.fgtsValue) };
  if (current.resourcesSource === "cadastro" && next.downPaymentValue === money(current.downPaymentValue) && next.fgtsValue === money(current.fgtsValue)) {
    return { downPaymentValue: 0, fgtsValue: 0 };
  }
  return next;
}
