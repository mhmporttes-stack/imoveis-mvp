// Núcleo PURO (testável) do "CONTATO HUMANO" com o cliente — fonte única da regra, usada pelo Chat do
// CRM (lib/whatsapp-chat.js) e pela mensagem que o corretor manda pelo APLICATIVO do celular
// (lib/whatsapp-individual-inbound.js) através de lib/whatsapp-human-contact.js.
//
// [REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-03]
// PRIMEIRO CONTATO = entrada do lead -> primeira mensagem HUMANA efetivamente enviada ao cliente.
// NÃO conta: clique no botão WhatsApp, abertura de conversa, nota interna, mensagem automática,
// tentativa sem evidência de envio (status failed), reação, histórico importado do celular.
// Conceitos separados: (1) o cliente recebeu atendimento humano (quem quer que tenha mandado — corretor,
// gestor ou admin); (2) AUTORIA = quem realmente enviou (whatsapp_messages.sender_user_id; nunca vira o
// responsável); (3) responsável atual do cliente.

// Mensagem que prova um contato humano efetivamente enviado ao cliente.
export function isHumanContactMessage({ direction, senderType, status, messageType, metadata } = {}) {
  if (direction !== "outbound") return false; // "internal" (nota) e "inbound" nunca contam
  if (senderType !== "user") return false; // automação (Fluxo, palavra-chave, Disparo, Meta Diária) nunca conta
  if (!["sent", "delivered", "read"].includes(String(status || ""))) return false; // failed/pendente: sem evidência de envio
  const type = String(messageType || "text");
  if (type === "reaction" || type === "internal") return false;
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  if (meta.history === true) return false; // histórico importado do celular: nunca é contato novo
  if (meta.internal === true) return false;
  if (meta.automation_echo === true || meta.automation === true) return false;
  return true;
}

// A mensagem que o WhatsApp devolveu como "enviada pelo celular" é, na verdade, o eco de um envio da
// automação da Meta Diária? Compara com as linhas da fila (daily_goal_auto_queue) do MESMO corretor:
// 1) mesmo wa_message_id, ou 2) mesmo texto enviado dentro de uma janela curta em volta da hora da
// mensagem (o eco pode chegar antes de o wa_message_id ser gravado na fila).
export const AUTOMATION_ECHO_WINDOW_MS = 10 * 60 * 1000;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isAutomationEcho({ waMessageId, body, messageAt }, queueRows) {
  const id = String(waMessageId || "").trim();
  const text = normalizeText(body);
  const at = new Date(messageAt || 0).getTime();
  for (const row of queueRows || []) {
    if (id && row?.wa_message_id && String(row.wa_message_id) === id) return true;
    const started = new Date(row?.send_started_at || row?.sent_at || 0).getTime();
    if (text && row?.message_text && normalizeText(row.message_text) === text && Number.isFinite(at) && Number.isFinite(started) && started > 0 && Math.abs(at - started) <= AUTOMATION_ECHO_WINDOW_MS) return true;
  }
  return false;
}

// "Contato" só avança no tempo (idempotência: reprocessar a mesma mensagem ou uma entrega atrasada
// nunca volta o relógio para trás).
export function shouldAdvanceContactAt(currentIso, nextIso) {
  const next = new Date(nextIso || 0).getTime();
  if (!Number.isFinite(next) || next <= 0) return false;
  if (!currentIso) return true;
  const current = new Date(currentIso).getTime();
  return !Number.isFinite(current) || next > current;
}

// Quem fica registrado como autor da mudança de status causada pela mensagem (client_status_history.changed_by).
// WA-9 (mantida): o marco "Atendimento automático -> Em atendimento" fica no nome do corretor RESPONSÁVEL
// quando quem enviou é ele (ou o associado vinculado a ele). Decisão do dono (2026-10-03): resposta de
// gestor/admin/outro usuário conta como atendimento humano do cliente, mas a autoria NUNCA é atribuída ao
// corretor responsável — fica no e-mail de quem de fato enviou.
export function resolveContactChangedBy({ nextStatus, inServiceStatus, actor, responsibleUserId, responsibleEmail }) {
  const actorEmail = String(actor?.email || "").trim();
  const actorIsResponsibleSide = Boolean(responsibleUserId)
    && [actor?.userId, actor?.linkedBrokerId].filter(Boolean).includes(responsibleUserId);
  if (nextStatus === inServiceStatus && actorIsResponsibleSide) return responsibleEmail || actorEmail || "sistema";
  return actorEmail || "sistema";
}

// Cadastro do cliente a partir do TELEFONE (só quando a conversa ainda não tem client_id). Um telefone
// pode ter vários cadastros (CLI-4): sem exatamente um candidato claro, NÃO chuta (devolve null).
// - 1 cadastro -> ele;
// - vários -> só se exatamente UM for do corretor dono da conversa (ou do corretor a que o associado é vinculado);
// - cadastro arquivado nunca é vinculado (a conversa dele fica fora do Chat, WA-13).
export function pickUnambiguousRegistration(rows, { brokerIds = [] } = {}) {
  const list = (rows || []).filter((row) => row?.id);
  if (!list.length) return null;
  let chosen = null;
  if (list.length === 1) {
    chosen = list[0];
  } else {
    const ids = new Set((brokerIds || []).filter(Boolean));
    const own = list.filter((row) => row.responsible_user_id && ids.has(row.responsible_user_id));
    if (own.length === 1) chosen = own[0];
  }
  if (!chosen) return null;
  if (chosen.status === "archived") return null;
  return chosen;
}
