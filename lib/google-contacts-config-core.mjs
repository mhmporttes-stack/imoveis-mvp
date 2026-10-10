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

// O Google deixa o corretor desmarcar a permissão de Contatos na tela de
// consentimento e ainda assim devolve um token válido (só e-mail/openid).
// Sem esta checagem a conexão ficava "connected" e todo envio da Meta
// Diária falhava com "insufficient authentication scopes", em loop.
export function hasContactsScope(grantedScopes) {
  return String(grantedScopes || "").split(/\s+/).includes("https://www.googleapis.com/auth/contacts");
}

// Erro do Google que só se resolve com o corretor reconectando a conta.
export function isGoogleAuthorizationError(status, message) {
  if (status === 401) return true;
  return status === 403 && /insufficient (authentication )?scopes?|permission_denied|insufficient permission/i.test(String(message || ""));
}
