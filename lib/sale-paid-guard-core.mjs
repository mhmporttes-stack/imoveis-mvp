// "Pago" só pelo dono (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, FIN-7): colocar o cliente no status "Pago"
// (sale_paid) grava a comissão bruta como RECEBIDA (markFinancialSaleReceivedForRegistration, lib/financial.js), então
// só a conta REAL do dono pode fazer isso — nunca outro admin, gestor, corretor, associado, automação sem usuário nem o
// dono em "Alterar conta" (lá o e-mail efetivo é o do perfil emulado e accountSwitchMode = true). Regra pura: quem
// decide se o e-mail é do dono é injetado (isOwnerAdminEmail), para o teste não depender do servidor.

export const SALE_PAID_OWNER_ONLY_MESSAGE = "Somente o dono pode colocar o cliente em \"Pago\": essa etapa lança a comissão como recebida no Financeiro. Avise o dono quando o pagamento cair.";
export const SALE_PAID_FUTURE_DATE_MESSAGE = "A data do recebimento não pode ser no futuro. Informe o dia em que o pagamento foi recebido.";

export function canMarkSalePaid(auth, isOwnerEmail) {
  if (!auth || auth.accountSwitchMode || typeof isOwnerEmail !== "function") return false;
  return Boolean(isOwnerEmail(auth.user?.email));
}

function failure(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// Barreira do servidor, chamada ANTES de gravar a mudança para "Pago". `receivedDate`/`today` em YYYY-MM-DD
// (America/Sao_Paulo); data vazia = hoje (comportamento de sempre), data futura recusada.
export function assertSalePaidAllowed({ auth, isOwnerEmail, receivedDate = "", today = "" } = {}) {
  if (!canMarkSalePaid(auth, isOwnerEmail)) throw failure(SALE_PAID_OWNER_ONLY_MESSAGE, 403, "SALE_PAID_OWNER_ONLY");
  const date = String(receivedDate || "").trim().slice(0, 10);
  if (date && today && date > today) throw failure(SALE_PAID_FUTURE_DATE_MESSAGE, 400, "SALE_PAID_FUTURE_DATE");
}
