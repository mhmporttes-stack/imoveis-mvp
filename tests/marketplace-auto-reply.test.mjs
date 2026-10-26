// MKT-2l (REGRA OFICIAL — dono, 2026-10-24): resposta automática à pergunta padrão de disponibilidade do Marketplace,
// e o filtro da sugestão de resposta rápida ("Sim, você tem interesse?") que entrava como mensagem do cliente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_REPLY_CANCEL,
  AUTO_REPLY_MAX_DELAY_MS,
  AUTO_REPLY_MIN_DELAY_MS,
  autoReplyCancelPatch,
  autoReplyCancelReason,
  autoReplyFirstName,
  buildAvailabilityAutoReply,
  isAvailabilityQuestion,
  isQuickReplySuggestion,
  normalizeChatSettings,
  normalizeFacebookMessage,
  normalizeSyncPayload,
  pickOutboxCandidate,
  planAvailabilityAutoReply,
  toOutboxPayload
} from "../lib/marketplace-chat-core.mjs";
import { marketplaceReplyTimes } from "../lib/client-attendance-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = new Date("2026-10-24T10:02:00Z"); // 07:02 em São Paulo

test("sugestão de resposta rápida com id do Facebook não é mensagem do cliente (caso Andreza, 24/10)", () => {
  const [item] = normalizeSyncPayload({ conversations: [{ threadKey: "nbbbb0af671e5fdec", contactName: "Andreza", messages: [
    { externalId: "fb:mid.$gAAbHNzzDye2nnU9_fmhbAo23IPXr", direction: "inbound", body: "Este item ainda está disponível?" },
    { externalId: "fb:mid.$gAAbHNzzDye2nnU-L4GhbApC1A1Sz", direction: "inbound", body: "Sim, você tem interesse?" }
  ] }] }, now);
  assert.deepEqual(item.messages.map((m) => m.body), ["Este item ainda está disponível?"]);
  // O mesmo filtro vale na renormalização do que já foi gravado (normalizeFacebookMessage).
  assert.equal(normalizeFacebookMessage({ body: "Sim, você tem interesse?", direction: "inbound" }), null);
  // Nossa (saída) nunca é descartada por isso; pergunta real do cliente também não.
  assert.ok(normalizeFacebookMessage({ body: "Sim, você tem interesse?", direction: "outbound" }));
  for (const text of ["Qual condomínio?", "Sim, tenho interesse", "Sim", "Você tem interesse em financiar?"]) assert.equal(isQuickReplySuggestion(text), false, text);
  assert.equal(isQuickReplySuggestion("Yes, are you interested?"), true);
});

test("pergunta padrão de disponibilidade: as frases reais do Marketplace sim, outras perguntas não", () => {
  for (const text of ["Oi, esse item está disponível?", "Isto ainda está disponível?", "Oi, Matheus. Isto ainda está disponível?", "Isso ainda está disponível?", "Este item ainda está disponível?", "Is this still available?", "Hi, is this available?"]) {
    assert.equal(isAvailabilityQuestion(text), true, text);
  }
  for (const text of ["Qual condomínio?", "Tá pra locação ?", "Ainda está disponível? Qual o valor?", "Não está disponível?", "Esse item está disponível para financiamento?", "Sim, você tem interesse?", ""]) {
    assert.equal(isAvailabilityQuestion(text), false, text);
  }
});

test("texto: saudação + 1º nome + frase do dono, SEM ponto de exclamação; sem nome confiável, sem nome", () => {
  assert.equal(buildAvailabilityAutoReply({ greeting: "Boa noite", contactName: "Andreza" }), "Boa noite, Andreza. Sim, esse item ainda está disponível.");
  assert.equal(buildAvailabilityAutoReply({ greeting: "Bom dia", contactName: "MARIA DA SILVA" }), "Bom dia, Maria. Sim, esse item ainda está disponível.");
  assert.equal(buildAvailabilityAutoReply({ greeting: "Boa tarde", contactName: "Contato do Marketplace" }), "Boa tarde. Sim, esse item ainda está disponível.");
  assert.equal(buildAvailabilityAutoReply({ greeting: "Boa tarde", contactName: "J4ne" }), "Boa tarde. Sim, esse item ainda está disponível.");
  assert.equal(autoReplyFirstName(""), "");
  for (const name of ["Andreza", "Contato do Marketplace", "", "Ana Paula", "URBAN"]) {
    for (const greeting of ["Bom dia", "Boa tarde", "Boa noite"]) assert.ok(!buildAvailabilityAutoReply({ greeting, contactName: name }).includes("!"), `${greeting}/${name}`);
  }
});

test("saudação pela fonte única getTimeGreeting(now) (São Paulo), calculada na hora do envio real", () => {
  const report = read("lib/daily-report.js");
  assert.match(report, /export function getTimeGreeting\(now = new Date\(\)\)[\s\S]{0,300}formatToParts\(now\)/);
  assert.match(report, /minutes >= 360 && minutes < 720\) return "Bom dia"/);
  assert.match(report, /minutes >= 720 && minutes < 1080\) return "Boa tarde"/);
  const chat = read("lib/marketplace-chat.js");
  // Agendamento e reserva (envio real) usam getTimeGreeting(now); a reserva regrava o texto.
  assert.match(chat, /planAvailabilityAutoReply\(\{[^}]*greeting: getTimeGreeting\(now\)/);
  assert.match(chat, /autoBody = buildAvailabilityAutoReply\(\{ greeting: getTimeGreeting\(now\)/);
  assert.match(chat, /\.\.\.\(autoBody \? \{ body: autoBody, message_at: now\.toISOString\(\) \} : \{\}\)/);
});

test("agenda só conversa nova, sem saída nossa, 1ª mensagem = pergunta padrão, recente; atraso de 30 s a 2 min", () => {
  const settings = normalizeChatSettings({});
  assert.equal(settings.availabilityAutoReply, true, "nasce ligada");
  const messages = [{ direction: "inbound", body: "Oi, esse item está disponível?", at: "2026-10-24T03:52:00Z" }];
  const plan = planAvailabilityAutoReply({ settings, firstContent: true, messages, contactName: "Andreza", greeting: "Bom dia", now, random: () => 0 });
  assert.equal(plan.body, "Bom dia, Andreza. Sim, esse item ainda está disponível.");
  assert.equal(new Date(plan.sendAfter).getTime() - now.getTime(), AUTO_REPLY_MIN_DELAY_MS);
  assert.equal(new Date(planAvailabilityAutoReply({ settings, firstContent: true, messages, greeting: "Bom dia", now, random: () => 1 }).sendAfter).getTime() - now.getTime(), AUTO_REPLY_MAX_DELAY_MS);
  assert.equal(AUTO_REPLY_MIN_DELAY_MS, 30_000);
  assert.equal(AUTO_REPLY_MAX_DELAY_MS, 120_000);
  // Uma vez: conversa já conhecida nunca agenda (e o banco tem índice único por conversa).
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: false, messages, greeting: "Bom dia", now }).skip, "conversa_ja_conhecida");
  assert.match(read("supabase/migrations/20261024160000_marketplace_auto_reply.sql"), /create unique index if not exists marketplace_messages_auto_kind_uidx\s+on public\.marketplace_messages \(conversation_id, auto_kind\)\s+where auto_kind is not null/);
  assert.equal(planAvailabilityAutoReply({ settings: { availabilityAutoReply: false }, firstContent: true, messages, greeting: "Bom dia", now }).skip, AUTO_REPLY_CANCEL.DISABLED);
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: true, messages: [...messages, { direction: "outbound", body: "Oi" }], greeting: "Bom dia", now }).skip, AUTO_REPLY_CANCEL.HUMAN_REPLIED);
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: true, messages: [{ direction: "inbound", body: "Qual condomínio?", at: "2026-10-24T03:52:00Z" }, messages[0]], greeting: "Bom dia", now }).skip, "nao_e_pergunta_padrao");
  assert.equal(planAvailabilityAutoReply({ settings, firstContent: true, messages: [{ ...messages[0], at: "2026-10-16T03:52:00Z" }], greeting: "Bom dia", now }).skip, "mensagem_antiga");
  // Acumulado da extensão desligada (MKT-2m, dono 2026-10-26): até 7 dias ainda recebe.
  assert.ok(planAvailabilityAutoReply({ settings, firstContent: true, messages: [{ ...messages[0], at: "2026-10-22T03:52:00Z" }], greeting: "Bom dia", now }).body);
});

test("cancela na reserva: desligada, equipe respondeu (CRM ou Facebook), Não contactar, tempo demais na fila", () => {
  const row = { id: "auto", auto_kind: "availability", direction: "outbound", status: "queued", created_at: "2026-10-24T10:00:00Z" };
  const ok = { settings: { availabilityAutoReply: true }, conversation: {}, messages: [row], now };
  assert.equal(autoReplyCancelReason(row, ok), null);
  assert.equal(autoReplyCancelReason({ ...row, auto_kind: null }, ok), null, "mensagem normal nunca passa aqui");
  assert.equal(autoReplyCancelReason(row, { ...ok, settings: { availabilityAutoReply: false } }), AUTO_REPLY_CANCEL.DISABLED);
  assert.equal(autoReplyCancelReason(row, { ...ok, messages: [row, { id: "r1", direction: "outbound" }] }), AUTO_REPLY_CANCEL.HUMAN_REPLIED);
  assert.equal(autoReplyCancelReason(row, { ...ok, conversation: { last_human_reply_at: "2026-10-24T10:01:00Z" } }), AUTO_REPLY_CANCEL.HUMAN_REPLIED);
  assert.equal(autoReplyCancelReason(row, { ...ok, doNotContactReason: "do_not_contact" }), AUTO_REPLY_CANCEL.DO_NOT_CONTACT);
  // MKT-2m (2026-10-26): a automática espera a extensão voltar — 3 h na fila não cancela mais; 7 dias cancela.
  assert.equal(autoReplyCancelReason({ ...row, created_at: "2026-10-24T07:00:00Z" }, ok), null);
  assert.equal(autoReplyCancelReason({ ...row, created_at: "2026-10-16T07:00:00Z" }, ok), AUTO_REPLY_CANCEL.EXPIRED);
  assert.equal(autoReplyCancelReason(row, { ...ok, privateContact: true }), AUTO_REPLY_CANCEL.PRIVATE);
  // Cancelada = "failed" com motivo (sem alerta, sem reenvio; o eco ainda confirma se tiver saído).
  assert.deepEqual(autoReplyCancelPatch(AUTO_REPLY_CANCEL.HUMAN_TYPING), { status: "failed", error: "[automática cancelada: equipe_digitando]" });
});

test("corretor digitando ou respondendo pelo CRM cancela a automática na fila; resultado da extensão nunca reenvia", () => {
  const chat = read("lib/marketplace-chat.js");
  assert.match(chat, /export async function markMarketplaceComposerActivity\(id, auth\) \{\s*const conversation = await loadScopedConversation\(id, auth\);\s*await cancelQueuedAutoReplies\(conversation\.id, AUTO_REPLY_CANCEL\.HUMAN_TYPING\)/);
  assert.match(chat, /await cancelQueuedAutoReplies\(id, AUTO_REPLY_CANCEL\.HUMAN_REPLIED\)/);
  assert.match(chat, /isAutoReplyRow\(message\) && body\?\.status !== "sent"/);
  const route = read("app/api/admin/marketplace-chat/conversations/[id]/typing/route.js");
  assert.match(route, /const auth = await requireAdminApi\(request\);\s*if \(!auth\.ok\)/);
  const screen = read("components/marketplace/MarketplaceChat.jsx");
  assert.match(screen, /onChange=\{\(event\) => \{ setText\(event\.target\.value\); notifyTyping\(\); \}\}/);
  assert.match(screen, /message\.automatic \? <Badge tone="info" data-auto-reply>/);
});

test("fila: automática ainda no atraso não sai nem segura a resposta do corretor; extensão recebe automatic", () => {
  const auto = { id: "a", conversation_id: "c1", auto_kind: "availability", send_after: "2026-10-24T10:03:00Z", created_at: "2026-10-24T10:02:00Z" };
  const reply = { id: "r", conversation_id: "c1", sender_user_id: "u1", created_at: "2026-10-24T10:02:10Z" };
  assert.equal(pickOutboxCandidate([auto, reply], { now }).id, "r");
  assert.equal(pickOutboxCandidate([auto], { now }), null);
  assert.equal(pickOutboxCandidate([auto], { now: new Date("2026-10-24T10:03:01Z") }).id, "a");
  assert.equal(toOutboxPayload(auto, { thread_key: "t", thread_url: "" }).automatic, true);
  assert.equal(toOutboxPayload(reply, { thread_key: "t", thread_url: "" }).automatic, undefined);
});

test("automática não conta como atendimento no relógio de 3 dias (MKT-2h)", () => {
  const conversation = { assigned_at: "2026-10-24T10:00:00Z" };
  const messages = [
    { direction: "inbound", status: "received", message_at: "2026-10-24T10:00:30Z" },
    { direction: "outbound", status: "sent", auto_kind: "availability", message_at: "2026-10-24T10:01:00Z" },
    { direction: "outbound", status: "sent", message_at: "2026-10-24T10:05:00Z" }
  ];
  assert.deepEqual(marketplaceReplyTimes(conversation, messages), ["2026-10-24T10:05:00.000Z"]);
  assert.deepEqual(marketplaceReplyTimes(conversation, messages.slice(0, 2)), []);
});
