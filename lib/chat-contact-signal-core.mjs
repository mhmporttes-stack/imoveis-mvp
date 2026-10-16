// "Último contato conforme o Chat" — regra PURA (testes: tests/chat-contact-signal-core.test.mjs). Servidor:
// lib/chat-contact-signal.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16] "O último contato com o cliente deve atualizar conforme o chat;
// exemplo: cliente A tem uma conversa com o corretor B hoje, automaticamente some o alerta de três dias."
// Mensagem ENVIADA pelo corretor responsável (ou associado dele) já grava simulation_registrations.last_whatsapp_contact_at
// (registerHumanContact, WA-4a). O que faltava era a mensagem RECEBIDA do cliente: ela fica em
// whatsapp_conversations.last_inbound_at e NÃO é gravada no cliente de propósito — last_whatsapp_contact_at também
// decide a redistribuição da roleta ("sem primeiro contato", ROL-4), o prazo da simulação e o crédito da Meta Diária,
// e o cliente escrever não é ação do corretor. Por isso a mensagem recebida entra como SINAL DE LEITURA, só onde o
// dono pediu: o alerta "Sem contato há +3 dias" (card, filtro e contador) e a criação de casos novos de "cliente que
// esfriou" (FUN-15). Pendências da Meta Diária (MD-8) continuam como antes.
//
// Conversa que conta = a do cliente com o lado do responsável: número oficial (sem dono), número do próprio
// responsável ou do associado vinculado a ele. Conversa apagada (cliente arquivado, WA-13) ou Particular (WA-19)
// nunca conta. Resposta no número de gestor/admin não conta para o responsável (decisão do dono, 2026-10-03).

export function isResponsibleSideConversation(conversation, responsibleUserId, associateBrokerById = new Map()) {
  if (!conversation || conversation.deleted_at || conversation.private_at) return false;
  const owner = conversation.session_user_id || "";
  if (!owner) return true; // número oficial: conversa do cliente com a equipe
  if (!responsibleUserId) return true; // cliente sem responsável: não há a quem atribuir (como contactCreditsResponsible)
  if (owner === responsibleUserId) return true;
  return associateBrokerById.get(owner) === responsibleUserId;
}

function timeOf(value) {
  const at = Date.parse(value || "");
  return Number.isFinite(at) ? at : null;
}

// Mensagem do cliente mais recente nas conversas que contam (ISO) ou null.
export function latestInboundChatAt(conversations = [], responsibleUserId = "", associateBrokerById = new Map()) {
  let best = null;
  for (const conversation of conversations) {
    if (!isResponsibleSideConversation(conversation, responsibleUserId, associateBrokerById)) continue;
    const at = timeOf(conversation.last_inbound_at);
    if (at !== null && (best === null || at > best)) best = at;
  }
  return best === null ? null : new Date(best).toISOString();
}

// O mais recente de dois instantes (ISO); vazio quando nenhum é válido.
export function laterContactAt(current, candidate) {
  const a = timeOf(current);
  const b = timeOf(candidate);
  if (b === null) return current || "";
  if (a === null || b > a) return new Date(b).toISOString();
  return current;
}
