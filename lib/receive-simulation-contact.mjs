// Puro (sem banco, sem "server-only") — decide para onde o botão "Receber
// minha simulação" (tela final do formulário) leva o cliente. Testado em
// tests/receive-simulation-contact.test.mjs.
//
// Regra do dono (WA-10, 2026-10-01, docs/BUSINESS_RULES.md): o botão abre o
// WhatsApp do corretor RESPONSÁVEL pelo cadastro recém-criado — inclusive
// quando ele foi escolhido pela roleta. Nunca abre o WhatsApp de outro
// corretor, do Matheus ou do número oficial "por reserva":
//   - sem responsável (fila de espera da roleta)  -> "waiting"
//   - responsável inativo, sem telefone ou com
//     telefone inválido                           -> "unavailable"
//   - responsável ativo com WhatsApp válido        -> "ready" + phone
export const RECEIVE_CONTACT_STATE = {
  READY: "ready",
  WAITING: "waiting",
  UNAVAILABLE: "unavailable"
};

// `broker`: { status, whatsappDigits } do responsável (whatsappDigits já
// normalizado por toWhatsAppDigits — "" quando inválido).
export function resolveReceiveSimulationContact({ responsibleUserId, broker } = {}) {
  if (!responsibleUserId) return { state: RECEIVE_CONTACT_STATE.WAITING };
  const digits = String(broker?.whatsappDigits || "");
  if (!broker || broker.status !== "active" || !/^55\d{10,11}$/.test(digits)) {
    return { state: RECEIVE_CONTACT_STATE.UNAVAILABLE };
  }
  return { state: RECEIVE_CONTACT_STATE.READY, phone: digits };
}
