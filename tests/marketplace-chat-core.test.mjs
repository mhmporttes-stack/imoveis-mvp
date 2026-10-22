import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSIGNMENT_SOURCE,
  REDISTRIBUTION_STALL_MS,
  decideRedistributionStall,
  roundRobinCycleComplete,
  evaluateOutboxGate,
  findOutboundEcho,
  matchListing,
  messagePreview,
  normalizeChatSettings,
  normalizeSyncPayload,
  normalizeFacebookMessage,
  parseFacebookWhen,
  planOutboundResult,
  shouldRedistribute,
  toOutboxPayload,
  validateOutboundText,
  routeNewConversation,
  assignMessageTimes
} from "../lib/marketplace-chat-core.mjs";

const now = new Date("2026-10-20T15:00:00Z");
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();

test("configuração: padrão 07–22h, ligado, 20 envios/h; valores inválidos voltam ao padrão", () => {
  assert.deepEqual(normalizeChatSettings({}), { syncEnabled: true, startHour: 7, endHour: 22, maxSendsPerHour: 20, firstLoadRules: [{ date: "2026-10-21", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" }, { date: "2026-10-20", userId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec" }], firstLoadIgnoreBefore: "2026-10-20" });
  // Configuração antiga (um dia só) gravada no banco: passa a valer a regra nova da 1ª carga.
  assert.equal(normalizeChatSettings({ firstSyncAssigneeId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec", firstSyncDate: "2026-10-20" }).firstLoadRules.length, 2);
  assert.deepEqual(normalizeChatSettings({ syncEnabled: false, startHour: 23, endHour: 8, maxSendsPerHour: 999, firstLoadRules: [{ date: "x", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" }, { date: "2026-10-01", userId: "nao-uuid" }], firstLoadIgnoreBefore: "x" }), { syncEnabled: false, startHour: 8, endHour: 23, maxSendsPerHour: 20, firstLoadRules: [], firstLoadIgnoreBefore: "" });
  // Um par por dia, mais recentes primeiro.
  assert.deepEqual(normalizeChatSettings({ firstLoadRules: [{ date: "2026-10-20", userId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec" }, { date: "2026-10-21", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" }, { date: "2026-10-20", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" }] }).firstLoadRules.map((rule) => rule.date), ["2026-10-21", "2026-10-20"]);
});

test("sincronização: valida conversa e mensagens; descarta o que não é do Marketplace/https", () => {
  const [conversation, ...rest] = normalizeSyncPayload({
    conversations: [
      {
        threadKey: "123456",
        threadUrl: "https://www.facebook.com/marketplace/t/123456/",
        contactName: "  Ana  ",
        contactPhotoUrl: "https://scontent.xx.fbcdn.net/a.jpg",
        listingTitle: "Casa com piscina",
        listingUrl: "https://www.facebook.com/marketplace/item/999/",
        messages: [
          { externalId: "h:1", direction: "inbound", body: "Ainda está disponível?" },
          { externalId: "", direction: "inbound", body: "sem id" },
          { externalId: "h:2", direction: "sideways", body: "x" },
          { externalId: "h:3", direction: "inbound", body: "", attachments: [{ type: "image", url: "https://scontent.xx.fbcdn.net/b.jpg" }, { url: "http://inseguro/x" }] }
        ]
      },
      { threadKey: "../../etc", messages: [] },
      { threadKey: "777", threadUrl: "https://evil.com/t/777", listingUrl: "javascript:alert(1)" }
    ]
  });
  assert.equal(conversation.contactName, "Ana");
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[1].attachments.length, 1);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].threadUrl, "");
  assert.equal(rest[0].listingUrl, "");
  assert.equal(rest[0].contactName, "Contato do Marketplace");
});

test("liga a conversa ao anúncio do CRM pelo link do item ou pelo título", () => {
  const listings = [{ id: "a", title: "Casa com Piscina", marketplace_url: "https://www.facebook.com/marketplace/item/999/" }, { id: "b", title: "Apartamento Centro", marketplace_url: null }];
  assert.equal(matchListing({ listingUrl: "https://www.facebook.com/marketplace/item/999/?ref=x" }, listings).id, "a");
  assert.equal(matchListing({ listingTitle: "apartamento centro" }, listings).id, "b");
  assert.equal(matchListing({ listingTitle: "Outro" }, listings), null);
});

test("MKT-2e prazo vencido: só conversa da roleta, prazo da regra da roleta, resposta enviada segura", () => {
  const deadlineMs = 10 * 60000; // vem do banco (REDISTRIBUIÇÃO DE LEADS); aqui só um valor de teste
  const base = { assigned_user_id: "u1", assigned_at: ago(11), assignment_source: ASSIGNMENT_SOURCE.ROULETTE, client_id: "c1", last_human_reply_at: null };
  assert.equal(shouldRedistribute(base, now, { deadlineMs }), true, "prazo vencido sem resposta → troca (cliente vai junto)");
  assert.equal(shouldRedistribute({ ...base, assigned_at: ago(5) }, now, { deadlineMs }), false, "dentro do prazo");
  assert.equal(shouldRedistribute(base, now, { deadlineMs: 15 * 60000 }), false, "prazo maior na regra = espera mais");
  assert.equal(shouldRedistribute(base, now, { deadlineMs: null }), false, "regra da roleta desligada = ninguém troca");
  assert.equal(shouldRedistribute({ ...base, last_human_reply_at: ago(8) }, now, { deadlineMs }), false, "respondeu depois de receber");
  assert.equal(shouldRedistribute({ ...base, last_human_reply_at: ago(20) }, now, { deadlineMs }), true, "resposta de antes de receber não segura");
  assert.equal(shouldRedistribute(base, now, { deadlineMs, pendingReplySince: ago(3) }), false, "resposta escrita, ainda na fila de saída");
  assert.equal(shouldRedistribute(base, now, { deadlineMs, pendingReplySince: ago(30) }), true, "fila de saída de antes de receber não segura");
  assert.equal(shouldRedistribute({ ...base, assigned_user_id: null }, now, { deadlineMs }), false);
  assert.equal(shouldRedistribute({ ...base, redistributions: 7 }, now, { deadlineMs }), true, "sem teto fixo: vale a trava da volta completa");
});

test("MKT-2e 1ª carga, transferência manual e quem respondeu assumiu ficam fora do prazo", () => {
  const deadlineMs = 10 * 60000;
  const base = { assigned_user_id: "u1", assigned_at: ago(60), last_human_reply_at: null };
  for (const source of [ASSIGNMENT_SOURCE.FIRST_LOAD, ASSIGNMENT_SOURCE.MANUAL, ASSIGNMENT_SOURCE.REPLY, ASSIGNMENT_SOURCE.ROULETTE_STALLED, null, undefined]) {
    assert.equal(shouldRedistribute({ ...base, assignment_source: source }, now, { deadlineMs }), false, String(source));
  }
});

test("MKT-2e trava da volta completa (igual à roleta) e monitoramento do job", () => {
  assert.equal(roundRobinCycleComplete({ recentHops: 4, poolSize: 4 }), true);
  assert.equal(roundRobinCycleComplete({ recentHops: 3, poolSize: 4 }), false);
  assert.equal(roundRobinCycleComplete({ recentHops: 9, poolSize: 0 }), false);
  const t = now.getTime();
  assert.equal(decideRedistributionStall(null, t).stalled, false, "sem registro: nada a medir");
  assert.equal(decideRedistributionStall({ last_ok_at: ago(4) }, t).stalled, false);
  const stalled = decideRedistributionStall({ last_ok_at: ago(30), last_error: "boom" }, t);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.minutes, 30);
  assert.equal(stalled.lastError, "boom");
  assert.equal(stalled.dedupeKey, decideRedistributionStall({ last_ok_at: ago(30) }, t + 60000).dedupeKey, "mesmo episódio = mesmo alerta");
  assert.equal(decideRedistributionStall({ first_seen_at: ago(REDISTRIBUTION_STALL_MS / 60000 + 1), last_ok_at: null }, t).stalled, true, "nunca teve sucesso");
});

test("MKT-2e no servidor: sem elegível → fila de espera, nunca volta a quem perdeu; prazo da regra da roleta; cron chama", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const lib = read("lib/marketplace-chat.js");
  const overdue = lib.slice(lib.indexOf("async function redistributeOverdue"), lib.indexOf("// Fila de espera e prazo sem resposta"));
  assert.match(overdue, /getRouletteRedistributionDeadlineMs\(\)/, "prazo = fonte única da roleta");
  assert.match(overdue, /\.eq\("assignment_source", ASSIGNMENT_SOURCE\.ROULETTE\)/);
  assert.doesNotMatch(overdue, /\.is\("client_id", null\)/, "a causa de estar parada: conversa com cliente era ignorada");
  assert.match(overdue, /excludedBrokerId: conversation\.assigned_user_id/);
  assert.match(overdue, /else if \(await moveConversationToWaiting\(conversation, now\)\)/, "ninguém liberado → fila de espera");
  const queue = lib.slice(lib.indexOf("export async function processMarketplaceDistribution"), lib.indexOf("// --- Monitoramento do job"));
  assert.match(queue, /excludedBrokerId: conversation\.lost_by_user_id/, "fila não devolve a quem perdeu");
  assert.ok(queue.indexOf("lost_by_user_id") < queue.indexOf("routeNewConversation"), "quem perdeu pelo prazo não passa pela 1ª carga");
  const reply = lib.slice(lib.indexOf("export async function queueMarketplaceReply"), lib.indexOf("export async function assignMarketplaceConversation"));
  assert.doesNotMatch(reply, /last_human_reply_at:/, "pôr na fila não é resposta enviada");
  assert.match(read("app/api/cron/scheduled-activities/route.js"), /runMarketplaceRedistributionJob/);
  assert.match(read("app/api/cron/whatsapp-flows/route.js"), /checkMarketplaceRedistributionStalled/);
  assert.match(read("lib/crm-automations.js"), /export async function getRouletteRedistributionDeadlineMs/);
});

test("fila de saída: desligado, um por vez e limite por hora", () => {
  assert.equal(evaluateOutboxGate({ syncEnabled: false }).reason, "chat_desligado");
  assert.equal(evaluateOutboxGate({ hasSending: true }).reason, "envio_em_andamento");
  assert.equal(evaluateOutboxGate({ sentLastHour: 20, maxSendsPerHour: 20 }).reason, "limite_por_hora");
  assert.equal(evaluateOutboxGate({ sentLastHour: 3 }).allowed, true);
});

test("resposta do corretor: texto obrigatório, até 2000; sem prefixo automático", () => {
  assert.throws(() => validateOutboundText("  "), /Digite/);
  assert.throws(() => validateOutboundText("x".repeat(2001)), /limite/);
  assert.equal(validateOutboundText(" Olá! "), "Olá!");
  assert.deepEqual(toOutboxPayload({ id: "m1", body: "Olá!", attempts: 1 }, { thread_key: "123", thread_url: "u" }), { id: "m1", threadKey: "123", threadUrl: "u", body: "Olá!", attempt: 1 });
});

test("retorno do envio: enviada; falha antes do Enter volta à fila (máx. 2); depois do Enter não", () => {
  const sending = { status: "sending", attempts: 1, claimed_at: ago(1) };
  assert.equal(planOutboundResult(sending, { status: "sent" }, now).status, "sent");
  assert.equal(planOutboundResult(sending, { status: "failed", retry: true, error: "x" }, now).status, "queued");
  assert.equal(planOutboundResult({ ...sending, attempts: 2 }, { status: "failed", retry: true }, now).status, "failed");
  assert.equal(planOutboundResult(sending, { status: "failed", retry: false }, now).status, "failed");
  assert.throws(() => planOutboundResult({ status: "sent" }, { status: "sent" }, now), /não está em envio/);
});

test("eco: a resposta enviada pelo CRM vista depois no Facebook não duplica", () => {
  const candidates = [{ id: "m1", external_id: null, direction: "outbound", status: "sent", body: "Está sim!", sent_at: ago(3) }];
  assert.equal(findOutboundEcho({ direction: "outbound", body: " está  sim! " }, candidates, now).id, "m1");
  assert.equal(findOutboundEcho({ direction: "inbound", body: "Está sim!" }, candidates, now), null);
  assert.equal(findOutboundEcho({ direction: "outbound", body: "Está sim!" }, [{ ...candidates[0], sent_at: ago(200) }], now), null);
  assert.equal(messagePreview({ body: "", attachments: [{}] }), "[Anexo]");
});

test("rotas: extensão só com a chave + limite; tela com requireAdminApi e escopo no lib; configuração só admin geral", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const auth = read("app/api/marketplace/chat/extension-auth.js");
  assert.match(auth, /checkPublicRateLimit/);
  assert.match(auth, /verifyPublisherToken/);
  for (const path of ["app/api/marketplace/chat/sync/route.js", "app/api/marketplace/chat/outbox/next/route.js", "app/api/marketplace/chat/outbox/[id]/result/route.js"]) {
    const source = read(path);
    assert.ok(source.indexOf("rejectExtensionRequest(request") < source.indexOf("try {"), path);
  }
  for (const path of ["app/api/admin/marketplace-chat/conversations/route.js", "app/api/admin/marketplace-chat/conversations/[id]/route.js", "app/api/admin/marketplace-chat/conversations/[id]/messages/route.js", "app/api/admin/marketplace-chat/conversations/[id]/crm/route.js"]) {
    const source = read(path);
    const handlers = source.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) || [];
    assert.equal((source.match(/await requireAdminApi\(request\)/g) || []).length, handlers.length, path);
  }
  const settings = read("app/api/admin/marketplace-chat/settings/route.js");
  assert.equal((settings.match(/await requireGeneralAdminApi\(request\)/g) || []).length, 2);
  const lib = read("lib/marketplace-chat.js");
  assert.match(lib, /assignRoundRobinLead/, "mesma roleta do Chat");
  assert.match(lib, /canSeeConversation\(scopeFor\(auth\)/, "mesmo escopo do Chat");
  assert.doesNotMatch(lib, /sendWhatsapp|sendIndividualMessage/, "nunca envia por WhatsApp");
});

test("conversa distribuída vira cliente só com o nome (dono, 2026-10-20): banco aceita telefone vazio sem fundir clientes", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const sql = read("supabase/migrations/20261020200000_marketplace_clients_without_phone.sql");
  assert.match(sql, /phone_normalized = ''/);
  assert.match(sql, /\^\\\+55\[0-9\]\{11\}\$/, "telefone preenchido continua com o formato de sempre");
  assert.match(sql, /if coalesce\(btrim\(new\.phone_normalized\), ''\) = '' then\s+return new;/, "sem telefone não entra na ponte crm_clients (senão viraria um cliente só)");
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  const registrations = read("lib/simulation-registrations.js");
  const fn = registrations.slice(registrations.indexOf("export async function createMarketplaceRegistration"), registrations.indexOf("export async function markRegistrationAutoSimulation"));
  assert.match(fn, /CLIENT_STATUS\.AUTOMATED_SERVICE/);
  assert.doesNotMatch(fn, /findMatchingRegistration/, "sem telefone não passa pelo dedupe por telefone");
  const lib = read("lib/marketplace-chat.js");
  assert.match(lib, /ensureClientForConversation\(conversation, brokerId\)/);
  assert.match(lib, /addSystemTagToClient\(registration\.id, MARKETPLACE_TAG/);
  assert.match(lib, /notification_type: "new_client"/);
  assert.match(lib, /markClientOnHumanMessage\(conversation\.client_id/);
  assert.match(lib, /if \(clientId\) await moveClientTo\(clientId, brokerId\)/, "redistribuição leva o cliente junto (mesmo caminho da roleta)");
});

test("1ª carga (REGRA OFICIAL — dono, 2026-10-21): hoje → Eduardo, ontem → Jennyfer, anteriores não importa", () => {
  const settings = normalizeChatSettings({});
  const now = new Date("2026-10-21T15:00:00Z"); // 12h em São Paulo
  // Tânia: última mensagem do cliente hoje 10:28 → Eduardo.
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-21T13:28:00Z", now, settings }), { kind: "assignee", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" });
  // Ontem (inclusive 23h de São Paulo, que já é 21/10 em UTC) → Jennyfer.
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-21T02:30:00Z", now, settings }), { kind: "assignee", userId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec" });
  // Anterior a 20/10 → não importa.
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-19T20:00:00Z", now, settings }), { kind: "ignore" });
  // Data desconhecida → fica com o admin (nunca atribui no escuro).
  assert.deepEqual(routeNewConversation({ lastActivityAt: null, now, settings }), { kind: "admin", reason: "sem_data" });
  // Dia sem par e sem 1ª carga: regra antiga (24 h → roleta; mais antiga → admin).
  const plain = normalizeChatSettings({ firstLoadRules: [], firstLoadIgnoreBefore: "" });
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-22T13:00:00Z", now: new Date("2026-10-22T14:00:00Z"), settings }), { kind: "roulette" });
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-12T20:00:00Z", now, settings: plain }), { kind: "admin" });
  assert.deepEqual(routeNewConversation({ lastActivityAt: null, now, settings: plain }), { kind: "roulette" });
});

test("1ª carga no servidor: ignora antes de gravar, vale para a fila de espera e usa a última mensagem do cliente", () => {
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const sync = lib.slice(lib.indexOf("export async function syncMarketplaceConversations"), lib.indexOf("// --- Fila de saída"));
  assert.ok(sync.indexOf('route.kind === "ignore"') < sync.indexOf(".insert({"), "ignorada não cria conversa");
  assert.match(sync, /find\(\(message\) => message\.direction === "inbound"\)/);
  const queue = lib.slice(lib.indexOf("export async function processMarketplaceDistribution"), lib.indexOf("// --- Sincronização"));
  assert.match(queue, /route\.kind === "assignee"\) \{\s*await assignDirect/);
  assert.match(queue, /waiting_distribution_at: null/);
  assert.doesNotMatch(lib, /from\(CONVERSATIONS\)\.delete\(/, "nenhuma conversa é apagada");
  // Única exclusão: mensagem LIDA do Facebook descartável na renormalização (nunca resposta escrita no CRM).
  assert.equal((lib.match(/\.delete\(\)/g) || []).length, 1);
  assert.match(lib, /from\(MESSAGES\)\.delete\(\)\.in\("id", deletes\)\.not\("external_id", "is", null\)/);
});

test("histórico importado ganha horários em ordem até a última atividade", () => {
  const timed = assignMessageTimes([{ body: "a" }, { body: "b" }, { body: "c", at: "2026-10-20T10:00:00.000Z" }], "2026-10-20T12:00:00Z");
  assert.deepEqual(timed.map((m) => m.at), ["2026-10-20T11:59:58.000Z", "2026-10-20T11:59:59.000Z", "2026-10-20T10:00:00.000Z"]);
  const [first] = normalizeSyncPayload({ conversations: [{ threadKey: "1", lastActivityAt: "2026-10-20T12:00:00Z", messages: Array.from({ length: 600 }, (_, i) => ({ externalId: `h:${i}`, direction: "inbound", body: `m${i}` })) }] });
  assert.equal(first.messages.length, 500, "histórico até 500 mensagens por conversa");
  assert.equal(first.lastActivityAt, "2026-10-20T12:00:00.000Z");
});

test("diagnóstico de estrutura: rota só com a chave da extensão; só tipos conhecidos e tamanho limitado", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const route = read("app/api/marketplace/diagnostic/route.js");
  assert.ok(route.indexOf("rejectExtensionRequest(request") < route.indexOf("try {"));
  const lib = read("lib/marketplace-chat.js");
  assert.match(lib, /DIAGNOSTIC_KINDS = new Set\(\["inbox_page", "messenger_panel", "thread", "inbox_list"\]\)/);
  assert.match(lib, /DIAGNOSTIC_MAX_BYTES/);
  const sql = read("supabase/migrations/20261020230000_marketplace_diagnostics.sql");
  assert.match(sql, /create table if not exists public\.marketplace_diagnostics/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\bdrop\b/i, "nenhum DROP fora dos comentários");
});

test("sync: conversa já gravada sem mensagens vale como 1ª sincronização (horários + rota de conversa nova)", () => {
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  assert.match(lib, /const firstContent = !existing \|\| !existing\.last_message_at;/);
  assert.match(lib, /firstContent \? assignMessageTimes\(item\.messages/);
  assert.match(lib, /if \(firstContent\) \{[\s\S]{0,400}route = routeNewConversation/);
  assert.match(lib, /if \(firstContent\) \{\s*if \(route\.kind === "assignee"\) await assignDirect/);
});

test("lista do Chat do Marketplace (dono, 2026-10-21): admin vê todas por padrão; seletor Todos/corretor/Roleta só restringe dentro do escopo do Chat", () => {
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const list = lib.slice(lib.indexOf("export async function listMarketplaceConversations"), lib.indexOf("export async function getMarketplaceConversation"));
  assert.match(list, /const scope = scopeFor\(auth\);/);
  assert.match(list, /allowedBrokerFilter\(scope, brokerId\)/, "mesmo critério do Chat do WhatsApp");
  assert.match(list, /if \(!scope\.all\) query = query\.in\("assigned_user_id", scope\.ids\);/);
  assert.match(list, /view = "all"/, "padrão = todas");
  assert.match(lib, /export const MARKETPLACE_LIST_VIEWS = \["all", "unassigned"\];/);
  assert.match(list, /scope\.all \? MARKETPLACE_LIST_VIEWS : scope\.supervisor \? \["all"\] : \[\]/, "Roleta só para o admin geral");
  assert.match(list, /if \(filterId\) query = query\.eq\("assigned_user_id", filterId\);/);
  assert.match(list, /safeView === "unassigned"\) query = query\.is\("assigned_user_id", null\)/);
  const route = readFileSync(new URL("../app/api/admin/marketplace-chat/conversations/route.js", import.meta.url), "utf8");
  assert.match(route, /requireAdminApi\(request\)/);
  assert.match(route, /view: params\.get\("view"\) \|\| "all", brokerId: params\.get\("brokerId"\) \|\| ""/);
});

test("contador do Chat Marketplace = número de conversas não lidas (como o do WhatsApp), não soma de mensagens", () => {
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const fn = lib.slice(lib.indexOf("export async function countMarketplaceUnread"), lib.indexOf("// --- Diagnóstico de estrutura"));
  assert.match(fn, /select\("id", \{ count: "exact", head: true \}\)\.gt\("unread_count", 0\)/);
  assert.match(fn, /if \(!scope\.all\) query = query\.in\("assigned_user_id", scope\.ids\);/);
  assert.doesNotMatch(fn, /reduce\(/);
});

// Rótulos REAIS do Facebook (conversa do Rafael, 2026-10-21 — nome fictício mantido como no caso).
test("mensagem do Facebook: texto, hora e direção saem do aria-label; avatar, balão vazio e aviso do Facebook saem", () => {
  const now = new Date("2026-10-21T15:00:00-03:00");
  const avatar = { type: "image", url: "https://scontent.fpoa1-1.fna.fbcdn.net/v/t39.30808-1/123_n.jpg?stp=cp0_dst-jpg_s32x32&_nc_cat=1" };
  const own = normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:18 por Você: Bom dia Rafael, tudo bem?", direction: "inbound", attachments: [avatar] }, { now });
  assert.deepEqual(own, { body: "Bom dia Rafael, tudo bem?", direction: "outbound", at: "2026-10-21T13:18:00.000Z", senderName: "", attachments: [] });
  const client = normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 28 de setembro de 2026 14:25 por Rafael: Oi, esse item está disponível?", direction: "outbound" }, { now });
  assert.deepEqual(client, { body: "Oi, esse item está disponível?", direction: "inbound", at: "2026-09-28T17:25:00.000Z", senderName: "Rafael", attachments: [] });
  // "por Você" às 10:19 que tinha virado mensagem do cliente.
  assert.equal(normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:19 por Você: Posso te ligar?", direction: "inbound" }, { now }).direction, "outbound");
  // Inglês, texto com dois-pontos.
  assert.deepEqual(normalizeFacebookMessage({ body: "Press Enter, Message sent September 28, 2026 2:25 PM by You: Hi: there", direction: "inbound" }, { now }).body, "Hi: there");
  // Só "por Rafael" (era o avatar) → descarta.
  assert.equal(normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:19 por Rafael", direction: "inbound", attachments: [avatar] }, { now }), null);
  assert.equal(normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:19 por Rafael: ", direction: "inbound" }, { now }), null);
  // Aviso do Facebook → descarta.
  assert.equal(normalizeFacebookMessage({ body: "Rafael está aguardando a sua resposta.", direction: "inbound" }, { now }), null);
  // Foto de verdade dentro do balão continua; foto igual à do contato não.
  const photo = { type: "image", url: "https://scontent.x/v/t39.1997-6/456_n.jpg" };
  assert.deepEqual(normalizeFacebookMessage({ body: "", direction: "inbound", attachments: [photo, { type: "image", url: "https://x/me.jpg" }] }, { contactPhotoUrl: "https://x/me.jpg", now }).attachments, [photo]);
  // Datas relativas.
  assert.equal(parseFacebookWhen("ontem 14:25", now), "2026-10-20T17:25:00.000Z");
  assert.equal(parseFacebookWhen("segunda-feira 09:00", now), "2026-10-19T12:00:00.000Z");
  assert.equal(parseFacebookWhen("28 de set. 14:25", now), "2026-09-28T17:25:00.000Z");
  assert.equal(parseFacebookWhen("sem hora", now), null);
});

test("sincronização: mensagens normalizadas e na ordem real (28/09 antes de hoje)", () => {
  const now = new Date("2026-10-21T15:00:00-03:00");
  const [item] = normalizeSyncPayload({ conversations: [{ threadKey: "n1", contactName: "Rafael", messages: [
    { externalId: "fb:2", direction: "inbound", body: "Pressione Enter, Mensagem enviada 10:18 por Você: Bom dia Rafael, tudo bem?" },
    { externalId: "fb:1", direction: "outbound", body: "Pressione Enter, Mensagem enviada 28 de setembro de 2026 14:25 por Rafael: Oi, esse item está disponível?" },
    { externalId: "fb:3", direction: "inbound", body: "Rafael está aguardando a sua resposta." }
  ] }] }, now);
  assert.deepEqual(item.messages.map((m) => [m.externalId, m.direction, m.body, m.senderName]), [
    ["fb:1", "inbound", "Oi, esse item está disponível?", "Rafael"],
    ["fb:2", "outbound", "Bom dia Rafael, tudo bem?", ""]
  ]);
});

test("renormalização do que já foi gravado: só mensagens lidas do Facebook, idempotente, recalcula a conversa; rota manual com auth de cron", () => {
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const fn = lib.slice(lib.indexOf("export async function renormalizeMarketplaceMessages"), lib.indexOf("// --- Diagnóstico de estrutura"));
  assert.match(fn, /apply = false/, "padrão só conta");
  assert.match(fn, /if \(!row\.external_id\) \{\s*kept\.push\(row\);\s*continue;/, "resposta do CRM nunca é tocada");
  assert.match(fn, /if \(!updates\.length && !deletes\.length\) continue;/, "idempotente");
  assert.match(fn, /last_inbound_at: lastInbound\?\.message_at/);
  assert.match(fn, /unread_count: Number\(conversation\.unread_count \|\| 0\) > 0 \? pendingInbound : 0/);
  const route = readFileSync(new URL("../app/api/cron/marketplace-messages-renormalize/route.js", import.meta.url), "utf8");
  assert.match(route, /SUPABASE_CRON_TOKEN_HASH/);
  assert.match(route, /searchParams\.get\("apply"\) === "1"/);
});
