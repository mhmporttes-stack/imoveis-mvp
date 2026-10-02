// Leitura de valores digitados no padrão brasileiro. Puro (sem servidor/React): usado pelo servidor
// (lib/financial.js), pelo Financeiro e pelo modal de recebimento (client) e pelos testes.
//
// Causa raiz do bug "1.500 vira 1,50" (auditoria incremental 2026-10-02): sem vírgula, o texto era
// entregue direto a Number(), que lê o ponto como DECIMAL — "1.500" = 1,5 e "3.000" = 3. No padrão
// brasileiro o ponto é separador de MILHAR. Regra única, em um só lugar:
//
//   "1.500"      → 1500        (ponto + grupos de exatamente 3 dígitos = milhar)
//   "1.500,50"   → 1500.5      (vírgula = decimal; pontos = milhar)
//   "1500"       → 1500
//   "1500,50"    → 1500.5
//   "1500.50"    → 1500.5      (1–2 casas depois do ponto = decimal, como vem do banco/JSON)
//   "R$ 1.500,00"→ 1500
//   "0.500"      → 0.5         (grupo de milhar nunca começa com 0)
//
// Percentuais NÃO usam esta função (parseBrazilianDecimal): "2.125" num campo de % é 2,125, não 2125.

const THOUSANDS_ONLY = /^-?[1-9]\d{0,2}(\.\d{3})+$/;

export function parseBrazilianMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;

  let normalized;
  if (cleaned.includes(",")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (THOUSANDS_ONLY.test(cleaned)) normalized = cleaned.replace(/\./g, "");
  else normalized = cleaned;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Número decimal (percentuais): vírgula = decimal, ponto sem vírgula = decimal (sem regra de milhar).
export function parseBrazilianDecimal(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
