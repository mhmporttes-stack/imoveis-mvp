// Vários anexos na mesma mensagem — Chat do WhatsApp e Chat do Marketplace (REGRA OFICIAL — dono, 2026-10-23: "Eu quero
// que possa enviar mais de um arquivo na mesma mensagem"; antes, anexar de novo SUBSTITUÍA o anterior e a ordem saiu
// invertida). Regras puras, iguais nas duas telas (components/ChatAttachmentTray.jsx):
// - anexar de novo ACRESCENTA ao fim da fila, até MAX_CHAT_ATTACHMENTS por envio (o excedente é recusado, nunca troca);
// - envio na ORDEM mostrada, um por vez, esperando a confirmação de cada um antes do próximo;
// - parou na 1ª falha: os seguintes NÃO saem (senão chegariam antes do que falhou). "Tentar de novo" recomeça desse
//   arquivo, na mesma ordem. Cada arquivo continua passando pelas travas do servidor (mesma rota de sempre).

export const MAX_CHAT_ATTACHMENTS = 10;

export function appendAttachments(current = [], incoming = [], max = MAX_CHAT_ATTACHMENTS) {
  const room = Math.max(0, max - current.length);
  const accepted = incoming.slice(0, room);
  return { items: [...current, ...accepted], rejected: incoming.length - accepted.length };
}

export function removeAttachment(items = [], id) {
  return items.filter((item) => item.id !== id);
}

// delta -1 = sobe uma posição, +1 = desce. Fora dos limites: lista igual.
export function moveAttachment(items = [], id, delta) {
  const from = items.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Envia em ordem, um por vez (await de cada um). sendOne(item, index, total) lança em caso de falha.
// Devolve { sent: [ids], failed: { id, error } | null, pending: [ids que não saíram depois da falha] }.
export async function sendAttachmentsInOrder(items = [], sendOne, { onProgress = null } = {}) {
  const sent = [];
  const total = items.length;
  for (let index = 0; index < total; index += 1) {
    const item = items[index];
    onProgress?.({ index, total, item });
    try {
      await sendOne(item, index, total);
      sent.push(item.id);
    } catch (error) {
      return { sent, failed: { id: item.id, error: String(error?.message || error || "Falha no envio.") }, pending: items.slice(index + 1).map((rest) => rest.id) };
    }
  }
  return { sent, failed: null, pending: [] };
}

export function sendingProgressLabel(index, total) {
  return total > 1 ? `Enviando ${index + 1} de ${total}…` : "Enviando…";
}

// Texto digitado + legenda própria do arquivo → legenda do arquivo (o texto vai só no 1º arquivo, como no WhatsApp).
export function captionFor(item, index, leadText = "") {
  return [index === 0 ? String(leadText || "").trim() : "", String(item?.caption || "").trim()].filter(Boolean).join("\n");
}
