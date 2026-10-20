import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_REDISTRIBUTIONS,
  evaluateOutboxGate,
  findOutboundEcho,
  matchListing,
  messagePreview,
  normalizeChatSettings,
  normalizeSyncPayload,
  planOutboundResult,
  shouldRedistribute,
  toOutboxPayload,
  validateOutboundText
} from "../lib/marketplace-chat-core.mjs";

const now = new Date("2026-10-20T15:00:00Z");
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();

test("configuração: padrão 07–22h, ligado, 20 envios/h; valores inválidos voltam ao padrão", () => {
  assert.deepEqual(normalizeChatSettings({}), { syncEnabled: true, startHour: 7, endHour: 22, maxSendsPerHour: 20 });
  assert.deepEqual(normalizeChatSettings({ syncEnabled: false, startHour: 23, endHour: 8, maxSendsPerHour: 999 }), { syncEnabled: false, startHour: 8, endHour: 23, maxSendsPerHour: 20 });
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

test("roleta: sem resposta de ninguém em 10 min → redistribui; respondeu, virou cliente ou já girou 3x → não", () => {
  const base = { assigned_user_id: "u1", assigned_at: ago(11), redistributions: 0, client_id: null, last_human_reply_at: null };
  assert.equal(shouldRedistribute(base, now), true);
  assert.equal(shouldRedistribute({ ...base, assigned_at: ago(5) }, now), false);
  assert.equal(shouldRedistribute({ ...base, last_human_reply_at: ago(8) }, now), false);
  assert.equal(shouldRedistribute({ ...base, last_human_reply_at: ago(20) }, now), true, "resposta antiga (de antes de receber) não segura");
  assert.equal(shouldRedistribute({ ...base, client_id: "c1" }, now), false);
  assert.equal(shouldRedistribute({ ...base, redistributions: MAX_REDISTRIBUTIONS }, now), false);
  assert.equal(shouldRedistribute({ ...base, assigned_user_id: null }, now), false);
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
