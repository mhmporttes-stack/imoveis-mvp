// Quem vê quais conversas do Chat (regra do dono, 2026-10-02). Puro e
// testado (tests/whatsapp-chat-scope.test.mjs); lib/whatsapp-chat.js aplica em
// TODA leitura (lista, busca, contadores, detalhe, mídia, responder, reagir,
// editar, apagar) — a tela nunca decide. Igual no app do celular, app do
// computador e navegador (mesma API).
//
// - Administrador geral: tudo.
// - Gestor: as próprias conversas + as da equipe dele. Equipe = relação já
//   existente no CRM (admin_users.manager_id, e associados dos corretores
//   dele) — `managedUserIds`, calculado a cada requisição por
//   attachDataAccessScope (lib/admin-profiles.js): trocar o gestor de um
//   corretor muda o acesso na hora.
// - Corretor: só as próprias. Associado: as do corretor a que está vinculado
//   (comportamento anterior, mantido).
// "Conversa de X" = atribuída a X no Chat OU de cliente cujo responsável é X.
//
// Mensagens do WhatsApp INDIVIDUAL de outra pessoa (sessão de alguém fora do
// escopo) ficam ocultas mesmo numa conversa visível: o WhatsApp pessoal de
// alguém não aparece para quem não é da linha dele (ex.: conversa do dono
// com um corretor no cartão de um cliente de outro corretor).

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

// Chave de sessão da conversa (whatsapp_conversations.session_key, 2026-10-02):
// a identidade de uma conversa é (telefone do contato + número/sessão do
// WhatsApp que conversa com ele). EMPTY_UUID = número oficial / sem sessão
// pessoal; qualquer outro valor = admin_users.id do dono do WhatsApp pessoal.
// Um mesmo cliente que fala com dois WhatsApps tem DUAS conversas.
export const OFFICIAL_SESSION_KEY = EMPTY_UUID;

// Dono da sessão da conversa, ou null quando é do número oficial.
export function conversationSessionOwner(row) {
  const key = row?.session_key || row?.sessionKey || "";
  return key && key !== EMPTY_UUID ? key : null;
}

// Ids que podem ser dono de uma sessão dentro do escopo (sem o id vazio, que
// é o "ninguém" do escopo sem perfil e coincide com a chave do oficial).
export function scopeSessionIds(scope) {
  return (scope?.ids || []).filter((id) => id && id !== EMPTY_UUID);
}

export function buildChatScope({ generalAdmin = false, manager = false, broker = false, profileId = "", managedUserIds = null, linkedBrokerId = "" } = {}) {
  if (generalAdmin) return { all: true, supervisor: true, ids: [] };
  if (manager && profileId) {
    const ids = [...new Set([profileId, ...(Array.isArray(managedUserIds) ? managedUserIds : [])].filter(Boolean))];
    return { all: false, supervisor: true, ids };
  }
  if (broker && profileId) return { all: false, supervisor: false, ids: [profileId, linkedBrokerId].filter(Boolean) };
  return { all: false, supervisor: false, ids: [EMPTY_UUID] };
}

export function canSeeConversation(scope, { assignedUserId = null, responsibleUserId = null, sessionKey = null } = {}) {
  if (scope?.all) return true;
  const ids = scope?.ids || [];
  // Conversa de um WhatsApp pessoal: só quem é da linha dele (o dono, o
  // gestor dele, o administrador). Atribuição ou "responsável pelo cliente"
  // NÃO dão acesso à conversa de OUTRO número.
  const owner = conversationSessionOwner({ session_key: sessionKey });
  if (owner) return ids.includes(owner);
  return Boolean((assignedUserId && ids.includes(assignedUserId)) || (responsibleUserId && ids.includes(responsibleUserId)));
}

// Mensagem dentro de uma conversa já visível.
export function canSeeMessage(scope, row) {
  if (scope?.all) return true;
  if (!row?.session_user_id) return true; // número oficial / interna / automação
  return (scope?.ids || []).includes(row.session_user_id);
}

// Filtro "um corretor específico" da Supervisão: só dentro do próprio escopo.
// -> id permitido, "" (sem filtro) ou null (pedido fora do escopo = nada).
export function allowedBrokerFilter(scope, brokerId) {
  if (!brokerId) return "";
  if (scope?.all) return brokerId;
  if (scope?.supervisor && (scope.ids || []).includes(brokerId)) return brokerId;
  return null;
}

// Atribuir a conversa a alguém: gestor só dentro da equipe dele.
export function canAssignTo(scope, targetUserId) {
  if (!targetUserId) return true;
  if (scope?.all) return true;
  return Boolean(scope?.supervisor && (scope.ids || []).includes(targetUserId));
}

// Quem "responde" por uma conversa (contadores por corretor): o dono da
// sessão, se for conversa de WhatsApp pessoal; senão atribuído/responsável.
export function conversationOwnerIds({ sessionKey = null, assignedUserId = null, responsibleUserId = null } = {}) {
  const owner = conversationSessionOwner({ session_key: sessionKey });
  if (owner) return [owner];
  return [assignedUserId, responsibleUserId].filter(Boolean);
}
