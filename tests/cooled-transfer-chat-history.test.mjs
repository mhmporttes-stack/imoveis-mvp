import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICIAL_SESSION_KEY, TRANSFER_HISTORY_JOURNEY_TYPES, TRANSFER_HISTORY_RELEASE_SOURCE, lastResponsibleTransferCut, latestTransferHistoryCut, transferHistoryConversationAllowed, transferHistoryMessageAllowed } from "../lib/whatsapp-chat-scope.mjs";
import { transferHistoryDivider, transferHistoryNumberLabel } from "../lib/cooled-clients-core.mjs";

// FUN-15g (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16): o corretor que recebe o cliente transferido lê, somente
// leitura, o histórico das conversas do cliente com o corretor anterior, com divisor "Até aqui ... A partir daqui".

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CLIENT = "11111111-1111-4111-8111-111111111111";
const JENNYFER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ctx = { clientId: CLIENT, previousBrokerId: JENNYFER };
const conversation = (patch = {}) => ({ client_id: CLIENT, contact_phone: "5541999990000", session_key: JENNYFER, private_at: null, deleted_at: null, ...patch });

test("conversa: número pessoal do corretor anterior e oficial entram; outro cliente/outro número não", () => {
  assert.equal(transferHistoryConversationAllowed(conversation(), ctx), true);
  assert.equal(transferHistoryConversationAllowed(conversation({ session_key: OFFICIAL_SESSION_KEY }), ctx), true);
  assert.equal(transferHistoryConversationAllowed(conversation({ session_key: OTHER }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ client_id: OTHER }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ contact_phone: "group:123" }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation(), { clientId: CLIENT, previousBrokerId: "" }), false);
});

test("conversa Particular ou excluída nunca entra", () => {
  assert.equal(transferHistoryConversationAllowed(conversation({ private_at: "2026-10-10T10:00:00Z" }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ deleted_at: "2026-10-10T10:00:00Z" }), ctx), false);
});

test("mensagem: só até a transferência, sem interna/reação/apagada/outro WhatsApp pessoal", () => {
  const opts = { previousBrokerId: JENNYFER, cutoffAt: "2026-10-16T12:00:00Z", historyCutoffAt: null };
  const msg = (patch = {}) => ({ direction: "inbound", message_type: "text", message_at: "2026-10-15T12:00:00Z", session_user_id: JENNYFER, metadata: {}, ...patch });
  assert.equal(transferHistoryMessageAllowed(msg(), opts), true);
  assert.equal(transferHistoryMessageAllowed(msg({ session_user_id: null }), opts), true);
  assert.equal(transferHistoryMessageAllowed(msg({ message_at: "2026-10-16T12:00:01Z" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ direction: "internal" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ message_type: "reaction" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ metadata: { revoked_at: "2026-10-15T13:00:00Z" } }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ session_user_id: OTHER }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg(), { ...opts, historyCutoffAt: "2026-10-15T13:00:00Z" }), false);
});

test("divisor e rótulo do número", () => {
  assert.equal(transferHistoryNumberLabel({ official: true }), "oficial");
  assert.equal(transferHistoryNumberLabel({ slot: 1 }), "1");
  assert.equal(transferHistoryNumberLabel({ slot: 2, label: "Pessoal" }), "2 · Pessoal");
  assert.equal(
    transferHistoryDivider({ previousName: "Jennyfer", numberLabel: "1 · Pessoal", newName: "Gabriel" }),
    "Até aqui: conversa com Jennyfer (número 1 · Pessoal). A partir daqui: Gabriel assume."
  );
  assert.match(transferHistoryDivider({}), /^Até aqui: conversa com o corretor anterior \(número não identificado\)\. A partir daqui: o novo corretor assume\.$/);
});

test("permissão: rotas exigem login e a lib checa o escopo do responsável atual antes de ler", () => {
  for (const path of ["app/api/admin/cooled-clients/handoff/history/route.js", "app/api/admin/cooled-clients/handoff/history/media/[messageId]/route.js"]) {
    const source = read(path);
    assert.match(source, /const auth = await requireAdminApi\(request\);\n\s+if \(!auth\.ok\)/, path);
  }
  const lib = read("lib/cooled-clients.js");
  const loader = lib.slice(lib.indexOf("async function loadTransferHistoryCut"), lib.indexOf("function historyMedia"));
  assert.ok(loader.indexOf("assertCanAccessResponsibleUser(auth, registration.responsible_user_id)") < loader.indexOf("client_journey_events"));
  // Sem responsável, na fila de espera ou ainda com o corretor anterior: nada.
  assert.match(loader, /if \(!registration\.responsible_user_id \|\| registration\.pending_distribution_at\) return null/);
  assert.match(loader, /cut\.previousUserId === registration\.responsible_user_id\) return null/);
  for (const name of ["export async function getCooledChatHistory", "export async function resolveCooledHistoryMedia"]) {
    const body = lib.slice(lib.indexOf(name), lib.indexOf("\n}\n", lib.indexOf(name)));
    assert.match(body, /await loadTransferHistoryCut\(auth, clientId\)/, name);
    assert.match(body, /transferHistoryConversationAllowed/, name);
    assert.match(body, /transferHistoryMessageAllowed/, name);
  }
});

test("somente leitura: nada é copiado, gravado nem enviado", () => {
  const lib = read("lib/cooled-clients.js");
  const section = lib.slice(lib.indexOf("const HISTORY_MESSAGE_LIMIT"));
  assert.doesNotMatch(section, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(section, /ensureInboundMediaStored/);
  const component = read("components/cooled/CooledChatHistory.jsx");
  assert.doesNotMatch(component, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(component, /<textarea|sendChat|sendWhatsapp|whatsapp-chat\/conversations/i);
  assert.match(component, /data-transfer-divider/);
  assert.match(read("components/clients/ClientSheet.jsx"), /<CooledChatHistory clientId=\{registration\.id\} \/>/);
});

// FUN-15g estendida (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16, "Sim"): o mesmo histórico na transferência manual de
// responsável e no "Devolver para a roleta" fora do fluxo. Corte = a transferência elegível mais recente.
test("corte: a transferência elegível mais recente (manual, devolver à roleta, liberar no Chat, FUN-15)", () => {
  assert.deepEqual(TRANSFER_HISTORY_JOURNEY_TYPES, ["manual", "distributed", "roulette"]);
  assert.equal(TRANSFER_HISTORY_RELEASE_SOURCE, "whatsapp_chat_release");
  assert.equal(latestTransferHistoryCut([]), null);
  assert.equal(latestTransferHistoryCut([{ previousUserId: "", at: "2026-10-16T10:00:00Z" }, { previousUserId: JENNYFER, at: "" }]), null);
  const cut = latestTransferHistoryCut([
    { previousUserId: OTHER, at: "2026-10-10T10:00:00Z", source: "cooled" },
    { previousUserId: JENNYFER, at: "2026-10-16T10:00:00Z", source: "journey:manual" },
    { previousUserId: OTHER, at: "2026-10-12T10:00:00Z", source: "chat_release" }
  ]);
  assert.deepEqual(cut, { previousUserId: JENNYFER, at: "2026-10-16T10:00:00Z", source: "journey:manual" });
});

test("corte lido só do que as ações já gravam (sem migration), redistribuição automática incluída", () => {
  const lib = read("lib/cooled-clients.js");
  const loader = lib.slice(lib.indexOf("async function loadTransferHistoryCut"), lib.indexOf("function historyMedia"));
  assert.match(loader, /from\("client_journey_events"\)[\s\S]*eq\("event_type", "responsible_transferred"\)[\s\S]*in\("details->>transferType", TRANSFER_HISTORY_JOURNEY_TYPES\)/);
  // Toda a linha da roleta (não só o "Ninguém (liberar)"): assigned + auto_transferred.
  assert.match(loader, /from\("lead_distribution_history"\)[\s\S]*in\("event_type", \["assigned", "auto_transferred"\]\)/);
  assert.doesNotMatch(loader, /TRANSFER_HISTORY_RELEASE_SOURCE/);
  assert.match(loader, /from\("cooled_client_cases"\)[\s\S]*eq\("decision", "transferred"\)/);
  assert.match(loader, /lastResponsibleTransferCut\(/);
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete)\(/);
  // Os caminhos que gravam esses registros continuam gravando com o "de quem" e o tipo.
  assert.match(read("lib/simulation-registrations.js"), /eventType: "responsible_transferred",[\s\S]{0,200}transferType: "manual"/);
  assert.match(read("lib/lead-distribution.js"), /eventType: "responsible_transferred",[\s\S]{0,200}fromId: fromUserId[\s\S]{0,200}transferType: "roulette"/);
  assert.match(read("lib/whatsapp-chat.js"), /fromUserId: client\.responsible_user_id \|\| null,[\s\S]{0,120}source: "whatsapp_chat_release"/);
  // Caminhos AUTOMÁTICOS: gravam o "de quem" (ou a entrada na fila de espera, de onde sai o anterior da entrega).
  assert.match(read("lib/crm-automations.js"), /eventType: "auto_transferred",\s*fromUserId: client\.responsible_user_id,\s*toUserId: nextBrokerId/);
  const distributionLib = read("lib/lead-distribution.js");
  assert.match(distributionLib, /eventType: "auto_transferred",\s*fromUserId,\s*toUserId: ownerId,\s*details: \{ toWaitingQueue: true/);
  assert.match(distributionLib, /eventType: "assigned",\s*toUserId: roulette\.brokerId,\s*details: \{[^}]*fromWaitingQueue: true/);
  assert.match(distributionLib, /details: \{ manualReturnToRoulette: true, toWaitingQueue: waiting/);
  assert.match(read("lib/whatsapp-flows.js"), /eventType: "auto_transferred",\s*fromUserId: currentResponsibleId,\s*toUserId: roulette\.brokerId/);
  const sponsored = read("lib/whatsapp-sponsored-lead.js");
  assert.match(sponsored, /eventType: "assigned",\s*fromUserId: ownerId,\s*toUserId: brokerId,/);
  assert.match(sponsored, /waitingForBroker: !brokerId/);
  assert.match(read("lib/simulation-registrations.js"), /heldByOwner: true/);
});

// FUN-15h ampliada (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16): "deve mostrar sim, inclusive as que já foram
// transferidas pela regra" — toda redistribuição automática é corte, calculada na leitura (vale para as antigas).
const OWNER = "44444444-4444-4444-8444-444444444444";
const GABRIEL = "55555555-5555-4555-8555-555555555555";
const ldh = (event_type, from_user_id, to_user_id, created_at, details = {}) => ({ event_type, from_user_id, to_user_id, created_at, details });

test("automático: prazo vencido (REDISTRIBUIÇÃO), Fluxos e liberar no Chat abrem corte com o anterior", () => {
  for (const details of [{ ruleName: "REDISTRIBUIÇÃO DE LEADS" }, { reason: "Resposta a campanha de disparo — sem corretor ativo", flowId: "f" }, { source: "whatsapp_chat_release" }]) {
    const cut = lastResponsibleTransferCut({ distribution: [ldh("assigned", null, JENNYFER, "2026-10-16T09:00:00Z"), ldh("auto_transferred", JENNYFER, GABRIEL, "2026-10-16T09:10:00Z", details)] });
    assert.equal(cut.previousUserId, JENNYFER);
    assert.equal(cut.at, "2026-10-16T09:10:00Z");
  }
});

test("automático depois de manual: vale a troca mais recente (não fica no corte antigo)", () => {
  const cut = lastResponsibleTransferCut({
    journey: [{ occurred_at: "2026-10-10T10:00:00Z", details: { fromId: OTHER, toId: JENNYFER, transferType: "manual" } }],
    distribution: [ldh("auto_transferred", JENNYFER, GABRIEL, "2026-10-16T10:00:00Z")]
  });
  assert.deepEqual(cut, { previousUserId: JENNYFER, at: "2026-10-16T10:00:00Z", source: "distribution:auto_transferred" });
});

test("fila de espera: entrega automática vem de quem segurava (o dono), como a transferência à mão confirmada", () => {
  // Prazo vencido sem ninguém on-line → dono na fila → entregue ao Gabriel.
  const prazo = lastResponsibleTransferCut({ distribution: [
    ldh("assigned", null, JENNYFER, "2026-10-16T09:00:00Z"),
    ldh("auto_transferred", JENNYFER, OWNER, "2026-10-16T09:10:00Z", { toWaitingQueue: true }),
    ldh("assigned", null, GABRIEL, "2026-10-16T09:30:00Z", { fromWaitingQueue: true })
  ] });
  assert.deepEqual(prazo, { previousUserId: OWNER, at: "2026-10-16T09:30:00Z", source: "distribution:assigned" });
  // Cadastro novo segurado pelo dono (ninguém on-line) → fila → Gabriel.
  assert.equal(lastResponsibleTransferCut({ distribution: [
    ldh("assigned", null, OWNER, "2026-10-16T09:00:00Z", { heldByOwner: true }),
    ldh("assigned", null, GABRIEL, "2026-10-16T09:30:00Z", { fromWaitingQueue: true })
  ] }).previousUserId, OWNER);
  // "Devolver para a roleta" sem ninguém on-line (linha do tempo + espelho do FUN-15) → fila → Gabriel.
  assert.equal(lastResponsibleTransferCut({
    journey: [{ occurred_at: "2026-10-16T09:10:00Z", details: { fromId: JENNYFER, toId: OWNER, transferType: "roulette", waitingQueue: true } }],
    cooled: [{ broker_id: JENNYFER, decided_at: "2026-10-16T09:10:01Z" }],
    distribution: [ldh("assigned", null, GABRIEL, "2026-10-16T09:30:00Z", { fromWaitingQueue: true })]
  }).previousUserId, OWNER);
  // Anúncio liberado sem ninguém on-line (fica com o dono) → fila → Gabriel.
  assert.equal(lastResponsibleTransferCut({ distribution: [
    ldh("assigned", OWNER, null, "2026-10-16T09:10:00Z", { source: "whatsapp_ad", via: "anuncio_silencio", waitingForBroker: true }),
    ldh("assigned", null, GABRIEL, "2026-10-16T09:30:00Z", { fromWaitingQueue: true }),
    ldh("assigned", OWNER, null, "2026-10-16T09:30:02Z", { source: "whatsapp_ad", waitingForBroker: true, deliveredByQueue: true })
  ] }).previousUserId, OWNER);
});

test("anúncio: resposta/formulário/silêncio com corretor on-line saem do dono", () => {
  const cut = lastResponsibleTransferCut({ distribution: [ldh("assigned", OWNER, GABRIEL, "2026-10-16T12:00:00Z", { source: "whatsapp_ad", via: "anuncio_silencio" })] });
  assert.deepEqual(cut, { previousUserId: OWNER, at: "2026-10-16T12:00:00Z", source: "distribution:assigned:whatsapp_ad" });
});

test("anterior desconhecido na última troca: sem corte (nunca cai num corte antigo de outra pessoa)", () => {
  // Cadastro novo: não houve troca.
  assert.equal(lastResponsibleTransferCut({ distribution: [ldh("assigned", null, GABRIEL, "2026-10-16T09:00:00Z")] }), null);
  // Entrega da fila sem registro de quem segurava (cliente estava sem responsável): sem corte, mesmo com manual antiga.
  assert.equal(lastResponsibleTransferCut({
    journey: [{ occurred_at: "2026-10-01T10:00:00Z", details: { fromId: OTHER, toId: JENNYFER, transferType: "manual" } }],
    distribution: [ldh("assigned", null, GABRIEL, "2026-10-16T09:30:00Z", { fromWaitingQueue: true })]
  }), null);
  // Fluxo com cliente sem responsável.
  assert.equal(lastResponsibleTransferCut({ distribution: [ldh("auto_transferred", null, GABRIEL, "2026-10-16T09:30:00Z")] }), null);
  // Troca para a mesma pessoa é ignorada (vale a anterior).
  assert.equal(lastResponsibleTransferCut({ distribution: [ldh("auto_transferred", JENNYFER, GABRIEL, "2026-10-16T09:00:00Z"), ldh("auto_transferred", GABRIEL, GABRIEL, "2026-10-16T10:00:00Z")] }).previousUserId, JENNYFER);
  assert.equal(lastResponsibleTransferCut({}), null);
});

test("casos confirmados pelo dono continuam: fila → à mão = vem do dono; manual/devolver/FUN-15 como antes", () => {
  assert.equal(lastResponsibleTransferCut({
    distribution: [ldh("auto_transferred", JENNYFER, OWNER, "2026-10-16T09:10:00Z", { toWaitingQueue: true })],
    journey: [{ occurred_at: "2026-10-16T09:20:00Z", details: { fromId: OWNER, toId: GABRIEL, transferType: "manual" } }]
  }).previousUserId, OWNER);
  assert.deepEqual(lastResponsibleTransferCut({
    cooled: [{ broker_id: OTHER, decided_at: "2026-10-10T10:00:00Z" }],
    journey: [{ occurred_at: "2026-10-16T10:00:00Z", details: { fromId: JENNYFER, toId: GABRIEL, transferType: "manual" } }]
  }), { previousUserId: JENNYFER, at: "2026-10-16T10:00:00Z", source: "journey:manual" });
});
