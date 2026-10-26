// MKT-2m (REGRA OFICIAL — dono, 2026-10-26): acumulado do Marketplace com a extensão desligada. "Isso é válido apenas para
// as mensagens 'esse item ainda está disponível'. Se o cliente enviar alguma coisa diferente não recebe mensagem
// automática, e o Henry depois na cena de bom dia me diz: 'Dos 10, 8 eu já iniciei o atendimento e transferi para seus
// associados; 2 clientes eu estou aguardando sua aprovação para atender.'" + "ele soma todos os novos clientes de sábado
// às 13:00 até segunda às 8:00."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_REPLY_CANCEL,
  MARKETPLACE_BACKLOG_MS,
  autoReplyCancelReason,
  autoReplySpacingMs,
  isOnlyAvailabilityQuestion,
  normalizeChatSettings,
  pickOutboxCandidate,
  planAvailabilityAutoReply,
  planBacklogConversation,
  routeNewConversation
} from "../lib/marketplace-chat-core.mjs";
import {
  buildHenryApprovalReply,
  buildHenryAwaySentence,
  henryAwayWindow,
  isInHenryAwayWindow,
  isMarketplaceApprovalCommand,
  pickAwaitingForApproval,
  summarizeHenryAway
} from "../lib/henry-away-core.mjs";
import { composePositiveDailyFacts } from "../lib/henry-reports-positive-core.mjs";
import { HENRY_TOOL_ACCESS } from "../lib/henry-voice-core.mjs";
import { isHenryToolLocked } from "../lib/henry-lock-core.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = new Date("2026-10-27T11:00:00Z"); // terça 08:00 em São Paulo: a extensão volta
const settings = normalizeChatSettings({ firstLoadRules: [], firstLoadIgnoreBefore: "" });
const standard = (at) => ({ direction: "inbound", body: "Este item ainda está disponível?", at });
const other = (at) => ({ direction: "inbound", body: "Qual o valor do condomínio?", at });
const roulette = { kind: "roulette" };

test("acumulado: só a pergunta padrão → automática (uma vez) + roleta; outro texto → sem automática, aguardando aprovação", () => {
  const twoHours = "2026-10-27T09:00:00Z";
  assert.deepEqual(planBacklogConversation({ firstContent: true, route: roulette, messages: [standard(twoHours)], now }), { backlog: true, awaitingApproval: false });
  assert.deepEqual(planBacklogConversation({ firstContent: true, route: roulette, messages: [standard(twoHours), standard(twoHours)], now }), { backlog: true, awaitingApproval: false });
  assert.deepEqual(planBacklogConversation({ firstContent: true, route: roulette, messages: [other(twoHours)], now }), { backlog: true, awaitingApproval: true });
  assert.deepEqual(planBacklogConversation({ firstContent: true, route: roulette, messages: [standard(twoHours), other(twoHours)], now }), { backlog: true, awaitingApproval: true });
  // Extensão lendo normal (mensagem de 5 min): MKT-2/MKT-2l de sempre.
  assert.deepEqual(planBacklogConversation({ firstContent: true, route: roulette, messages: [other("2026-10-27T10:55:00Z")], now }), { backlog: false, awaitingApproval: false });
  // Já conhecida, já respondida direto no Facebook, ou 1ª carga por dia (MKT-2c): fora.
  assert.equal(planBacklogConversation({ firstContent: false, route: roulette, messages: [other(twoHours)], now }).awaitingApproval, false);
  assert.equal(planBacklogConversation({ firstContent: true, route: roulette, messages: [other(twoHours), { direction: "outbound", body: "Oi" }], now }).awaitingApproval, false);
  assert.equal(planBacklogConversation({ firstContent: true, route: { kind: "assignee", userId: "u1" }, messages: [other(twoHours)], now }).awaitingApproval, false);
  assert.equal(isOnlyAvailabilityQuestion([standard(twoHours), other(twoHours)]), false);

  // A automática do acumulado exige que TODAS as mensagens sejam a pergunta padrão; repetição = índice único por conversa.
  assert.ok(planAvailabilityAutoReply({ settings, firstContent: true, messages: [standard(twoHours)], contactName: "Ana", greeting: "Bom dia", now, onlyStandard: true }).body);
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: true, messages: [standard(twoHours), other(twoHours)], greeting: "Bom dia", now, onlyStandard: true }).skip, "nao_e_so_pergunta_padrao");
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: false, messages: [standard(twoHours)], greeting: "Bom dia", now, onlyStandard: true }).skip, "conversa_ja_conhecida");
  assert.match(read("supabase/migrations/20261024160000_marketplace_auto_reply.sql"), /create unique index if not exists marketplace_messages_auto_kind_uidx/);
});

test("acumulado de até 7 dias vai à roleta; mais antigo continua com o admin", () => {
  assert.deepEqual(routeNewConversation({ lastActivityAt: "2026-10-24T20:00:00Z", now, settings }), { kind: "roulette" });
  assert.deepEqual(routeNewConversation({ lastActivityAt: new Date(now.getTime() - MARKETPLACE_BACKLOG_MS - 60000).toISOString(), now, settings }), { kind: "admin" });
  assert.ok(planAvailabilityAutoReply({ settings, firstContent: true, messages: [standard("2026-10-24T20:00:00Z")], greeting: "Bom dia", now }).body);
});

test("ritmo: cada automática nova sai depois da última da fila (limite por hora); resposta humana sempre antes", () => {
  assert.equal(autoReplySpacingMs(20), 3 * 60 * 1000);
  const last = "2026-10-27T11:10:00Z";
  const plan = planAvailabilityAutoReply({ settings, firstContent: true, messages: [standard("2026-10-27T09:00:00Z")], greeting: "Bom dia", now, random: () => 0, lastQueuedSendAfter: last });
  assert.equal(plan.sendAfter, "2026-10-27T11:13:00.000Z");
  const auto = { id: "a", conversation_id: "c1", auto_kind: "availability", send_after: "2026-10-27T10:59:00Z", created_at: "2026-10-27T10:58:00Z" };
  const human = { id: "h", conversation_id: "c2", sender_user_id: "u1", created_at: "2026-10-27T10:59:30Z" };
  assert.equal(pickOutboxCandidate([auto, human], { now }).id, "h");
  assert.equal(pickOutboxCandidate([auto], { now }).id, "a");
});

test("na reserva: Particular, Não contactar e respondida cancelam; a extensão parada horas não cancela mais", () => {
  const row = { id: "auto", auto_kind: "availability", direction: "outbound", status: "queued", created_at: "2026-10-26T15:00:00Z" };
  const ok = { settings: { availabilityAutoReply: true }, conversation: {}, messages: [row], now };
  assert.equal(autoReplyCancelReason(row, ok), null);
  assert.equal(autoReplyCancelReason(row, { ...ok, privateContact: true }), AUTO_REPLY_CANCEL.PRIVATE);
  assert.equal(autoReplyCancelReason(row, { ...ok, doNotContactReason: "do_not_contact" }), AUTO_REPLY_CANCEL.DO_NOT_CONTACT);
  assert.equal(autoReplyCancelReason(row, { ...ok, conversation: { last_human_reply_at: "2026-10-27T10:00:00Z" } }), AUTO_REPLY_CANCEL.HUMAN_REPLIED);
});

test("servidor: aguardando aprovação não recebe automática nem roleta; aprovar (botão/voz) = distribute; só admin geral", () => {
  const chat = read("lib/marketplace-chat.js");
  const sync = chat.slice(chat.indexOf("export async function syncMarketplaceConversations"), chat.indexOf("async function scheduleAvailabilityAutoReply"));
  const awaitingAt = sync.indexOf("if (backlog.awaitingApproval");
  assert.ok(awaitingAt > 0 && awaitingAt < sync.indexOf("await scheduleAvailabilityAutoReply("), "a marca vem antes da automática");
  assert.match(sync, /await markAwaitingOwnerApproval\(updated, now\);[\s\S]{0,120}continue;/);
  assert.match(sync, /scheduleAvailabilityAutoReply\(updated, timed, chatSettings, now, \{ onlyStandard: backlog\.backlog \}\)/);
  assert.match(sync, /else if \(!updated\.awaiting_owner_approval_at && now\.getTime\(\)/, "cliente que escreve de novo não fura a aprovação");
  const approve = chat.slice(chat.indexOf("async function approveConversationRow"), chat.indexOf("function assertGeneralAdminApproval"));
  assert.match(approve, /owner_approved_by: getActingAdminEmail\(auth\)/);
  assert.match(approve, /await distribute\(\{ \.\.\.conversation, awaiting_owner_approval_at: null \}, \{ now \}\)/);
  assert.match(chat, /function assertGeneralAdminApproval\(auth\) \{\s*if \(!auth \|\| !isGeneralAdminAuth\(auth\)\)/);
  assert.match(chat, /export async function approveAwaitingMarketplaceConversations[\s\S]{0,700}if \(training\) return rows\.map/);
  const route = read("app/api/admin/marketplace-chat/conversations/[id]/approve/route.js");
  assert.match(route, /const auth = await requireGeneralAdminApi\(request, [^)]*\);\s*if \(!auth\.ok\)/);
  const screen = read("components/marketplace/MarketplaceChat.jsx");
  assert.match(screen, /canApprove && conversation\.awaitingApproval \?/);
  assert.match(read("app/admin/chat/marketplace/page.jsx"), /canApprove=\{isAdmin\}/);
  assert.match(read("supabase/migrations/20261026120000_marketplace_owner_approval.sql"), /add column if not exists awaiting_owner_approval_at timestamptz/);
});

test("janela fora do expediente: todo dia; segunda desde sábado 13:00; termina na hora do play do bom dia", () => {
  // Segunda 10:00 em SP (play do bom dia): sábado 13:00 → segunda 10:00 (domingo inteiro dentro).
  const monday = henryAwayWindow(new Date("2026-10-26T13:00:00Z"));
  assert.deepEqual(monday, { startIso: "2026-10-24T16:00:00.000Z", endIso: "2026-10-26T13:00:00.000Z" });
  assert.equal(isInHenryAwayWindow("2026-10-24T15:59:00Z", monday), false, "sábado 12:59 fora");
  assert.equal(isInHenryAwayWindow("2026-10-24T16:00:00Z", monday), true, "sábado 13:00 dentro");
  assert.equal(isInHenryAwayWindow("2026-10-25T15:00:00Z", monday), true, "domingo dentro");
  assert.equal(isInHenryAwayWindow("2026-10-26T12:59:00Z", monday), true, "segunda 09:59 dentro (play às 10:00)");
  assert.equal(isInHenryAwayWindow("2026-10-26T13:00:00Z", monday), false, "depois do play fora");
  // Terça 10:00: segunda 19:00 → terça 10:00.
  const tuesday = henryAwayWindow(new Date("2026-10-27T13:00:00Z"));
  assert.deepEqual(tuesday, { startIso: "2026-10-26T22:00:00.000Z", endIso: "2026-10-27T13:00:00.000Z" });
  assert.equal(isInHenryAwayWindow("2026-10-26T21:59:00Z", tuesday), false, "segunda 18:59 fora");
  assert.equal(isInHenryAwayWindow("2026-10-26T22:00:00Z", tuesday), true, "segunda 19:00 dentro");
  assert.equal(isInHenryAwayWindow("2026-10-27T12:00:00Z", tuesday), true, "terça 09:00 dentro");
  // Sábado 07:30: sexta 19:00 → agora.
  assert.deepEqual(henryAwayWindow(new Date("2026-10-31T10:30:00Z")), { startIso: "2026-10-30T22:00:00.000Z", endIso: "2026-10-31T10:30:00.000Z" });
  // Domingo: sábado 13:00 → agora.
  assert.deepEqual(henryAwayWindow(new Date("2026-10-25T13:00:00Z")), { startIso: "2026-10-24T16:00:00.000Z", endIso: "2026-10-25T13:00:00.000Z" });
  // Nada entrou na janela → sem a frase.
  assert.equal(buildHenryAwaySentence(summarizeHenryAway({ clients: [], awaiting: [] })), "");
});

test("frase do bom dia: total de clientes novos (sem origem), com a equipe e aguardando aprovação", () => {
  const owner = "owner";
  const clients = [
    ...Array.from({ length: 8 }, (_, index) => ({ responsible_user_id: `u${index}`, pending_distribution_at: null }))
  ];
  const summary = summarizeHenryAway({ clients, awaiting: [{ id: "c1" }, { id: "c2" }], ownerId: owner });
  assert.deepEqual(summary, { total: 10, withTeam: 8, inQueue: 0, withOwner: 0, awaitingApproval: 2 });
  const sentence = buildHenryAwaySentence(summary);
  assert.equal(sentence, "Enquanto você estava fora entraram 10 clientes novos. 8 eu já iniciei o atendimento e depois transferi para seus associados, e 2 estão aguardando sua aprovação para atender.");
  assert.doesNotMatch(sentence, /marketplace|messenger|whatsapp|site|anúncio/i);
  assert.ok(isSafeToSpeak(sentence));
  // Concordância e partes com zero (dono): 1 → "1 cliente novo"/"1 está"; X = 0 ou Y = 0 → a parte some.
  assert.equal(buildHenryAwaySentence({ total: 1, withTeam: 1 }), "Enquanto você estava fora entrou 1 cliente novo. 1 eu já iniciei o atendimento e depois transferi para seus associados.");
  assert.equal(buildHenryAwaySentence({ total: 3, withTeam: 0, awaitingApproval: 1 }), "Enquanto você estava fora entraram 3 clientes novos. 1 está aguardando sua aprovação para atender.");
  assert.equal(buildHenryAwaySentence({ total: 4, withTeam: 2, awaitingApproval: 1 }), "Enquanto você estava fora entraram 4 clientes novos. 2 eu já iniciei o atendimento e depois transferi para seus associados, e 1 está aguardando sua aprovação para atender.");
  const mixed = summarizeHenryAway({ clients: [{ responsible_user_id: owner }, { responsible_user_id: null, pending_distribution_at: "x" }, { responsible_user_id: "u1" }], ownerId: owner });
  assert.deepEqual(mixed, { total: 3, withTeam: 1, inQueue: 1, withOwner: 1, awaitingApproval: 0 });
  assert.equal(buildHenryAwaySentence({ total: 2, withTeam: 0, awaitingApproval: 0 }), "Enquanto você estava fora entraram 2 clientes novos.");
  assert.equal(buildHenryAwaySentence({ total: 0 }), "");
  assert.equal(buildHenryAwaySentence(null), "");
  // O "desde ontem" não se repete quando a frase do fim de semana existe.
  const facts = composePositiveDailyFacts({ leadsToday: null, rows: null, extras: { newClients: 12, away: summary } });
  assert.doesNotMatch(facts.text, /Desde ontem/);
  const henry = read("lib/henry-voice.js");
  assert.match(henry, /const spoken = \[prefix, reply, awaySentence, birthdayAsk\]/);
  const morning = read("lib/henry-morning.js");
  assert.match(morning, /\.gte\("created_at", window\.startIso\)\.lt\("created_at", window\.endIso\)/);
});

test("Henry aprova por voz (3ª escrita nomeada): só o dono, Treino nunca aprova de verdade", () => {
  for (const text of ["pode atender", "aprova", "Henry, pode liberar os clientes", "libera todos"]) assert.equal(isMarketplaceApprovalCommand(text), true, text);
  for (const text of ["não, depois", "libera a Carol hoje", "quantas aprovações tivemos?", ""]) assert.equal(isMarketplaceApprovalCommand(text), false, text);
  const rows = [{ id: "1", contact_name: "Ana Paula" }, { id: "2", contact_name: "Bruno Lima" }];
  assert.deepEqual(pickAwaitingForApproval(rows, "").map((row) => row.id), ["1", "2"]);
  assert.deepEqual(pickAwaitingForApproval(rows, "a Ana").map((row) => row.id), ["1"]);
  assert.deepEqual(pickAwaitingForApproval(rows, "todos").map((row) => row.id), ["1", "2"]);
  assert.equal(buildHenryApprovalReply([{ contactName: "Ana Paula", approved: true, brokerName: "Carol Souza" }, { contactName: "Bruno", approved: true, brokerName: "" }]), "Pronto, liberei 2 clientes: Ana foi para Carol e um entrou na fila da roleta.");
  assert.match(buildHenryApprovalReply([{ contactName: "Ana", simulated: true }], { training: true }), /^Modo treino: nada foi liberado de verdade/);
  assert.equal(buildHenryApprovalReply([], { none: true }), "Não tem cliente aguardando sua aprovação agora.");
  assert.equal(HENRY_TOOL_ACCESS.aprovar_atendimento_marketplace, "escrita_interna_direta");
  assert.equal(isHenryToolLocked(HENRY_TOOL_ACCESS.aprovar_atendimento_marketplace), true);
  const henry = read("lib/henry-voice.js");
  const tool = henry.slice(henry.indexOf('if (name === "aprovar_atendimento_marketplace")'), henry.indexOf('if (name === "spotify")'));
  assert.match(tool, /approveMarketplaceByHenry\(auth, \{ cliente: [^}]*\}, \{ training: Boolean\(trainingStore\.getStore\(\)\) \}\)/);
  assert.doesNotMatch(tool, /\.(insert|update|upsert|delete|rpc)\(/);
  const server = read("lib/henry-marketplace-approval.js");
  assert.match(server, /isHenryEligible\(\{ ok: auth\?\.ok === true, accountSwitchMode: auth\?\.accountSwitchMode, isOwner: isOwnerAdminEmail\(auth\?\.user\?\.email\) \}\)/);
  assert.match(server, /approveAwaitingMarketplaceConversations\(auth, picked\.map\(\(row\) => row\.id\), \{ training \}\)/);
  // O "sim" do aniversário não engole o "pode atender".
  assert.match(henry, /if \(step === "birthday" && !isMarketplaceApprovalCommand\(question\)\)/);
});
