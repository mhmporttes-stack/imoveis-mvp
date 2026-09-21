// Fonte única dos motivos de "Não contactar novamente" — lib/daily-goal-wallet.js
// é "server-only" (não pode ser importado por um Client Component), então a
// tela de Clientes (components/AdminSimulationList.jsx) reescrevia essa lista
// à mão; se alguém mudasse os motivos só no backend, a tela continuaria
// oferecendo os antigos.
export const DO_NOT_CONTACT_REASONS = {
  client_requested: "Cliente solicitou",
  invalid_number: "Número inválido",
  already_purchased: "Já adquiriu imóvel",
  not_interested: "Sem interesse",
  wrong_contact: "Contato incorreto",
  other: "Outro"
};

export function getDoNotContactReasonOptions() {
  return Object.entries(DO_NOT_CONTACT_REASONS).map(([key, label]) => ({ key, label }));
}
