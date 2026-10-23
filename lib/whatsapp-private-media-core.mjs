// Aba "Mídias" dentro de Particular (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23, WA-35): galeria das fotos, vídeos,
// áudios e documentos de TODAS as conversas Particulares, sem figurinhas, mais recentes primeiro, paginada, com filtro
// por tipo e por corretor (dono do número). Puro; o acesso e a consulta ficam em lib/whatsapp-chat.js
// (listPrivateMediaGallery). Testes: tests/whatsapp-private-media.test.mjs.

export const PRIVATE_MEDIA_TYPES = ["image", "video", "audio", "document"]; // nunca "sticker"
export const PRIVATE_MEDIA_PAGE_SIZE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePrivateMediaType(value) {
  return PRIVATE_MEDIA_TYPES.includes(value) ? value : "";
}

export function normalizeBrokerFilter(value) {
  const text = String(value || "").trim();
  return UUID.test(text) ? text.toLowerCase() : "";
}

// Cursor da página seguinte: "<message_at ISO>|<id>" (ordem message_at desc, id desc — sem pular empates).
export function encodePrivateMediaCursor(row) {
  if (!row?.message_at || !row?.id) return "";
  return `${row.message_at}|${row.id}`;
}

export function parsePrivateMediaCursor(value) {
  const [at, id] = String(value || "").split("|");
  // Só dígitos e separadores de data: o valor vai para dentro do filtro or() da consulta.
  if (!at || !/^[0-9T:.+\- Z]+$/.test(at) || !UUID.test(id || "") || !Number.isFinite(Date.parse(at))) return null;
  // Mantém o texto do banco (microssegundos): converter para Date cortaria a precisão e repetiria/pularia itens.
  return { at, id: id.toLowerCase() };
}

