import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Atalho do iPhone do Lote de SMS (dono, 2026-11-04): chave pessoal `sms_...` (só o hash fica no banco), enviada pelo Atalho em
// `Authorization: Bearer`. Regras puras; testes em tests/sms-shortcut.test.mjs.
export const SMS_SHORTCUT_PREFIX = "sms_";
export const SMS_SHORTCUT_RATE_LIMIT = Object.freeze({ windowSeconds: 60, maxAttempts: 30 });

export function generateSmsShortcutKey() {
  return `${SMS_SHORTCUT_PREFIX}${randomBytes(24).toString("hex")}`;
}

export function hashSmsShortcutKey(key) {
  return createHash("sha256").update(String(key || "")).digest("hex");
}

export function smsShortcutKeyMatches(storedHash, key) {
  const stored = String(storedHash || "");
  const supplied = hashSmsShortcutKey(key);
  return stored.length > 0 && stored.length === supplied.length && timingSafeEqual(Buffer.from(stored), Buffer.from(supplied));
}

export function smsShortcutKeyFromHeaders(headers) {
  const header = (typeof headers?.get === "function" ? headers.get("authorization") : headers?.authorization) || "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return key.startsWith(SMS_SHORTCUT_PREFIX) && key.length >= 20 && key.length <= 120 ? key : "";
}

// O que o Atalho recebe de cada contato: só o necessário para enviar (telefone com +55, texto da 1ª, da 2ª e as duas juntas).
export function shortcutItems(items = []) {
  return items
    .filter((item) => item?.id && item.phoneE164 && item.text)
    .map((item) => ({ id: item.id, name: item.firstName || "", phone: item.phoneE164, text: item.text, text2: item.text2 || "", together: item.bothText || item.text }));
}
