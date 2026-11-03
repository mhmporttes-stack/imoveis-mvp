import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GOOGLE_SMS_CALLBACK_PATH,
  buildBatchCreateBody,
  chunkList,
  describeGoogleSmsResult,
  isGoogleSmsAuthError,
  isStaleClaim,
  parseBatchCreateResponse,
  planGoogleSmsContacts,
  readGoogleSmsConfig,
  resolveGoogleSmsRedirectUri,
  signGoogleSmsState,
  verifyGoogleSmsState
} from "../lib/sms-google-contacts-core.mjs";

// Lote de SMS -> Google Contatos (PRO-18g). Tudo puro, sem rede e sem banco.

const SECRET = "a".repeat(64);
const USER = "11111111-1111-4111-8111-111111111111";

test("config: sem as variáveis não está configurado e lista só os NOMES que faltam", () => {
  const empty = readGoogleSmsConfig({});
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.missing, ["GOOGLE_CONTACTS_CLIENT_ID", "GOOGLE_CONTACTS_CLIENT_SECRET", "CRM_SECRETS_ENCRYPTION_KEY"]);
  const ok = readGoogleSmsConfig({ GOOGLE_CONTACTS_CLIENT_ID: "id", GOOGLE_CONTACTS_CLIENT_SECRET: "s", CRM_SECRETS_ENCRYPTION_KEY: SECRET });
  assert.equal(ok.configured, true);
  assert.deepEqual(ok.missing, []);
  assert.equal(readGoogleSmsConfig({ GOOGLE_CONTACTS_CLIENT_ID: "id", GOOGLE_CONTACTS_CLIENT_SECRET: "s", CRM_SECRETS_ENCRYPTION_KEY: "curta" }).configured, false);
});

test("redirect: padrão é <site>/api/admin/google-contacts/callback; a variável opcional só vale se for esta rota", () => {
  const site = "https://www.matheusmachadoimoveis.com.br";
  const expected = `${site}${GOOGLE_SMS_CALLBACK_PATH}`;
  assert.equal(expected, "https://www.matheusmachadoimoveis.com.br/api/admin/google-contacts/callback");
  assert.equal(resolveGoogleSmsRedirectUri(`${site}/`), expected);
  assert.equal(resolveGoogleSmsRedirectUri(site, expected), expected);
  // O mesmo nome de variável é usado pela integração por corretor (outra rota): não pode ser aproveitado aqui.
  assert.equal(resolveGoogleSmsRedirectUri(site, `${site}/api/google-contacts/callback`), expected);
  assert.equal(resolveGoogleSmsRedirectUri(site, "lixo"), expected);
});

test("state anti-CSRF: confere assinatura, usuário e prazo", () => {
  const now = 1_800_000_000_000;
  const state = signGoogleSmsState({ userId: USER, secret: SECRET, now });
  assert.equal(verifyGoogleSmsState(state, { userId: USER, secret: SECRET, now: now + 1000 }), true);
  assert.equal(verifyGoogleSmsState(state, { userId: "22222222-2222-4222-8222-222222222222", secret: SECRET, now }), false, "state de outro usuário");
  assert.equal(verifyGoogleSmsState(state, { userId: USER, secret: "b".repeat(64), now }), false, "assinatura com outro segredo");
  assert.equal(verifyGoogleSmsState(state, { userId: USER, secret: SECRET, now: now + 11 * 60 * 1000 }), false, "expirado");
  assert.equal(verifyGoogleSmsState(state, { userId: USER, secret: SECRET, now: now - 1000 }), false, "do futuro");
  assert.equal(verifyGoogleSmsState("", { userId: USER, secret: SECRET }), false);
  assert.equal(verifyGoogleSmsState("lixo", { userId: USER, secret: SECRET }), false);
  // Adulterar o usuário dentro do state invalida a assinatura.
  const parts = Buffer.from(state, "base64url").toString("utf8").split(".");
  parts[0] = "22222222-2222-4222-8222-222222222222";
  assert.equal(verifyGoogleSmsState(Buffer.from(parts.join(".")).toString("base64url"), { userId: parts[0], secret: SECRET, now }), false);
  assert.throws(() => signGoogleSmsState({ userId: "", secret: SECRET }));
});

test("plano: nome 'Nome (SMS lote)', celular +55, sem nome vira Contato, número inválido fora, repetido conta uma vez", () => {
  const plan = planGoogleSmsContacts([
    { id: "c1", name: "Maria Silva", phone: "14997001234" },
    { id: "c2", name: "", phone: "+5514997001235" },
    { id: "c3", name: "Sem número", phone: "123" },
    { id: "c1", name: "Maria Silva", phone: "14997001234" }
  ]);
  assert.deepEqual(plan.toCreate, [
    { id: "c1", name: "Maria Silva (SMS lote)", phone: "+5514997001234" },
    { id: "c2", name: "Contato (SMS lote)", phone: "+5514997001235" }
  ]);
  assert.equal(plan.invalid, 1);
  assert.equal(plan.alreadySaved, 0);
});

test("idempotência: contato já salvo não entra de novo e é contado como 'já existia'", () => {
  const items = [{ id: "c1", name: "A", phone: "14997001234" }, { id: "c2", name: "B", phone: "14997001235" }];
  const plan = planGoogleSmsContacts(items, new Set(["c1"]));
  assert.deepEqual(plan.toCreate.map((row) => row.id), ["c2"]);
  assert.equal(plan.alreadySaved, 1);
  const all = planGoogleSmsContacts(items, ["c1", "c2"]);
  assert.equal(all.toCreate.length, 0);
  assert.equal(all.alreadySaved, 2);
});

test("corpo do batchCreate: nome, telefone, rótulo e leitura mínima; sem rótulo não manda memberships", () => {
  const contacts = [{ id: "c1", name: "Maria (SMS lote)", phone: "+5514997001234" }];
  const body = buildBatchCreateBody(contacts, "contactGroups/abc");
  assert.deepEqual(body.contacts[0].contactPerson.names, [{ givenName: "Maria (SMS lote)" }]);
  assert.deepEqual(body.contacts[0].contactPerson.phoneNumbers, [{ value: "+5514997001234", type: "mobile" }]);
  assert.deepEqual(body.contacts[0].contactPerson.memberships, [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/abc" } }]);
  assert.equal(body.readMask, "names,phoneNumbers");
  assert.equal("memberships" in buildBatchCreateBody(contacts).contacts[0].contactPerson, false);
});

test("lotes de 50 (a API aceita até 200 por chamada)", () => {
  const list = Array.from({ length: 120 }, (_, index) => index);
  assert.deepEqual(chunkList(list).map((part) => part.length), [50, 50, 20]);
  assert.deepEqual(chunkList([]), []);
});

test("resposta do batchCreate: casa por posição e devolve o erro de cada contato sem derrubar os outros", () => {
  const contacts = [{ id: "c1", name: "A" }, { id: "c2", name: "B" }, { id: "c3", name: "C" }];
  const parsed = parseBatchCreateResponse(contacts, {
    createdPeople: [
      { httpStatusCode: 200, person: { resourceName: "people/c111" } },
      { httpStatusCode: 400, status: { code: 3, message: "Invalid phone number" } },
      { httpStatusCode: 200, person: { resourceName: "people/c333" } }
    ]
  });
  assert.deepEqual(parsed.created, [{ id: "c1", resourceName: "people/c111" }, { id: "c3", resourceName: "people/c333" }]);
  assert.equal(parsed.failed.length, 1);
  assert.equal(parsed.failed[0].id, "c2");
  assert.match(parsed.failed[0].error, /Invalid phone number/);
  // Resposta vazia: todos falham (visível), nada é dado como criado.
  assert.equal(parseBatchCreateResponse(contacts, {}).failed.length, 3);
});

test("erro de autorização do Google pede reconexão; erro comum não", () => {
  assert.equal(isGoogleSmsAuthError(401, ""), true);
  assert.equal(isGoogleSmsAuthError(400, "invalid_grant"), true);
  assert.equal(isGoogleSmsAuthError(403, "Request had insufficient authentication scopes."), true);
  assert.equal(isGoogleSmsAuthError(429, "Quota exceeded"), false);
  assert.equal(isGoogleSmsAuthError(500, "Internal error"), false);
});

test("reivindicação antiga sem confirmação do Google é refeita; recente ou confirmada, não", () => {
  const now = Date.now();
  assert.equal(isStaleClaim({ resource_name: null, created_at: new Date(now - 30 * 60 * 1000).toISOString() }, now), true);
  assert.equal(isStaleClaim({ resource_name: null, created_at: new Date(now - 60 * 1000).toISOString() }, now), false);
  assert.equal(isStaleClaim({ resource_name: "people/c1", created_at: new Date(now - 60 * 60 * 1000).toISOString() }, now), false);
});

test("mensagem de resultado", () => {
  assert.equal(describeGoogleSmsResult({ created: 50 }), "50 contatos salvos. Em alguns minutos aparecem no iPhone.");
  assert.equal(describeGoogleSmsResult({ created: 1 }), "1 contato salvo. Em alguns minutos aparecem no iPhone.");
  assert.match(describeGoogleSmsResult({ created: 48, alreadySaved: 1, failed: 1 }), /48 contatos salvos · 1 já estava salvo · 1 não foi salvo/);
  assert.equal(describeGoogleSmsResult({ alreadySaved: 50 }), "50 já estavam salvos.");
  assert.equal(describeGoogleSmsResult({}), "Nenhum contato para salvar.");
});

test("cifra do refresh token: AES-GCM ida e volta, não guarda o texto claro e falha com a chave errada", async () => {
  // lib/secrets-crypto.js é "server-only" (não importa fora do Next): carrega a MESMA fonte sem essa linha.
  const source = readFileSync(new URL("../lib/secrets-crypto.js", import.meta.url), "utf8").replace('import "server-only";', "");
  const crypto = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const previous = process.env.CRM_SECRETS_ENCRYPTION_KEY;
  try {
    process.env.CRM_SECRETS_ENCRYPTION_KEY = SECRET;
    const token = "1//refresh-token-de-teste";
    const encrypted = crypto.encryptSecret(token);
    assert.notEqual(encrypted, token);
    assert.equal(encrypted.includes(token), false);
    assert.equal(crypto.decryptSecret(encrypted), token);
    assert.notEqual(crypto.encryptSecret(token), encrypted, "IV novo a cada cifra");
    process.env.CRM_SECRETS_ENCRYPTION_KEY = "b".repeat(64);
    assert.throws(() => crypto.decryptSecret(encrypted));
  } finally {
    if (previous === undefined) delete process.env.CRM_SECRETS_ENCRYPTION_KEY;
    else process.env.CRM_SECRETS_ENCRYPTION_KEY = previous;
  }
});

test("segurança estática: rotas OAuth com guard de admin geral real; token nunca devolvido nem logado; ação e tela ligadas", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const route of ["../app/api/admin/google-contacts/connect/route.js", "../app/api/admin/google-contacts/callback/route.js"]) {
    const text = read(route);
    assert.match(text, /requireRealGeneralAdminApi\(request\)/);
    assert.ok(text.indexOf("requireRealGeneralAdminApi(request)") < text.indexOf("buildGoogleSmsAuthUrl(userId)") || text.indexOf("requireRealGeneralAdminApi(request)") < text.indexOf("completeGoogleSmsConnection({"));
  }
  const lib = read("../lib/sms-google-contacts.js");
  assert.doesNotMatch(lib, /console\.\w+\([^)]*(refresh_token|accessToken|clientSecret)/);
  assert.doesNotMatch(lib, /refresh_token_encrypted[^;\n]*return/);
  const route = read("../app/api/admin/lote-sms/route.js");
  assert.match(route, /action === "save-google-contacts"/);
  assert.ok(route.indexOf("assertSmsBatchOffice") < route.indexOf("save-google-contacts"), "a regra do Wi-Fi vale antes da ação");
  const screen = read("../components/SmsBatchWorkspace.jsx");
  assert.match(screen, /no Google Contatos/);
  assert.match(screen, /Salvar estes contatos no iPhone/, "o .vcf segue como alternativa");
  assert.match(read("../supabase/migrations/20261103130000_sms_batch_google_contacts.sql"), /enable row level security[\s\S]*revoke all[\s\S]*grant all/);
});
