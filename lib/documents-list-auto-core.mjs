// Lista de documentos ENVIADA SOZINHA quando o cliente pede pelo WhatsApp OFICIAL (REGRA OFICIAL — dono, 2026-10-20):
// "Quando o cliente enviar a mensagem 'gostaria de receber a lista da documentação', a lista (texto) e a imagem devem ser
// geradas e enviadas automaticamente para o cliente." + "se o cliente pediu a lista de documentos ela deve ser enviada
// independente de qualquer regra" — exceção explícita à regra de 14/10 (canal da lista), à automação pausada (Chat
// desligado) e ao cliente arquivado. Continuam valendo (CLAUDE.md regra 9): cliente "Não contactar" e telefone bloqueado
// NÃO recebem — o corretor é avisado com a lista pronta para decidir. Limites técnicos: janela de 24 h e uma vez por pedido.
//
// PURO (sem banco, sem "server-only"): o servidor (lib/documents-list-auto.js) injeta as dependências.
// Testes: tests/documents-list-auto.test.mjs (envio sempre falso).
import { hasContactCodeMarker } from "./whatsapp-contact-code-core.mjs";

export const DOCUMENTS_LIST_AUTO_KIND = "documents_list_auto";
export const AUTO_LIST_WINDOW_MS = 24 * 60 * 60 * 1000;
// Mesma mensagem (ou outra versão do pedido) de novo em poucos minutos: não reenvia.
export const AUTO_LIST_REPEAT_MS = 10 * 60 * 1000;
// Lista já enviada ao cadastro (pelo corretor ou pelo CRM, evento "Lista de documentos enviada") há menos disto: não reenvia.
export const RECENT_LIST_SENT_MS = 24 * 60 * 60 * 1000;
export const AUTO_LIST_IMAGE_NAME = "lista-de-documentos.png";

function normalize(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pedido da lista: "lista" + (documento/documentação ou "meu caso") + verbo de pedido. Tolerante a acento, caixa e
 *  pequenas edições do texto pronto (buildForecastMessage) e à frase do dono ("gostaria de receber a lista da documentação"). */
export function isDocumentsListRequest(text) {
  const value = normalize(text);
  if (!/\blistas?\b/.test(value)) return false;
  if (!/\bdocument(o|os|acao|acoes)\b|\bmeu caso\b/.test(value)) return false;
  return /\b(mand|envi|receb|pass|gostaria|quero|pode)/.test(value);
}

/** Mensagem do botão da apresentação: pedido da lista COM o código (ou o rótulo) do atendimento. */
export function isCodedDocumentsListRequest(text) {
  return hasContactCodeMarker(text) && isDocumentsListRequest(text);
}

/** Dia (AAAA-MM-DD) em São Paulo, parte da chave de idempotência. */
export function saoPauloDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Chave da reserva (whatsapp_messages.meta_message_id, índice único): mesmo pedido (texto normalizado) no mesmo dia = 1 envio. */
export function autoListClaimBase({ registrationId, textHash, now = new Date() }) {
  return `docs-list-auto:${registrationId}:${saoPauloDay(now)}:${textHash}`;
}

export function normalizedRequestText(text) {
  return normalize(text);
}

/**
 * Decide o que fazer com o pedido. Entradas: `registration` {id, status}; `conversation` {id, last_inbound_at} do oficial;
 * `doNotContactReason` (telefone/cliente bloqueado, lib/do-not-contact-core.mjs); `recentAutoList` (automática há pouco);
 * `recentListSent` (evento "Lista de documentos enviada" do cadastro nas últimas 24 h — inclusive envio manual do corretor).
 * Saída: { action: "send" } | { action: "notify", reason } | { action: "skip", reason }.
 */
export function decideAutoDocumentsList({ registration, conversation, doNotContactReason = null, recentAutoList = false, recentListSent = false }, now = new Date()) {
  if (!registration?.id) return { action: "skip", reason: "sem_cadastro" };
  // CLAUDE.md regra 9: Não contactar / telefone bloqueado nunca recebem envio automático — o corretor decide.
  if (registration.status === "do_not_contact") return { action: "notify", reason: "nao_contactar" };
  if (doNotContactReason) return { action: "notify", reason: "telefone_bloqueado" };
  if (!conversation?.id) return { action: "notify", reason: "sem_conversa" };
  const last = Date.parse(conversation.last_inbound_at || "");
  if (!Number.isFinite(last) || last + AUTO_LIST_WINDOW_MS <= now.getTime()) return { action: "notify", reason: "janela_fechada" };
  if (recentAutoList) return { action: "skip", reason: "ja_enviada_recentemente" };
  if (recentListSent) return { action: "skip", reason: "lista_ja_enviada_ao_cadastro" };
  return { action: "send" };
}

function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "sem nome";
}

const PENDING_REASON_TEXT = {
  nao_contactar: "o cliente está como \"Não contactar\"",
  telefone_bloqueado: "o telefone está bloqueado para contato",
  sem_conversa: "a conversa do WhatsApp oficial não foi encontrada",
  janela_fechada: "a janela de 24 h do WhatsApp oficial está fechada",
  sem_simulacao: "o cliente ainda não tem simulação com valores",
  indisponivel: "a lista não pôde ser gerada agora",
  falha_envio: "o WhatsApp oficial recusou o envio"
};

/** Aviso (sino + push) ao corretor responsável. `sent` = enviada sozinha; senão, pendente com o motivo. */
export function autoDocumentsListNotice({ fullName, sent, reason = "" }) {
  const name = cleanName(fullName);
  if (sent) {
    return {
      title: `Lista de documentos enviada automaticamente para ${name}.`,
      description: "O cliente pediu a lista no WhatsApp oficial e o CRM enviou o texto e a imagem. Confira no Chat."
    };
  }
  return {
    title: `${name} pediu a lista de documentos — confira e envie.`,
    description: `Não foi enviada automaticamente: ${PENDING_REASON_TEXT[reason] || "motivo não identificado"}. A lista está pronta no botão "Enviar lista de documentos" da ficha do cliente.`
  };
}

/**
 * Orquestra UM pedido (dependências injetadas; nenhuma chamada real nos testes).
 * deps: loadContext() → { conversation, doNotContactReason, recentAutoList, recentListSent }
 *       prepareList() → { kind: "ok", listText, imageUrl, message } | { kind: "no_simulation"|"unavailable"|... } (só no envio)
 *       sendText({ claimKey, text }) / sendImage({ claimKey, imageUrl, caption }) → "enviado" | "ja_enviado" | "falha_envio"
 *       recordSent() / notify({ sent, reason })
 *       hashText(text) → string
 */
export async function runAutoDocumentsList({ registration, text, now = new Date(), deps }) {
  const context = await deps.loadContext();
  const decision = decideAutoDocumentsList({ registration, ...context }, now);
  if (decision.action === "skip") return { outcome: decision.reason };

  if (decision.action === "notify") {
    await deps.notify({ sent: false, reason: decision.reason });
    return { outcome: decision.reason };
  }
  const list = await deps.prepareList();
  if (list?.kind !== "ok" || !list.listText || !list.imageUrl) {
    const reason = list?.kind === "no_simulation" ? "sem_simulacao" : "indisponivel";
    await deps.notify({ sent: false, reason });
    return { outcome: reason };
  }

  const base = autoListClaimBase({ registrationId: registration.id, textHash: deps.hashText(normalizedRequestText(text)), now });
  const textResult = await deps.sendText({ claimKey: `${base}:texto`, text: list.listText.slice(0, 4096) });
  if (textResult === "ja_enviado") return { outcome: "ja_enviado" };
  if (textResult !== "enviado") {
    await deps.notify({ sent: false, reason: "falha_envio" });
    return { outcome: "falha_envio" };
  }
  const imageResult = await deps.sendImage({ claimKey: `${base}:imagem`, imageUrl: list.imageUrl, caption: "" });
  await deps.recordSent({ image: imageResult === "enviado" });
  await deps.notify({ sent: true });
  return { outcome: "enviado", image: imageResult };
}
