// "Não contactar" — fonte ÚNICA dos campos gravados ao marcar um cliente/
// contato da fila como "não contactar", qualquer que seja a origem (botão da
// Prospecção/card do cliente, opt-out automático pelo WhatsApp, "Não tem
// interesse" da pendência de resposta). Puro, testado em
// tests/do-not-contact-core.test.mjs.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02] "Não contactar" BLOQUEIA novas
// prospecções/automação, mas NUNCA remove a atribuição: o responsável do
// cliente (simulation_registrations.responsible_user_id) e o corretor do
// contato na fila (prospecting_contacts.assigned_user_id) continuam os mesmos —
// o cliente segue pesquisável e acessível na ficha pelo responsável, com
// histórico, e pode ser reativado no futuro. Por isso nenhum patch abaixo
// contém campo de atribuição.

export const DO_NOT_CONTACT_STATUS = "do_not_contact";

// Cadastro do cliente.
export function clientDoNotContactPatch(nowIso) {
  return { status: DO_NOT_CONTACT_STATUS, last_status_change_at: nowIso };
}

// Linha(s) da fila de prospecção: sai da fila (sem data de retorno) e fica
// bloqueada para reivindicação/envio automático.
export function contactDoNotContactPatch(nowIso, doNotContactBy = null) {
  const patch = { status: DO_NOT_CONTACT_STATUS, do_not_contact_at: nowIso, available_after: null, updated_at: nowIso };
  if (doNotContactBy) patch.do_not_contact_by = doNotContactBy;
  return patch;
}

// Resposta automática a mensagem RECEBIDA (Fluxos do WhatsApp e resposta por
// palavra-chave): "Não contactar" bloqueia mesmo quando o cliente volta a
// escrever por conta própria — reativar é decisão humana (pendência de
// reativação, PRO-8; nunca reativa sozinho). Conservador como o lembrete do
// formulário (lib/whatsapp-form-reminder-core.mjs): basta o cliente da
// conversa, QUALQUER cadastro com o telefone ou QUALQUER linha da fila com o
// telefone estar em "Não contactar". Devolve o motivo (texto do log) ou null.
export function doNotContactInboundBlockReason({ clientStatus = null, phoneRegistrationStatuses = [], phoneContactBlocked = false } = {}) {
  if (clientStatus === DO_NOT_CONTACT_STATUS) return "cliente_nao_contactar";
  if ((phoneRegistrationStatuses || []).some((status) => status === DO_NOT_CONTACT_STATUS)) return "telefone_nao_contactar";
  if (phoneContactBlocked) return "contato_fila_nao_contactar";
  return null;
}
