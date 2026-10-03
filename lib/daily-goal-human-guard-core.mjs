// Núcleo PURO (testável) da trava "a cadência automática da Meta Diária não envia por cima de conversa
// humana recente" (decisão do dono, 2026-10-03).
//
// Sinais usados — todos da CONVERSA do Chat (whatsapp_conversations), nunca só last_whatsapp_contact_at
// (esse campo também é gravado pelo clique no botão WhatsApp e pela própria automação, então não prova
// mensagem humana):
//  - last_human_reply_at: uma PESSOA mandou mensagem (Chat do CRM ou aplicativo do celular; automação,
//    eco da automação e histórico importado nunca marcam);
//  - last_inbound_at: o CLIENTE escreveu.
// Qualquer um dentro da janela = há conversa recente -> a mensagem automática NÃO sai (item cancelado com
// motivo claro; a rodada continua ativa e volta a ser elegível quando a conversa esfriar).
//
// A janela é um parâmetro técnico (24 h), não uma regra de negócio numerada: ajustável aqui num ponto só.

export const HUMAN_CONVERSATION_RECENT_MS = 24 * 60 * 60 * 1000;

export const HUMAN_GUARD_REASON = {
  HUMAN_RECENT: "conversa_humana_recente",
  CLIENT_RECENT: "cliente_conversando_recente"
};

function recent(value, nowMs, windowMs) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return nowMs - time < windowMs; // hora no futuro (relógio) também conta como recente
}

// conversations: linhas de whatsapp_conversations do telefone do contato (qualquer sessão).
// Devolve o motivo do bloqueio ou null (pode enviar). Pura e idempotente: a mesma entrada dá sempre a mesma saída.
export function humanConversationBlockReason(conversations, { now = Date.now(), windowMs = HUMAN_CONVERSATION_RECENT_MS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const rows = conversations || [];
  if (rows.some((row) => recent(row?.last_human_reply_at, nowMs, windowMs))) return HUMAN_GUARD_REASON.HUMAN_RECENT;
  if (rows.some((row) => recent(row?.last_inbound_at, nowMs, windowMs))) return HUMAN_GUARD_REASON.CLIENT_RECENT;
  return null;
}
