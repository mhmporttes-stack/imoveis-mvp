import test from "node:test";
import assert from "node:assert/strict";

// Cobre o requisito central do pedido do dono (2026-10-01): "se as
// credenciais ainda NÃO estiverem configuradas, o deploy NÃO deve quebrar; a
// integração deve aparecer como indisponível". Como os módulos "server-only"
// leem process.env na hora da chamada (não no import), dá pra testar os dois
// cenários (configurado/faltando) manipulando as envs entre os testes, sem
// precisar de nenhum mock de rede/banco — é só leitura de env.

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CONTACTS_REDIRECT_URI", "CRM_SECRETS_ENCRYPTION_KEY"];

function clearGoogleEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function setFullGoogleEnv() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_CONTACTS_REDIRECT_URI = "https://imoveis-mvp.vercel.app/api/google-contacts/callback";
  process.env.CRM_SECRETS_ENCRYPTION_KEY = "a".repeat(64); // hex de 32 bytes válido
}

test("sem nenhuma env configurada: isGoogleContactsConfigured() é false e lista tudo que falta", async () => {
  clearGoogleEnv();
  const { isGoogleContactsConfigured, getGoogleContactsConfigStatus } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-1`);
  assert.equal(isGoogleContactsConfigured(), false);
  const status = getGoogleContactsConfigStatus();
  assert.equal(status.configured, false);
  assert.ok(status.missing.includes("GOOGLE_CLIENT_ID"));
  assert.ok(status.missing.includes("GOOGLE_CLIENT_SECRET"));
  assert.ok(status.missing.includes("GOOGLE_CONTACTS_REDIRECT_URI"));
  assert.ok(status.missing.includes("CRM_SECRETS_ENCRYPTION_KEY"));
});

test("faltando só a chave de criptografia: reportada como faltante mesmo com o resto preenchido", async () => {
  setFullGoogleEnv();
  delete process.env.CRM_SECRETS_ENCRYPTION_KEY;
  const { isGoogleContactsConfigured, getGoogleContactsConfigStatus } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-2`);
  assert.equal(isGoogleContactsConfigured(), false);
  assert.deepEqual(getGoogleContactsConfigStatus().missing, ["CRM_SECRETS_ENCRYPTION_KEY"]);
});

test("chave de criptografia em formato inválido (não-hex de 32 bytes) conta como faltando", async () => {
  setFullGoogleEnv();
  process.env.CRM_SECRETS_ENCRYPTION_KEY = "chave-invalida-nao-hex";
  const { isGoogleContactsConfigured } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-3`);
  assert.equal(isGoogleContactsConfigured(), false);
});

test("com todas as envs válidas: isGoogleContactsConfigured() é true e nada falta", async () => {
  setFullGoogleEnv();
  const { isGoogleContactsConfigured, getGoogleContactsConfigStatus } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-4`);
  assert.equal(isGoogleContactsConfigured(), true);
  assert.deepEqual(getGoogleContactsConfigStatus(), { configured: true, missing: [] });
  clearGoogleEnv();
});

test("GOOGLE_CONTACTS_SCOPES pede só o necessário (contatos + identificar a conta), nada a mais", async () => {
  const { GOOGLE_CONTACTS_SCOPES } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-5`);
  const scopes = GOOGLE_CONTACTS_SCOPES.split(" ");
  assert.deepEqual(scopes.sort(), [
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/userinfo.email"
  ].sort());
});

test("hasContactsScope/isGoogleAuthorizationError: detecta consentimento sem Contatos e erro de permissão", async () => {
  const { hasContactsScope, isGoogleAuthorizationError } = await import(`../lib/google-contacts-config-core.mjs?t=${Date.now()}-scope`);
  assert.equal(hasContactsScope("openid https://www.googleapis.com/auth/userinfo.email"), false);
  assert.equal(hasContactsScope("https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/userinfo.email"), true);
  assert.equal(isGoogleAuthorizationError(403, "Request had insufficient authentication scopes."), true);
  assert.equal(isGoogleAuthorizationError(401, ""), true);
  assert.equal(isGoogleAuthorizationError(500, "boom"), false);
  assert.equal(isGoogleAuthorizationError(403, "quota exceeded"), false);
});
