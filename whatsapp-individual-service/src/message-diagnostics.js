import { createHash } from "node:crypto";

// Diagnóstico PASSIVO das quedas de ~50 min (Mesa "WhatsApp dos corretores", decisão do dono de 2026-10-16). Só observa
// e conta; NUNCA responde, confirma, reenvia nem altera nada do Baileys. Separa duas hipóteses para o "stream:error ack":
//  (a) mensagem RECEBIDA que não decifra (CIPHERTEXT) e fica sem confirmação depois dos pedidos de reenvio;
//  (b) confirmação nossa malformada (sem o campo `from`).
// O que é medido, por socket (zera a cada conexão):
//  - mensagens recebidas que não decifram (messageStubType CIPHERTEXT) e o tipo da falha, em código curto;
//  - pedidos de reenvio de mensagens NOSSAS (recibo `type="retry"` vindo do celular do contato).
// Segurança: ids de mensagem só como hash curto (sha256, 8 hex); NUNCA telefone, JID, texto da mensagem nem o texto do
// erro (só um código da lista abaixo). Vai para a telemetria existente (`history_sync`, motivo `diag_*`), porque o tipo
// de evento é fixo no banco e este diagnóstico não pode depender de migration — ver docs/WHATSAPP.md §1-G.

// WAMessageStubType.CIPHERTEXT do Baileys (proto.WebMessageInfo.StubType.CIPHERTEXT = 2).
export const CIPHERTEXT_STUB_TYPE = 2;
// Eventos individuais por socket e por motivo; o resto só soma no resumo (evita inundar a telemetria).
export const DIAG_MAX_EVENTS_PER_REASON = 20;
export const DIAG_REASON = Object.freeze({
  DECRYPT_FAIL: "diag_decrypt_fail",
  RETRY_RECEIPT: "diag_retry_receipt",
  SOCKET_SUMMARY: "diag_socket_summary"
});

// Hash curto e estável de um id de mensagem (o mesmo id dá o mesmo hash em qualquer evento — permite cruzar a falha de
// decifrar com o `<ack>` do stream:error, cujo id vai no detail da queda com o prefixo de 4 caracteres deste hash).
export function hashMessageId(id) {
  const value = String(id || "");
  if (!value) return "";
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

// Código curto da falha de decifrar a partir do 1º parâmetro do stub (texto do Baileys/libsignal). Nunca devolve o texto.
export function decryptFailureCode(stubParameter) {
  const text = String(stubParameter || "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("missing keys")) return "missing_keys";
  if (text.includes("bad mac")) return "bad_mac";
  if (text.includes("no session") || text.includes("no sessions") || text.includes("no open session")) return "no_session";
  if (text.includes("no matching sessions") || text.includes("any known session")) return "no_matching_session";
  if (text.includes("message absent") || text.includes("no message found")) return "message_absent";
  if (text.includes("invalid prekey") || text.includes("prekey")) return "prekey";
  if (text.includes("key used already") || text.includes("old counter")) return "old_counter";
  return "other";
}

// Mensagem recebida (messages.upsert) que não decifrou -> campos de telemetria, ou null.
export function describeDecryptFailure(msg) {
  if (!msg || Number(msg.messageStubType) !== CIPHERTEXT_STUB_TYPE) return null;
  return {
    reason: DIAG_REASON.DECRYPT_FAIL,
    kind: decryptFailureCode(msg.messageStubParameters?.[0]),
    trigger: msg.key?.fromMe ? "from_me" : "from_contact",
    detail: `id_${hashMessageId(msg.key?.id)}`
  };
}

// Recibo bruto (CB:receipt). Pedido de reenvio = `type="retry"`; o contador do pedido vem do filho <retry count="n">.
export function describeRetryReceipt(node) {
  const attrs = node?.attrs || {};
  if (attrs.type !== "retry") return null;
  const retryChild = Array.isArray(node.content) ? node.content.find((item) => item && item.tag === "retry") : null;
  const count = Number(retryChild?.attrs?.count);
  return {
    reason: DIAG_REASON.RETRY_RECEIPT,
    attempt: Number.isFinite(count) ? count : null,
    detail: `id_${hashMessageId(attrs.id)}`
  };
}

// Contador por socket: decide se o evento individual ainda vai para a telemetria e monta o resumo do fechamento.
export function createMessageDiagnostics({ maxEventsPerReason = DIAG_MAX_EVENTS_PER_REASON } = {}) {
  const counts = new Map();
  return {
    // true = registrar o evento individual (até o limite por motivo); sempre conta.
    track(reason) {
      const next = (counts.get(reason) || 0) + 1;
      counts.set(reason, next);
      return next <= maxEventsPerReason;
    },
    count(reason) { return counts.get(reason) || 0; },
    // Resumo para o fechamento do socket; null = nada a relatar.
    summary() {
      const dec = counts.get(DIAG_REASON.DECRYPT_FAIL) || 0;
      const rr = counts.get(DIAG_REASON.RETRY_RECEIPT) || 0;
      if (!dec && !rr) return null;
      return { reason: DIAG_REASON.SOCKET_SUMMARY, detail: `dec${dec}_rr${rr}` };
    }
  };
}
