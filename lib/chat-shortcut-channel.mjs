// Canal dos atalhos do Chat (REGRA OFICIAL — dono, 2026-10-22, MKT-2f). Puro (testes:
// tests/whatsapp-chat-shortcut-channel.test.mjs). Os atalhos são os MESMOS de whatsapp_chat_shortcuts; a coluna `channel`
// (migration 20261022180000) diz onde cada um aparece. Sem a coluna (migration não aplicada) tudo vale como "whatsapp".
// No Chat do Marketplace só entram atalhos de TEXTO (a extensão só envia texto).

import { MAX_OUTBOUND_LENGTH } from "./marketplace-chat-core.mjs";

export const SHORTCUT_CHANNELS = Object.freeze(["whatsapp", "marketplace", "both"]);
export const SHORTCUT_CHANNEL_LABEL = Object.freeze({ whatsapp: "Chat do WhatsApp", marketplace: "Chat do Marketplace", both: "Os dois chats" });
// Mesmo limite da resposta do Chat do Marketplace (2.000 caracteres).
export const MARKETPLACE_SHORTCUT_MAX_LENGTH = MAX_OUTBOUND_LENGTH;

export function shortcutChannelOf(row) {
  return SHORTCUT_CHANNELS.includes(row?.channel) ? row.channel : "whatsapp";
}

// O atalho aparece neste chat ("whatsapp" | "marketplace")?
export function shortcutVisibleIn(row, chat) {
  const channel = shortcutChannelOf(row);
  if (chat === "marketplace") return row?.kind === "text" && (channel === "marketplace" || channel === "both");
  return channel === "whatsapp" || channel === "both";
}

// Valida o canal pedido para um atalho. Devolve o canal ou uma mensagem de erro.
export function validateShortcutChannel({ channel = "whatsapp", kind = "", body = "" } = {}) {
  const value = String(channel || "whatsapp");
  if (!SHORTCUT_CHANNELS.includes(value)) return { error: "Canal do atalho inválido." };
  if (value !== "whatsapp" && kind !== "text") return { error: "No Chat do Marketplace só entram atalhos de texto." };
  if (value !== "whatsapp" && String(body || "").trim().length > MARKETPLACE_SHORTCUT_MAX_LENGTH) {
    return { error: `Atalho do Marketplace com no máximo ${MARKETPLACE_SHORTCUT_MAX_LENGTH} caracteres.` };
  }
  return { channel: value };
}
