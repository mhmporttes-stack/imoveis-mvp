// BASE ÚNICA para reconhecer comissão RECEBIDA de uma venda. Puro (sem banco/React), em centavos.
//
// Regra (dono, Saúde 2026-10-02: "comissão recebida = comissão BRUTA efetivamente recebida"; nota fiscal,
// repasses e despesas saem DEPOIS, como deduções do que entrou — docs/FINANCEIRO_SAUDE.md):
//   • o alvo de recebimento de uma venda é a comissão BRUTA;
//   • recebido = soma dos pagamentos com status "received";
//   • venda "recebida" (financial_status = received) ⇔ recebido ≥ alvo;
//   • saldo a receber = max(0, alvo − recebido).
//
// Antes desta base única havia DUAS: `deriveFinancialStatus`/reparo do "Pago" usavam a bruta e a
// Previsão/Confirmar recebimento/"A receber" usavam a comissão LIVRE (bruta − nota − despesas). Com nota
// ou despesa na venda, confirmar a previsão (livre) marcava "Recebido" e, ao mover o cliente para "Pago",
// o reparo lançava a diferença até a bruta — um recebimento automático de dinheiro que ninguém confirmou
// (dupla contagem em "Recebido no mês"). Toda decisão "quanto falta / já recebeu tudo?" passa por aqui.
//
// A comissão LIVRE continua existindo para a DISTRIBUIÇÃO (gestor/corretor/imobiliária) — não é base de
// recebimento.

export const toCents = (value) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

export const fromCents = (cents) => Math.round(cents) / 100;

export function receiptTargetCents(grossCommission) {
  return Math.max(0, toCents(grossCommission));
}

export function receivedCentsOf(payments = []) {
  return (Array.isArray(payments) ? payments : [])
    .filter((payment) => payment?.status === "received")
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
}

export function remainingToReceiveCents({ grossCommission = 0, payments = [] } = {}) {
  return Math.max(0, receiptTargetCents(grossCommission) - receivedCentsOf(payments));
}

export function isFullyReceived({ grossCommission = 0, payments = [] } = {}) {
  const target = receiptTargetCents(grossCommission);
  return target > 0 && receivedCentsOf(payments) >= target;
}
