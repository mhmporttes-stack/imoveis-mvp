// Leitura pura de configuração da integração Google Contacts (só
// process.env, sem "server-only", sem banco) — testável isoladamente, mesmo
// padrão de lib/daily-goal-auto-core.mjs e lib/whatsapp-individual-routing.mjs
// deste projeto. lib/google-contacts-config.js (com "server-only") reexporta
// tudo daqui; use este arquivo em testes, o outro no resto do app.

function hasValidHexKey(raw) {
  return Buffer.from(String(raw || ""), "hex").length === 32;
}

export function hasSecretsEncryptionKeyEnv() {
  return hasValidHexKey(process.env.CRM_SECRETS_ENCRYPTION_KEY || "");
}

export const GOOGLE_CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

export function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || "";
}

export function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

export function getGoogleContactsRedirectUri() {
  return process.env.GOOGLE_CONTACTS_REDIRECT_URI || "";
}

export function isGoogleContactsConfigured() {
  return Boolean(getGoogleClientId() && getGoogleClientSecret() && getGoogleContactsRedirectUri() && hasSecretsEncryptionKeyEnv());
}

// Diagnóstico sem nunca expor segredo — usado pela tela de conexão e pela
// resposta de /connect quando falta configurar algo no ambiente.
export function getGoogleContactsConfigStatus() {
  const missing = [];
  if (!getGoogleClientId()) missing.push("GOOGLE_CLIENT_ID");
  if (!getGoogleClientSecret()) missing.push("GOOGLE_CLIENT_SECRET");
  if (!getGoogleContactsRedirectUri()) missing.push("GOOGLE_CONTACTS_REDIRECT_URI");
  if (!hasSecretsEncryptionKeyEnv()) missing.push("CRM_SECRETS_ENCRYPTION_KEY");
  return { configured: missing.length === 0, missing };
}
