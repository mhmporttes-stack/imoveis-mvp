import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBatchCreateBody,
  chunkList,
  describeGoogleSmsResult,
  googleSmsConnectionState,
  isStaleClaim,
  parseBatchCreateResponse,
  planGoogleSmsContacts
} from "../lib/sms-google-contacts-core.mjs";
import { isGoogleAuthorizationError } from "../lib/google-contacts-config-core.mjs";

// Lote de SMS -> Google Contatos do próprio usuário (PRO-18g). Tudo puro, sem rede e sem banco.

test("estado da conexão: só conecta com status connected, sync ligado, token e escopo de Contatos; senão pede conectar/reconectar", () => {
  const scope = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/userinfo.email";
  const ok = { status: "connected", sync_enabled: true, scopes: scope, encrypted_refresh_token: "x" };
  assert.deepEqual(googleSmsConnectionState(ok), { configured: true, connected: true, needsReconnect: false });
  // Sem conexão / desconectado: nem conectado nem "reconectar" (a tela mostra "Conecte seu Google Contatos").
  assert.deepEqual(googleSmsConnectionState(null), { configured: true, connected: false, needsReconnect: false });
  assert.deepEqual(googleSmsConnectionState({ ...ok, status: "disconnected", encrypted_refresh_token: null }), { configured: true, connected: false, needsReconnect: false });
  // Erro/expirada/sem permissão de Contatos: pede reconectar.
  assert.equal(googleSmsConnectionState({ ...ok, status: "error" }).needsReconnect, true);
  assert.equal(googleSmsConnectionState({ ...ok, status: "expired" }).needsReconnect, true);
  const noScope = googleSmsConnectionState({ ...ok, scopes: "https://www.googleapis.com/auth/userinfo.email" });
  assert.deepEqual([noScope.connected, noScope.needsReconnect], [false, true]);
  // Sync desligado pelo usuário: não grava (não é "reconectar").
  assert.deepEqual(googleSmsConnectionState({ ...ok, sync_enabled: false }), { configured: true, connected: false, needsReconnect: false });
  // Servidor sem credenciais do Google: nada conecta.
  assert.deepEqual(googleSmsConnectionState(ok, false), { configured: false, connected: false, needsReconnect: false });
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

test("erro de autorização (helper existente do Google Contatos) pede reconexão; erro comum não", () => {
  assert.equal(isGoogleAuthorizationError(401, ""), true);
  assert.equal(isGoogleAuthorizationError(403, "Request had insufficient authentication scopes."), true);
  assert.equal(isGoogleAuthorizationError(429, "Quota exceeded"), false);
  assert.equal(isGoogleAuthorizationError(500, "Internal error"), false);
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

test("segurança estática: sem OAuth/credencial novos, reaproveita a conexão do usuário, token nunca devolvido nem logado; ação, guards e tela ligados", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.equal(existsSync(new URL("../app/api/admin/google-contacts", import.meta.url)), false, "nenhuma rota OAuth nova");
  const lib = read("../lib/sms-google-contacts.js");
  assert.match(lib, /getValidAccessToken\(userId\)/, "token pelo helper existente");
  assert.doesNotMatch(lib, /GOOGLE_CONTACTS_CLIENT|encryptSecret|decryptSecret|oauth2\.googleapis/);
  assert.doesNotMatch(lib, /console\.\w+\([^)]*(refresh_token|accessToken|encrypted)/);
  assert.doesNotMatch(read("../.env.example"), /GOOGLE_CONTACTS_CLIENT/);
  const route = read("../app/api/admin/lote-sms/route.js");
  assert.match(route, /requirePerformanceApi\(request\)/);
  assert.match(route, /saveSmsContactsToGoogle\(auth, data\.items\)/, "grava na conta do próprio usuário");
  assert.ok(route.indexOf("assertSmsBatchOffice(auth, clientIpFromHeaders(request.headers), String(body.action") < route.indexOf('"save-google-contacts"'), "a regra do Wi-Fi vale antes da ação");
  const screen = read("../components/SmsBatchWorkspace.jsx");
  assert.match(screen, /no Google Contatos/);
  assert.match(screen, /Conecte seu Google Contatos/);
  assert.match(screen, /Salvar estes contatos no iPhone/, "o .vcf segue como alternativa");
  assert.match(read("../supabase/migrations/20261103130000_sms_batch_google_contacts.sql"), /primary key \(user_id, contact_id\)[\s\S]*enable row level security[\s\S]*revoke all[\s\S]*grant all/);
});
