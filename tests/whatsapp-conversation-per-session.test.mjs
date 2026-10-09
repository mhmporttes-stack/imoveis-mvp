// Isolamento do Chat por SESSÃO (2026-10-02): a conversa é (telefone + número
// do WhatsApp que conversa com o contato). Estes testes rodam o código REAL de
// lib/whatsapp-individual-inbound.js e lib/whatsapp-chat.js contra um Supabase
// falso em memória (tests/helpers) — nada de rede, dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createFakeSupabase, NIL } from "./helpers/fake-supabase.mjs";

register("./helpers/chat-test-loader.mjs", import.meta.url);

const A = "aaaaaaaa-0000-4000-8000-00000000000a"; // corretor A
const B = "bbbbbbbb-0000-4000-8000-00000000000b"; // corretor B
const G = "99999999-0000-4000-8000-0000000000a9"; // gestor de A (não de B)
const ADM = "dddddddd-0000-4000-8000-0000000000ad"; // administrador geral
const CLIENT_PHONE = "5514999990001";

let fake;
const sent = []; // envios feitos pelas sessões individuais
const connected = new Set([A, B]);

function setupStubs() {
  globalThis.__stubs = {
    supabase: { getSupabaseAdminClient: () => fake.client },
    "client-phone-lookup": {
      findLatestRegistrationIdsByPhones: async (phones) => new Map(phones.map((p) => [p, fake.tables.simulation_registrations.find((r) => r.phone_normalized === p)?.id || null])),
      findConversationByPhone: async () => null
    },
    "whatsapp-client-status": { markClientsInServiceOnReply: async () => {}, markClientOnHumanMessage: async () => {}, startServiceOnManualAdd: async () => {} },
    "internal-phones": { findInternalTeamPhone: async () => null },
    "whatsapp-attendance": { markConversationHumanReply: async () => {} },
    "whatsapp-human-contact": { registerHumanContact: async () => ({ counted: true }), isAutomationEchoForBroker: async () => false },
    "whatsapp-form-reminder": { isFormReminderEcho: async () => false },
    "push-subscriptions": { sendPushToUser: async () => {} },
    // Acesso WhatsApp por corretor (2026-10-04): ninguém bloqueado nestes cenários (o push só sai para quem não está bloqueado).
    "whatsapp-access": { isWhatsappAccessBlocked: async () => false, isChatPushSuppressed: async () => false },
    // Chat ligado e envio pessoal liberado nestes cenários (lib/chat-control.js; o modo híbrido tem testes próprios).
    "chat-control": {
      CHAT_DISABLED_CODE: "CHAT_DISABLED",
      CHAT_DISABLED_MESSAGE: "Chat desativado.",
      CHAT_INDIVIDUAL_DISABLED_CODE: "CHAT_INDIVIDUAL_DISABLED",
      CHAT_INDIVIDUAL_DISABLED_MESSAGE: "Envio pelo WhatsApp pessoal desativado.",
      isChatDisabled: async () => false,
      isIndividualChatSendDisabled: async () => false
    },
    "whatsapp-flows": { endLiveFlowSession: async () => {} },
    "whatsapp-chat": { broadcastChatChanged: async () => {}, getUnreadMessageCountForBroker: async () => 0 },
    "admin-profiles": {
      isGeneralAdminAuth: (auth) => auth?.profile?.role === "admin",
      isManagerProfile: (profile) => profile?.role === "manager",
      isBrokerProfile: (profile) => profile?.role === "broker",
      isOwnerAdminEmail: () => false,
      listAdminProfiles: async () => [],
      getAdminProfileById: async () => null,
      buildBrokerSimulationLink: () => ""
    },
    "simulation-registration-schema": { hasSimulationData: () => false },
    "whatsapp-individual": {
      getIndividualSessionStatusForUser: async (userId) => (connected.has(userId) ? "connected" : userId ? "disconnected" : null),
      // Dois números (2026-10-08): estes cenários só têm o Número 1 de cada corretor.
      getIndividualSessionStatusForSlot: async (userId, slot = 1) => (slot !== 1 ? null : connected.has(userId) ? "connected" : userId ? "disconnected" : null),
      listIndividualSessionRows: async (userId) => (userId ? [{ user_id: userId, slot: 1, status: connected.has(userId) ? "connected" : "disconnected" }] : []),
      listIndividualSessionRowsByUser: async () => new Map(),
      listIndividualSessionStatuses: async () => new Map(),
      sendIndividualMessage: async (userId, payload) => { sent.push({ userId, ...payload }); return { messageId: `WA-OUT-${sent.length}`, remoteJid: "x@s.whatsapp.net" }; },
      editIndividualMessage: async () => ({}), deleteIndividualMessageForEveryone: async () => ({}), reactIndividualMessage: async () => ({})
    }
  };
}

const auths = {
  A: { profile: { id: A, role: "broker", managedUserIds: null }, user: { email: "a@t" } },
  B: { profile: { id: B, role: "broker", managedUserIds: null }, user: { email: "b@t" } },
  G: { profile: { id: G, role: "manager", managedUserIds: [G, A] }, user: { email: "g@t" } },
  ADM: { profile: { id: ADM, role: "admin" }, user: { email: "adm@t" } }
};

let inbound;
let chat;

async function boot(uniqueMode = "session") {
  fake = createFakeSupabase({ uniqueMode });
  sent.length = 0;
  setupStubs();
  // módulos de lib/ importam outros de lib/ -> stubs configurados acima
  // (import dinâmico + cache-bust para cada cenário começar limpo)
  const stamp = Date.now() + Math.random();
  inbound = await import(`../lib/whatsapp-individual-inbound.js?${stamp}`);
  chat = await import(`../lib/whatsapp-chat.js?${stamp}`);
}

const event = (userId, waMessageId, text, extra = {}) => ({ userId, from: CLIENT_PHONE, text, waMessageId, at: new Date().toISOString(), contactName: "Cliente Sintético", fromMe: false, ...extra });
const conversationsOf = () => fake.tables.whatsapp_conversations.filter((c) => c.contact_phone.endsWith(CLIENT_PHONE.slice(-8)));
const messagesOf = (conversationId) => fake.tables.whatsapp_messages.filter((m) => m.conversation_id === conversationId);

test("1-2. cliente fala só com A; depois também com B: DUAS conversas, uma por sessão", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "oi corretor A"));
  assert.equal(conversationsOf().length, 1);
  assert.equal(conversationsOf()[0].session_key, A);

  await inbound.projectIndividualInboundMessage(event(B, "WA-2", "oi corretor B"));
  const convs = conversationsOf();
  assert.equal(convs.length, 2, "o mesmo telefone abriu a conversa do outro número");
  const convA = convs.find((c) => c.session_key === A);
  const convB = convs.find((c) => c.session_key === B);
  assert.ok(convA && convB);
  assert.equal(convA.last_message_preview, "oi corretor A");
  assert.equal(convB.last_message_preview, "oi corretor B");
  assert.equal(convA.unread_count, 1);
  assert.equal(convB.unread_count, 1);
});

test("3-4. A não vê a sessão de B e B não vê a de A (lista, detalhe, preview e não lidas)", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "segredo de A"));
  await inbound.projectIndividualInboundMessage(event(B, "WA-2", "segredo de B"));
  // O cliente (CRM) é de A, mas B também tem conversa com o mesmo telefone.
  const reg = fake.tables.simulation_registrations[0];
  assert.ok(reg);

  const listA = await chat.listChatConversations({}, auths.A);
  const listB = await chat.listChatConversations({}, auths.B);
  assert.deepEqual(listA.map((c) => c.sessionUserId), [A]);
  assert.deepEqual(listB.map((c) => c.sessionUserId), [B]);
  assert.equal(listA[0].lastMessagePreview, "segredo de A");
  assert.equal(listB[0].lastMessagePreview, "segredo de B");

  const convA = conversationsOf().find((c) => c.session_key === A);
  const convB = conversationsOf().find((c) => c.session_key === B);
  const detailA = await chat.getChatConversation(convA.id, {}, auths.A);
  assert.deepEqual(detailA.messages.map((m) => m.body), ["segredo de A"]);
  await assert.rejects(() => chat.getChatConversation(convB.id, {}, auths.A), /acesso/);
  await assert.rejects(() => chat.getChatConversation(convA.id, {}, auths.B), /acesso/);

  // Não lidas por corretor = só as conversas da própria linha.
  assert.equal(await chat.getUnreadMessageCountForBroker(A), 1);
  assert.equal(await chat.getUnreadMessageCountForBroker(B), 1);
  const summaryA = await chat.getChatSummary(auths.A);
  assert.equal(summaryA.unreadMessages, 1);
});

test("a mesma pessoa NÃO vê a conversa do outro número mesmo sendo responsável pelo cliente", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(B, "WA-9", "mensagem no WhatsApp de B"));
  const reg = fake.tables.simulation_registrations[0];
  reg.responsible_user_id = A; // cliente é do corretor A, mas conversou com o número de B
  const listA = await chat.listChatConversations({}, auths.A);
  assert.equal(listA.length, 0);
  const convB = conversationsOf()[0];
  await assert.rejects(() => chat.getChatConversation(convB.id, {}, auths.A), /acesso/);
});

test("5-6. admin vê tudo; gestor respeita a hierarquia (vê a linha de A, não a de B)", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "linha A"));
  await inbound.projectIndividualInboundMessage(event(B, "WA-2", "linha B"));
  const admin = await chat.listChatConversations({}, auths.ADM);
  assert.deepEqual(admin.map((c) => c.sessionUserId).sort(), [A, B].sort());
  const gestor = await chat.listChatConversations({}, auths.G);
  assert.deepEqual(gestor.map((c) => c.sessionUserId), [A]);
  const convB = conversationsOf().find((c) => c.session_key === B);
  await assert.rejects(() => chat.getChatConversation(convB.id, {}, auths.G), /acesso/);
});

test("7. resposta enviada por A sai pela sessão de A e fica na conversa de A", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "pergunta"));
  await inbound.projectIndividualInboundMessage(event(B, "WA-2", "outra pergunta"));
  const convA = conversationsOf().find((c) => c.session_key === A);
  const convB = conversationsOf().find((c) => c.session_key === B);
  // Atribuição "bagunçada" (legado): a conversa de A está atribuída a B. O envio NÃO pode seguir o atribuído.
  convA.assigned_user_id = B;
  const row = await chat.sendChatMessage(convA.id, "resposta de A", auths.A);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, A, "saiu pelo WhatsApp errado");
  assert.equal(row.channel, "whatsapp_individual");
  const stored = messagesOf(convA.id).find((m) => m.body === "resposta de A");
  assert.equal(stored.session_user_id, A);
  assert.equal(messagesOf(convB.id).some((m) => m.body === "resposta de A"), false);
  assert.equal(convB.last_message_preview, "outra pergunta");
  // A não consegue responder na conversa de B.
  await assert.rejects(() => chat.sendChatMessage(convB.id, "invasão", auths.A), /acesso/);
  assert.equal(sent.length, 1);
});

test("7b. sessão do dono desconectada: bloqueia, nunca cai no WhatsApp de outro", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "oi"));
  const convA = conversationsOf()[0];
  connected.delete(A);
  try {
    await assert.rejects(() => chat.sendChatMessage(convA.id, "tentativa", auths.A), /desconectado/i);
    assert.equal(sent.length, 0);
  } finally { connected.add(A); }
});

test("8-9. webhook recebido por B fica na sessão de B; telefone igual não cruza", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "para A"));
  await inbound.projectIndividualInboundMessage(event(B, "WA-2", "para B"));
  await inbound.projectIndividualInboundMessage(event(B, "WA-3", "para B de novo"));
  const convA = conversationsOf().find((c) => c.session_key === A);
  const convB = conversationsOf().find((c) => c.session_key === B);
  assert.deepEqual(messagesOf(convA.id).map((m) => m.body), ["para A"]);
  assert.deepEqual(messagesOf(convB.id).map((m) => m.body).sort(), ["para B", "para B de novo"].sort());
  assert.ok(messagesOf(convB.id).every((m) => m.session_user_id === B));
  assert.ok(messagesOf(convA.id).every((m) => m.session_user_id === A));
});

test("10. a MESMA mensagem entre dois colegas (mesmo wa_message_id nas duas pontas) é guardada nas duas sessões", async () => {
  await boot();
  // A escreve para B (A -> número de B): a sessão de A recebe o eco (fromMe), a de B recebe como entrada.
  const wa = "SHARED-WA-ID-1";
  await inbound.projectIndividualInboundMessage({ userId: A, from: CLIENT_PHONE, text: "oi, B", waMessageId: wa, fromMe: true, at: new Date().toISOString() });
  await inbound.projectIndividualInboundMessage({ userId: B, from: CLIENT_PHONE, text: "oi, B", waMessageId: wa, fromMe: false, at: new Date().toISOString(), contactName: "Colega" });
  const stored = fake.tables.whatsapp_messages.filter((m) => m.metadata?.wa_message_id === wa);
  assert.equal(stored.length, 2, "a segunda ponta foi descartada pela colisão de wa_message_id");
  assert.deepEqual(stored.map((m) => m.session_user_id).sort(), [A, B].sort());
  assert.notEqual(stored[0].conversation_id, stored[1].conversation_id);
});

test("prova da causa raiz: no banco ANTIGO o telefone era único e wa_message_id era global", async () => {
  fake = createFakeSupabase({ uniqueMode: "legacy" });
  const db = fake.client;
  const first = await db.from("whatsapp_conversations").insert({ contact_phone: CLIENT_PHONE, session_key: A });
  assert.equal(first.error, null);
  // A conversa do mesmo telefone na sessão de B não podia existir -> as duas sessões dividiam UMA conversa.
  const second = await db.from("whatsapp_conversations").insert({ contact_phone: CLIENT_PHONE, session_key: B });
  assert.equal(second.error?.code, "23505");
  // E a mesma mensagem (mesmo wa_message_id) vista pela 2ª sessão era descartada pelo índice global.
  const conv = fake.tables.whatsapp_conversations[0];
  const m1 = await db.from("whatsapp_messages").insert({ conversation_id: conv.id, channel: "whatsapp_individual", session_user_id: A, metadata: { wa_message_id: "X" } });
  const m2 = await db.from("whatsapp_messages").insert({ conversation_id: conv.id, channel: "whatsapp_individual", session_user_id: B, metadata: { wa_message_id: "X" } });
  assert.equal(m1.error, null);
  assert.equal(m2.error?.code, "23505");
});

test("conversa do número oficial atribuída ao corretor vira a conversa do WhatsApp pessoal dele (mesmo histórico)", async () => {
  await boot();
  fake.tables.whatsapp_conversations.push({ id: "11111111-0000-4000-8000-000000000001", contact_phone: CLIENT_PHONE, session_key: NIL, assigned_user_id: A, status: "open", unread_count: 0, origin: {}, client_id: null, deleted_at: null, last_message_at: null });
  const result = await inbound.projectIndividualInboundMessage(event(A, "WA-1", "agora no meu WhatsApp"));
  assert.equal(result.conversationId, "11111111-0000-4000-8000-000000000001");
  assert.equal(conversationsOf().length, 1);
  assert.equal(conversationsOf()[0].session_key, A);
});

test("conversa do oficial atribuída a OUTRO corretor não é adotada: o corretor que recebeu abre a própria", async () => {
  await boot();
  fake.tables.whatsapp_conversations.push({ id: "11111111-0000-4000-8000-000000000002", contact_phone: CLIENT_PHONE, session_key: NIL, assigned_user_id: A, status: "open", unread_count: 0, origin: {}, client_id: null, deleted_at: null, last_message_at: null });
  await inbound.projectIndividualInboundMessage(event(B, "WA-7", "falei com B"));
  const convs = conversationsOf();
  assert.equal(convs.length, 2);
  assert.equal(convs.find((c) => c.session_key === NIL).assigned_user_id, A);
  assert.equal(convs.find((c) => c.session_key === B).session_key, B);
});

test("reação/edição/apagar e recibos só alcançam a cópia da PRÓPRIA sessão", async () => {
  await boot();
  const wa = "SHARED-WA-ID-2";
  await inbound.projectIndividualInboundMessage({ userId: A, from: CLIENT_PHONE, text: "original", waMessageId: wa, fromMe: true, at: new Date().toISOString() });
  await inbound.projectIndividualInboundMessage({ userId: B, from: CLIENT_PHONE, text: "original", waMessageId: wa, fromMe: false, at: new Date().toISOString() });
  const result = await inbound.projectIndividualChatAction({ userId: B, kind: "edit", from: CLIENT_PHONE, fromMe: false, waMessageId: "E1", targetId: wa, newText: "editada", at: new Date().toISOString() });
  assert.ok(result.edit, JSON.stringify(result));
  const copyA = fake.tables.whatsapp_messages.find((m) => m.session_user_id === A && m.metadata.wa_message_id === wa);
  const copyB = fake.tables.whatsapp_messages.find((m) => m.session_user_id === B && m.metadata.wa_message_id === wa);
  assert.equal(copyA.body, "original");
  assert.equal(copyB.body, "editada");
  await inbound.projectIndividualMessageStatus({ userId: A, waMessageId: wa, status: "delivered" });
  assert.equal(copyA.status, "delivered");
  assert.notEqual(copyB.status, "delivered");
});

test("botão WhatsApp do card abre a conversa da sessão do RESPONSÁVEL, nunca a de outro número com o mesmo telefone", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(B, "WA-1", "falou com B"));
  await inbound.projectIndividualInboundMessage(event(A, "WA-2", "falou com A"));
  const reg = fake.tables.simulation_registrations[0];
  reg.responsible_user_id = A;
  reg.phone_normalized = CLIENT_PHONE;
  const convA = conversationsOf().find((c) => c.session_key === A);
  const opened = await chat.openChatForClient(reg.id, auths.A);
  assert.equal(opened.conversationId, convA.id);
  // Corretor B não é responsável pelo cliente: não abre nada.
  await assert.rejects(() => chat.openChatForClient(reg.id, auths.B), /acesso/);
  // Cliente sem conversa na sessão do responsável: cria a DELE (não reaproveita a de B).
  const reg2 = { id: "22222222-0000-4000-8000-000000000002", full_name: "Outro Cliente", phone: "5514999990002", phone_normalized: "5514999990002", responsible_user_id: A };
  fake.tables.simulation_registrations.push(reg2);
  await inbound.projectIndividualInboundMessage({ ...event(B, "WA-3", "só B"), from: "5514999990002" });
  const opened2 = await chat.openChatForClient(reg2.id, auths.A);
  const created = fake.tables.whatsapp_conversations.find((c) => c.id === opened2.conversationId);
  assert.equal(created.session_key, A);
  assert.equal(fake.tables.whatsapp_conversations.filter((c) => c.contact_phone.endsWith("90002")).length, 2);
});

test("a conversa do WhatsApp de A não é entregue a outra pessoa (nem por gestor/admin)", async () => {
  await boot();
  await inbound.projectIndividualInboundMessage(event(A, "WA-1", "oi"));
  const convA = conversationsOf()[0];
  await assert.rejects(() => chat.assignChatConversation(convA.id, B, auths.ADM), (error) => error.code === "SESSION_CONVERSATION");
  await assert.rejects(() => chat.assignChatConversation(convA.id, ADM, auths.ADM), (error) => error.code === "SESSION_CONVERSATION");
  assert.equal(convA.session_key, A);
});

test("estrutura: nenhuma busca/criação de conversa só por telefone sobrou no código", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const file of ["lib/whatsapp-individual-inbound.js", "lib/whatsapp-chat.js", "lib/whatsapp-sponsored-lead.js", "lib/client-phone-lookup.js"]) {
    assert.ok(!/onConflict:\s*"contact_phone"/.test(read(file)), `${file}: upsert por telefone`);
  }
  assert.match(read("lib/client-phone-lookup.js"), /anySession/);
  const chat = read("lib/whatsapp-chat.js");
  assert.ok(!/session_user_id: sendChannel === "individual" \? assignedUserId : null[\s\S]{0,40}conversation\.assigned_user_id/.test(chat));
  const migration = read("supabase/migrations/20261002290100_whatsapp_conversation_per_session_split.sql");
  assert.match(migration, /drop constraint if exists whatsapp_conversations_contact_phone_key/);
  assert.match(migration, /\(session_user_id, \(\(metadata ->> 'wa_message_id'\)\)\)/);
  assert.match(migration, /whatsapp_conversation_split_log/);
});
