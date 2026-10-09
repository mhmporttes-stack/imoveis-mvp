// Regras puras da foto do contato no Chat (2026-10-09). Testes: tests/whatsapp-contact-photo.test.mjs.
export const CONTACT_PHOTO_PREFIX = "storage:";
export const CONTACT_PHOTO_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
// Poucas por vez: não pesar no número do corretor nem chamar atenção do WhatsApp.
export const CONTACT_PHOTO_BATCH = 4;

export function shouldRefreshContactPhoto(checkedAt, now = Date.now()) {
  if (!checkedAt) return true;
  const at = new Date(checkedAt).getTime();
  return Number.isNaN(at) || now - at >= CONTACT_PHOTO_REFRESH_MS;
}

export function contactPhotoPath(conversationId) {
  return `contact-photos/${conversationId}.jpg`;
}

// Primeiro número CONECTADO dos candidatos (o da própria conversa quando a conversa é de um número específico).
export function pickPhotoSession(candidates = []) {
  for (const candidate of candidates) {
    const rows = (candidate.rows || []).filter((row) => row.status === "connected");
    const preferred = candidate.slot ? rows.find((row) => (Number(row.slot) || 1) === Number(candidate.slot)) : rows.sort((a, b) => (Number(a.slot) || 1) - (Number(b.slot) || 1))[0];
    if (preferred) return { userId: candidate.userId, slot: Number(preferred.slot) || 1 };
  }
  return null;
}

// Valor guardado -> URL que a tela usa (rota autenticada); link externo antigo continua como está.
export function contactPhotoViewUrl(conversationId, storedValue) {
  const value = String(storedValue || "");
  if (!value) return "";
  if (!value.startsWith(CONTACT_PHOTO_PREFIX)) return value;
  const version = value.split("#")[1] || "";
  return `/api/admin/whatsapp-chat/conversations/${conversationId}/photo${version ? `?v=${version}` : ""}`;
}
