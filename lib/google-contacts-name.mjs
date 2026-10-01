// Nome do contato salvo no Google Contacts do corretor (pedido do dono,
// 2026-10-01): "Cliente {nome completo}". O prefixo existe SÓ no contato do
// Google — o nome do cliente no CRM e no banco nunca é alterado. Idempotente:
// um nome que já começa com "Cliente" (em qualquer caixa, uma ou mais vezes)
// sai com um único prefixo, nunca "Cliente Cliente". Função pura, sem
// "server-only", para ser testada isoladamente (tests/google-contacts-name.test.mjs).
export const GOOGLE_CONTACT_NAME_PREFIX = "Cliente";

const PREFIX_PATTERN = /^(?:cliente(?:\s+|$))+/i;

export function buildGoogleContactName(name, fallback = "") {
  const clean = String(name || "").replace(/\s+/g, " ").trim().replace(PREFIX_PATTERN, "").trim();
  const base = clean || String(fallback || "").trim();
  return base ? `${GOOGLE_CONTACT_NAME_PREFIX} ${base}` : GOOGLE_CONTACT_NAME_PREFIX;
}
