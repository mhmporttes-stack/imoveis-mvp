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

// Abrir a conversa marca como lida? Mesma regra de markChatConversationRead (lib/whatsapp-chat.js): quem supervisiona
// (admin geral/gestor) só marca a conversa que é DELE; corretor/associado marca a que ele enxerga. Conversa sem dono
// (Roleta) nunca é marcada por abrir. viewerId = perfil efetivo (em "Alterar conta", o corretor emulado).
// Usado pelo Chat do Marketplace (dono, 2026-10-22: "eu abrir a conversa não deve marcar como lida").
export function marksReadOnOpen(scope, { ownerId = null, viewerId = null } = {}) {
  if (!ownerId) return false;
  if (scope?.supervisor) return Boolean(viewerId) && ownerId === viewerId;
  return canSeeConversation(scope, { assignedUserId: ownerId });
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

// Cliente ARQUIVADO (WA-13): quem pode ler o histórico oculto. A conversa é "de
// cliente arquivado" se está oculta E (tem a marca do gatilho OU o cliente está
// arquivado agora). Retorna "none" (não é conversa de arquivado — segue a regra
// normal), "read" (dono: lê tudo, somente leitura) ou "empty" (qualquer outro,
// inclusive o corretor responsável: Chat vazio, nenhum dado).
export function archivedConversationAccess({ conversation, clientStatus = null, isOwner = false } = {}) {
  if (!conversation?.deleted_at) return "none";
  const archived = Boolean(conversation.origin?.archived_hidden_at) || clientStatus === "archived";
  if (!archived) return "none";
  return isOwner ? "read" : "empty";
}

// Histórico de cliente ARQUIVADO: leitura EXCLUSIVA da conta do dono, por
// identidade única (id do usuário no Supabase Auth) — NUNCA por cargo/perfil
// (outro admin, gestor e corretor ficam de fora). Usa a sessão REAL
// (`realUser`, antes do "Alterar conta"), para que trocar de conta não
// transfira nem conceda o acesso a outro perfil.
export const ARCHIVED_CHAT_VIEWER_AUTH_USER_ID = "60284207-204f-4396-9627-67d6c707b774";

export function isArchivedChatViewer(auth) {
  const sessionUser = auth?.realUser || auth?.user;
  return Boolean(sessionUser?.id) && sessionUser.id === ARCHIVED_CHAT_VIEWER_AUTH_USER_ID;
}

// Histórico do atendimento anterior (FUN-15g — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-16): o corretor que recebe
// um cliente TRANSFERIDO (fluxo de clientes que esfriaram, transferência manual, "Devolver para a roleta" e
// "Ninguém (liberar)" do Chat e toda redistribuição automática — ver lastResponsibleTransferCut abaixo) lê, SOMENTE LEITURA e por referência (nada é copiado),
// as conversas que o cliente teve com o corretor anterior até o momento da transferência. Única ampliação de
// visibilidade fora da regra acima — QUEM pode pedir (novo responsável e quem já vê o cliente) é checado em
// lib/cooled-clients.js (getCooledChatHistory). Aqui: QUAIS conversas e mensagens entram.
// Conversa: ligada a ESTE cliente, não Particular, não excluída, não grupo; do número oficial ou de um número
// (1 ou 2) do corretor anterior — WhatsApp pessoal de qualquer outra pessoa fica fora.
export function transferHistoryConversationAllowed(conversation, { clientId = "", previousBrokerId = "" } = {}) {
  if (!conversation || !clientId || !previousBrokerId) return false;
  if (conversation.client_id !== clientId) return false;
  if (conversation.private_at || conversation.deleted_at) return false;
  if (String(conversation.contact_phone || "").startsWith("group:")) return false;
  const owner = conversationSessionOwner(conversation);
  return !owner || owner === previousBrokerId;
}

// Mensagem: só a conversa com o cliente (nada de nota interna nem reação), nada apagado para todos, nada de outro
// WhatsApp pessoal, só até a transferência (cutoffAt) e nada anterior ao destrancamento do contato (history_cutoff_at).
export function transferHistoryMessageAllowed(row, { previousBrokerId = "", cutoffAt = null, historyCutoffAt = null } = {}) {
  if (!row || row.direction === "internal" || row.message_type === "reaction") return false;
  if (row.metadata?.revoked_at) return false;
  if (row.session_user_id && row.session_user_id !== previousBrokerId) return false;
  const at = Date.parse(row.message_at || "");
  if (!Number.isFinite(at)) return false;
  if (cutoffAt && at > Date.parse(cutoffAt)) return false;
  if (historyCutoffAt && at < Date.parse(historyCutoffAt)) return false;
  return true;
}

// FUN-15o (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26): o mesmo histórico aparece também DENTRO do Chat, na conversa
// do novo responsável ("o histórico deve aparecer ali só com visualização"). Mesma leitura (getCooledChatHistory);
// aqui só se tira a conversa que já está aberta na tela, para não repetir as mensagens dela. Nada mais muda.
export function transferHistoryOutsideConversation(history, openConversationId = "") {
  if (!history || !Array.isArray(history.conversations)) return null;
  const conversations = history.conversations.filter((conversation) => conversation && conversation.id !== openConversationId);
  return conversations.length ? { ...history, conversations } : null;
}

// FUN-15g estendida (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16): o mesmo histórico vale para a TRANSFERÊNCIA MANUAL
// de responsável (admin/gestor pela ficha, pelo Chat ou ao excluir usuário: responsible_transferred "manual"/
// "distributed"), para o "Devolver para a roleta" (responsible_transferred "roulette", inclusive o do FUN-15), para o
// "Ninguém (liberar)" do Chat (lead_distribution_history com source "whatsapp_chat_release") e para o caso do FUN-15
// (cooled_client_cases). ~~Redistribuição AUTOMÁTICA não é corte~~ — passou a ser (dono, 2026-10-16): ver
// lastResponsibleTransferCut abaixo, que é o que o histórico usa hoje.
// Recebe os cortes candidatos ({ previousUserId, at, source }) e devolve o MAIS RECENTE válido (ou null).
export const TRANSFER_HISTORY_JOURNEY_TYPES = ["manual", "distributed", "roulette"];
export const TRANSFER_HISTORY_RELEASE_SOURCE = "whatsapp_chat_release";

export function latestTransferHistoryCut(candidates = []) {
  let best = null;
  for (const candidate of candidates || []) {
    const time = Date.parse(candidate?.at || "");
    if (!candidate?.previousUserId || !Number.isFinite(time)) continue;
    if (!best || time > best.time) best = { previousUserId: candidate.previousUserId, at: candidate.at, source: candidate.source || "", time };
  }
  return best ? { previousUserId: best.previousUserId, at: best.at, source: best.source } : null;
}

// FUN-15h ampliada (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16: "deve mostrar sim, inclusive as que já foram transferidas
// pela regra"): TODA troca de responsável por redistribuição AUTOMÁTICA também é corte — prazo vencido (REDISTRIBUIÇÃO
// DE LEADS), ida e saída da fila de espera da roleta, anúncio (resposta/formulário/silêncio), Fluxos e "Ninguém
// (liberar)" — e vale para as já feitas, porque o corte é calculado na LEITURA de lead_distribution_history (existe
// desde 2026-09-07, com backfill). O corte é a ÚLTIMA troca de responsável registrada (pessoa ou automação):
//  - client_journey_events responsible_transferred (fromId → toId);
//  - cooled_client_cases transferido (broker_id = anterior; espelho do "Devolver para a roleta" do FUN-15);
//  - lead_distribution_history com to_user_id (from_user_id → to_user_id). Entrega pela fila de espera
//    (details.fromWaitingQueue, gravada sem from_user_id): o anterior é quem SEGURAVA o cliente na fila, lido do
//    registro que o colocou lá (details.toWaitingQueue/heldByOwner, "Devolver para a roleta" com waitingQueue, ou anúncio
//    sem corretor on-line: to_user_id vazio + waitingForBroker → from_user_id). Sem esse registro, anterior desconhecido.
// Se a última troca não tem anterior conhecido (cadastro novo, fila de espera sem registro de entrada, cliente que estava
// sem responsável), NÃO há corte — nunca cai num corte mais antigo, que mostraria a conversa de outra pessoa como se
// fosse a do anterior. Trocas para a mesma pessoa (de = para) são ignoradas.
export function lastResponsibleTransferCut({ journey = [], distribution = [], cooled = [] } = {}) {
  const entries = [];
  const push = (entry) => {
    const time = Date.parse(entry.at || "");
    if (Number.isFinite(time)) entries.push({ ...entry, time, order: entries.length });
  };
  for (const row of journey || []) {
    const details = row?.details || {};
    push({ at: row?.occurred_at, previousUserId: details.fromId || "", toUserId: details.toId || "", source: `journey:${details.transferType || ""}`, queueEntry: details.waitingQueue === true });
  }
  for (const row of cooled || []) {
    push({ at: row?.decided_at || row?.closed_at, previousUserId: row?.broker_id || "", toUserId: "", source: "cooled", mirror: true });
  }
  for (const row of distribution || []) {
    const details = row?.details || {};
    const from = row?.from_user_id || "";
    const to = row?.to_user_id || "";
    if (!to) {
      // Anúncio liberado sem ninguém on-line: o cliente continua com quem o segurava (from) na fila de espera.
      if (details.waitingForBroker === true && !details.deliveredByQueue && from) push({ at: row?.created_at, queueHolderOnly: from });
      continue;
    }
    // Entrega da fila de reativação do FUN-15l (dono, 2026-10-17): o "anterior" é o corretor do FUN-15
    // (details.historyPreviousUserId), não o dono que só segurou a fila nem quem perdeu o cliente em 3 min sem mensagem.
    const historyPrevious = typeof details.historyPreviousUserId === "string" ? details.historyPreviousUserId : "";
    push({
      at: row?.created_at,
      previousUserId: historyPrevious || from,
      inferFromQueue: !historyPrevious && !from && details.fromWaitingQueue === true,
      toUserId: to,
      source: `distribution:${row?.event_type || ""}${details.source ? `:${details.source}` : ""}`,
      queueEntry: details.toWaitingQueue === true || details.heldByOwner === true
    });
  }
  entries.sort((a, b) => a.time - b.time || a.order - b.order);

  let queueHolder = "";
  let last = null;
  for (const entry of entries) {
    if (entry.queueHolderOnly) { queueHolder = entry.queueHolderOnly; continue; }
    const previousUserId = entry.inferFromQueue ? queueHolder : entry.previousUserId;
    if (!entry.mirror) queueHolder = entry.queueEntry ? entry.toUserId : "";
    if (entry.toUserId && previousUserId && previousUserId === entry.toUserId) continue;
    last = { previousUserId, at: entry.at, source: entry.source };
  }
  return last?.previousUserId ? last : null;
}
