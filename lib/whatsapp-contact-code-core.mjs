// Código do atendimento nas mensagens prontas dos botões do link (REGRA OFICIAL — dono, 2026-10-18: "Número oficial porém
// deve ser atribuído ao corretor que fez a simulação."). Os botões de contato da apresentação `/s/<token>` (Receber lista de
// documentos, Agendar atendimento, Falar com meu corretor da Estratégia de pagamento) e o "Receber minha simulação" da tela
// final do formulário abrem o WhatsApp OFICIAL com o texto pronto + "Código do atendimento: MM-XXXXXXXX" (8 primeiros
// caracteres do id do cadastro). Quando a mensagem chega no oficial, o webhook usa o código para ligar a conversa ao MESMO
// cliente e entregá-la ao corretor responsável — mesmo se o cliente escrever de outro telefone — sem roleta e sem cliente novo
// (lib/whatsapp-contact-code.js). Puro (sem banco): testado em tests/whatsapp-contact-code.test.mjs.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /\bMM-([0-9A-F]{8})\b/i;
// Mensagem que veio de um botão do link mesmo com o código digitado errado (fallback pelo telefone do cadastro).
const MARKER_RE = /c[oó]digo do atendimento|\bMM-[0-9A-Z]/i;

export const CONTACT_CODE_LABEL = "Código do atendimento";

/** "MM-1A2B3C4D" a partir do id (uuid) do cadastro; "" quando não há id válido (a mensagem sai sem código). */
export function contactCodeFor(registrationId) {
  const id = String(registrationId ?? "").trim();
  return UUID_RE.test(id) ? `MM-${id.slice(0, 8).toUpperCase()}` : "";
}

/** Texto pronto + linha do código (sem cadastro identificado, o texto sai como está). */
export function withContactCode(text, registrationId) {
  const base = String(text ?? "");
  const code = contactCodeFor(registrationId);
  return code ? `${base}\n\n${CONTACT_CODE_LABEL}: ${code}` : base;
}

/** Prefixo (8 caracteres hex, minúsculos) do código na mensagem recebida; "" se não houver código legível. */
export function extractContactCode(text) {
  const match = CODE_RE.exec(String(text ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/** A mensagem traz o rótulo/código de um botão do link (mesmo que o código esteja ilegível). */
export function hasContactCodeMarker(text) {
  return MARKER_RE.test(String(text ?? ""));
}

/** Faixa de ids (uuid) que começam com o prefixo — busca pela chave primária, sem coluna nova. */
export function contactCodeIdRange(prefix) {
  const value = String(prefix ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(value)) return null;
  return { from: `${value}-0000-0000-0000-000000000000`, to: `${value}-ffff-ffff-ffff-ffffffffffff` };
}

/**
 * O que fazer com a conversa do número oficial que recebeu mensagem com código (ou fallback pelo telefone).
 * Nunca muda o responsável do cliente nem cria cliente: só liga a conversa ao cadastro e a entrega ao responsável ATIVO.
 * Entradas: `conversation` {id, client_id, assigned_user_id, private_at, origin}; `registration` {id, status,
 * responsible_user_id}; `responsibleActive`; `currentClientStatus` (status do cliente hoje ligado à conversa, se for outro);
 * `samePhone` (o telefone do cadastro é o da conversa = mesma pessoa, outro atendimento).
 * Saída: { action: "skip", reason } | { action: "update", patch, relinked, assigned }.
 */
export function decideCodedConversationLink({ conversation, registration, responsibleActive = false, currentClientStatus = "", samePhone = false } = {}) {
  if (!conversation?.id) return { action: "skip", reason: "sem_conversa" };
  if (!registration?.id) return { action: "skip", reason: "sem_cadastro" };
  // Particular (WA-19): nunca vincula cliente. Cliente arquivado (WA-13): a conversa não volta ao Chat por código.
  if (conversation.private_at) return { action: "skip", reason: "conversa_particular" };
  if (registration.status === "archived") return { action: "skip", reason: "cliente_arquivado" };

  const linkedTo = conversation.client_id || null;
  const linkedArchived = Boolean(linkedTo && linkedTo !== registration.id && currentClientStatus === "archived");
  // Conversa já de OUTRO cliente ativo, de outro telefone (ex.: escreveu do número do cônjuge, que também é cliente): não mexe.
  if (linkedTo && linkedTo !== registration.id && !linkedArchived && !samePhone) {
    return { action: "skip", reason: "conversa_de_outro_cliente" };
  }

  const patch = {};
  if (linkedTo !== registration.id) patch.client_id = registration.id;
  // Conversa escondida por estar ligada a um cadastro ARQUIVADO: passa para o cadastro ativo e reaparece (mesma regra de
  // linkConversationToFormRegistration, lib/whatsapp-sponsored-lead.js).
  if (linkedArchived && conversation.origin && Object.prototype.hasOwnProperty.call(conversation.origin, "archived_hidden_at")) {
    const { archived_hidden_at: _hidden, ...origin } = conversation.origin;
    Object.assign(patch, { origin, deleted_at: null, deleted_by: null });
  }
  const assignTo = responsibleActive ? registration.responsible_user_id || null : null;
  if (assignTo && conversation.assigned_user_id !== assignTo) patch.assigned_user_id = assignTo;

  if (!Object.keys(patch).length) return { action: "skip", reason: assignTo ? "ja_atribuida" : "sem_responsavel_ativo" };
  return { action: "update", patch, relinked: "client_id" in patch, assigned: "assigned_user_id" in patch };
}

/** Aviso (sino + push) ao corretor quando a conversa do oficial passa a ser dele pelo código (dono, 2026-10-18). */
export function officialChatAssignedNotice(fullName) {
  const name = String(fullName ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    title: `Cliente ${name || "sem nome"} chamou no WhatsApp oficial pelo link — abra o Chat.`,
    description: "A conversa do WhatsApp oficial já está atribuída a você no Chat."
  };
}
