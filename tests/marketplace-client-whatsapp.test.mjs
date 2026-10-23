import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDistributionFirstMessageAllowed } from "../lib/distribution-first-message-core.mjs";
import { pickUnambiguousRegistration } from "../lib/human-contact-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// MKT-2 (dono, 2026-10-23): o cliente do Marketplace nasce sem telefone; o corretor preenche o WhatsApp na ficha ou no topo
// da conversa do Chat Marketplace e, depois de salvar, chama pelo mesmo botão do card (WA-13a).

test("servidor: telefone digitado é validado depois do escopo e antes de gravar (número válido, nunca da equipe)", () => {
  const route = read("app/api/simulation-registrations/[id]/route.js");
  assert.match(route, /manualPhone: body\?\.phone !== undefined/);
  assert.match(route, /requireAdminApi\(request\)/);
  const lib = read("lib/simulation-registrations.js");
  const body = lib.slice(lib.indexOf("export async function updateSimulationRegistration("), lib.indexOf("async function notifyBrokerTransferRecipient("));
  const scope = body.indexOf("assertCanAccessResponsibleUser(auth");
  const check = body.indexOf("await assertManualClientPhoneAllowed(updates.phone)");
  const write = body.indexOf('.from("simulation_registrations")\n    .update(record)');
  assert.ok(scope > 0 && check > scope && write > check, "escopo -> validação -> gravação");
  const assertFn = lib.slice(lib.indexOf("export async function assertManualClientPhoneAllowed("), lib.indexOf("export async function updateSimulationRegistration("));
  assert.match(assertFn, /toBrazilianE164\(raw\)/);
  assert.match(assertFn, /findInternalTeamPhone\(phoneNormalized\)/);
  assert.match(assertFn, /alguém da equipe/);
});

test("vincula conversa sem cliente só pelo candidato único do telefone (CLI-4), nunca arquivado nem conversa já ligada", () => {
  const code = read("lib/whatsapp-sponsored-lead.js");
  const fn = code.slice(code.indexOf("export async function linkUnlinkedConversationsToClient("), code.indexOf("export async function processSponsoredLeads("));
  assert.match(fn, /findInternalTeamPhone\(phone\)/);
  assert.match(fn, /\.is\("client_id", null\)\.is\("private_at", null\)\.is\("deleted_at", null\)/);
  assert.match(fn, /\.in\("session_key", \[OFFICIAL_CONVERSATION_SESSION_KEY, responsibleUserId\]/, "só oficial e números do responsável");
  assert.match(fn, /pickUnambiguousRegistration\(await findRegistrationsByPhone\(phone\)/);
  assert.match(fn, /if \(chosen\?\.id !== clientId\) return 0;/);
  const other = { id: "b", responsible_user_id: "u2", status: "in_service" };
  assert.equal(pickUnambiguousRegistration([{ id: "a", responsible_user_id: "u1", status: "automated_service" }, other], { brokerIds: ["u1"] })?.id, "a");
  assert.equal(pickUnambiguousRegistration([{ id: "a", status: "archived" }]), null);
});

test("ficha e Chat Marketplace: campo do WhatsApp e 'Chamar no WhatsApp' pela mesma decisão do card", () => {
  const sheet = read("components/clients/ClientSheet.jsx");
  assert.match(sheet, /label="WhatsApp do cliente"/);
  assert.match(sheet, /list\.saveClientWhatsapp\(client, value\)/);
  assert.match(sheet, /Chamar no WhatsApp/);
  assert.doesNotMatch(sheet, /wa\.me|web\.whatsapp/);
  const hook = read("components/clients/useClientList.js");
  assert.match(hook, /async function saveClientWhatsapp\(client, phone\)/);
  assert.match(hook, /check-client\?clientId=/);
  const marketplace = read("components/marketplace/MarketplaceChat.jsx");
  assert.match(marketplace, /Adicionar WhatsApp do cliente/);
  assert.match(marketplace, /\/api\/simulation-registrations\/\$\{client\.id\}`, \{ method: "PATCH"/);
  assert.match(marketplace, /decideCardWhatsapp\(\{/);
  assert.match(marketplace, /router\.push\(`\/admin\/chat\?client=\$\{encodeURIComponent\(client\.id\)\}`\)/);
  assert.match(marketplace, /\{conversation\.client \? <ClientWhatsappBar/);
  assert.doesNotMatch(marketplace, /sendMessage|\/messages`, \{ method: "POST", body: JSON\.stringify\(\{ phone/);
  const server = read("lib/marketplace-chat.js");
  assert.match(server, /async function loadConversationClient\(clientId, auth\)/);
  assert.match(server, /assertCanAccessResponsibleUser\(auth, clientAccessOwnerId/);
});

test("WA-13b: cliente do Marketplace entregue pela roleta (ou redistribuído) pode receber a 1ª mensagem pelo Chat", () => {
  const at = "2026-10-23T12:00:00.000Z";
  // Entrega da roleta: cliente criado já com o corretor, histórico "assigned" para ele (lib/marketplace-chat.js distribute).
  assert.equal(isDistributionFirstMessageAllowed({ client: { responsible_user_id: "u1", responsible_changed_at: null, pending_distribution_at: null }, latestDistribution: { event_type: "assigned", to_user_id: "u1", created_at: at }, sessionOwnerId: "u1" }), true);
  // Redistribuição por prazo: moveClientTo grava responsible_changed_at logo antes do histórico "auto_transferred".
  assert.equal(isDistributionFirstMessageAllowed({ client: { responsible_user_id: "u2", responsible_changed_at: "2026-10-23T11:59:59.000Z", pending_distribution_at: null }, latestDistribution: { event_type: "auto_transferred", to_user_id: "u2", created_at: at }, sessionOwnerId: "u2" }), true);
  // Transferência manual depois da entrega continua fora (regra inalterada).
  assert.equal(isDistributionFirstMessageAllowed({ client: { responsible_user_id: "u3", responsible_changed_at: "2026-10-23T13:00:00.000Z", pending_distribution_at: null }, latestDistribution: { event_type: "assigned", to_user_id: "u3", created_at: at }, sessionOwnerId: "u3" }), false);
  const server = read("lib/marketplace-chat.js");
  assert.match(server, /eventType: transfer \? "auto_transferred" : "assigned"/);
});

test("linha do tempo: telefone adicionado aparece com quem fez (evento data_updated já existente, sem duplicar)", () => {
  const lib = read("lib/simulation-registrations.js");
  assert.match(lib, /changedFields\.push\(\{ field: "phone", fromLast4/);
  assert.equal((lib.match(/linkUnlinkedConversationsToClient/g) || []).length, 2, "import + chamada, uma vez");
  assert.match(read("lib/journey-event-labels.mjs"), /WhatsApp adicionado: final \$\{f\.toLast4\}/);
});
