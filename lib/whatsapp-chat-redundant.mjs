import { OFFICIAL_SESSION_KEY, canSeeConversation } from "./whatsapp-chat-scope.mjs";

// Entrada REDUNDANTE da listagem do Chat (regra do dono, 2026-10-02) — só
// apresentação, nenhum dado é alterado ou apagado. Caso real: conversa do
// número oficial que ficou só com um envio que FALHOU (nunca entregue) depois
// que as mensagens recebidas foram para a conversa pessoal correta (telefone +
// sessão). Ela é escondida da lista normal quando:
//  - é do número oficial (chave de sessão vazia);
//  - NÃO tem nenhuma mensagem útil: recebida, nota interna ou envio que não
//    falhou (conversa vazia também conta como sem mensagem útil);
//  - existe, para o MESMO telefone, uma conversa de WhatsApp pessoal que quem
//    olha enxerga (se não enxerga a pessoal, a entrada continua aparecendo).
// A conversa continua acessível por id (histórico, auditoria, links diretos).

// Mensagem "útil" = qualquer uma, exceto envio (outbound) com status "failed".
export function isUsefulMessage(message) {
  if (!message) return false;
  return !(message.direction === "outbound" && message.status === "failed");
}

// rows: conversas { id, contact_phone, session_key }
// personalSiblings: conversas pessoais existentes { contact_phone, session_key }
// usefulConversationIds: Set de ids (das conversas oficiais candidatas) com mensagem útil
// -> Set de ids a esconder
export function redundantOfficialConversationIds({ rows = [], personalSiblings = [], usefulConversationIds = new Set(), scope = null } = {}) {
  const visiblePersonalPhones = new Set(
    personalSiblings
      .filter((sibling) => sibling?.session_key && sibling.session_key !== OFFICIAL_SESSION_KEY && canSeeConversation(scope, { sessionKey: sibling.session_key }))
      .map((sibling) => sibling.contact_phone)
  );
  const hidden = new Set();
  for (const row of rows) {
    if (!row || (row.session_key && row.session_key !== OFFICIAL_SESSION_KEY)) continue;
    if (!visiblePersonalPhones.has(row.contact_phone)) continue;
    if (usefulConversationIds.has(row.id)) continue;
    hidden.add(row.id);
  }
  return hidden;
}
