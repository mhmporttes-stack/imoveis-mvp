// MKT-3 (alerta de mensagem nova do cliente) e MKT-4 ("Levar para o WhatsApp"), dono 2026-10-30.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKETPLACE_INBOUND_NOTICE_INTERVAL_MS,
  buildMarketplaceInboundNotice,
  detectClientPhone,
  extractBrazilianPhone,
  inboundNoticeDue,
  marketplaceWhatsappInviteText,
  resolveMarketplaceInboundRecipients
} from "../lib/marketplace-chat-core.mjs";
import { NOTIFICATION_KIND, isNotificationAllowed } from "../lib/notification-policy-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const users = [
  { id: "admin", role: "admin", status: "active" },
  { id: "gestora", role: "manager", status: "active" },
  { id: "corretor", role: "broker", status: "active" },
  { id: "inativo", role: "broker", status: "inactive" },
  { id: "assoc", role: "associate", status: "active" }
];

test("MKT-3: destinatário é o atribuído; sem atribuído ativo, admins e gestoras", () => {
  assert.deepEqual(resolveMarketplaceInboundRecipients({ users, assignedUserId: "corretor" }), ["corretor"]);
  assert.deepEqual(resolveMarketplaceInboundRecipients({ users, clientResponsibleId: "corretor" }), ["corretor"]);
  assert.deepEqual(resolveMarketplaceInboundRecipients({ users }).sort(), ["admin", "gestora"]);
  assert.deepEqual(resolveMarketplaceInboundRecipients({ users, assignedUserId: "inativo" }).sort(), ["admin", "gestora"]);
});

test("MKT-3: um aviso por conversa a cada 10 min", () => {
  const now = new Date("2026-10-30T15:00:00Z");
  assert.equal(MARKETPLACE_INBOUND_NOTICE_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(inboundNoticeDue({ lastNotifiedAt: null, now }), true);
  assert.equal(inboundNoticeDue({ lastNotifiedAt: new Date(now - 5 * 60000).toISOString(), now }), false);
  assert.equal(inboundNoticeDue({ lastNotifiedAt: new Date(now - 10 * 60000).toISOString(), now }), true);
  const notice = buildMarketplaceInboundNotice({ contactName: "Ana", preview: "Ainda disponível?" });
  assert.equal(notice.title, "Nova mensagem no Marketplace");
  assert.equal(notice.description, "Ana: Ainda disponível?");
});

test("MKT-3: tipo permitido, migration, reserva atômica e link da conversa", () => {
  assert.equal(NOTIFICATION_KIND.MARKETPLACE_INBOUND, "marketplace_inbound");
  assert.equal(isNotificationAllowed("marketplace_inbound"), true);
  const src = read("lib/marketplace-chat.js");
  assert.ok(src.includes("notification_type: NOTIFICATION_KIND.MARKETPLACE_INBOUND"));
  assert.ok(src.includes("kind: NOTIFICATION_KIND.MARKETPLACE_INBOUND"));
  assert.ok(src.includes("inbound_notified_at.is.null,inbound_notified_at.lt."));
  assert.ok(src.includes("if (!firstContent && inbound.length)"));
  const migration = read("supabase/migrations/20261030150000_marketplace_inbound_notice.sql");
  assert.ok(migration.includes("add column if not exists inbound_notified_at timestamptz"));
  assert.ok(migration.includes("'marketplace_inbound'"));
});

test("MKT-4: texto pronto com a marca oficial, sem envio automático", () => {
  const text = marketplaceWhatsappInviteText({ contactName: "Maria Souza" });
  assert.ok(text.startsWith("Olá, Maria!"));
  assert.ok(text.includes("Matheus Machado Corretor de Imóveis"));
  assert.ok(!text.includes("Matheus Machado Imóveis"));
  assert.ok(marketplaceWhatsappInviteText({}).startsWith("Olá!"));
  const ui = read("components/marketplace/MarketplaceChat.jsx");
  assert.ok(ui.includes("pasteIntoComposer(marketplaceWhatsappInviteText("));
});

test("MKT-4: detecta telefone mandado pelo cliente", () => {
  assert.equal(extractBrazilianPhone("meu zap é (14) 99876-5432"), "14998765432");
  assert.equal(extractBrazilianPhone("+55 14 99876 5432"), "14998765432");
  assert.equal(extractBrazilianPhone("14998765432"), "14998765432");
  assert.equal(extractBrazilianPhone("fixo 14 3232-1111"), "1432321111");
  assert.equal(extractBrazilianPhone("valor 250000 entrada"), "");
  assert.equal(extractBrazilianPhone("sem número"), "");
  const messages = [
    { direction: "outbound", body: "nosso número 14 99999-0000" },
    { direction: "inbound", body: "14 98888-7777" },
    { direction: "inbound", body: "obrigado" }
  ];
  assert.equal(detectClientPhone(messages), "14988887777");
  assert.equal(detectClientPhone([{ direction: "outbound", body: "14 99999-0000" }]), "");
});

test("MKT-4: vínculo pelo servidor com as travas de sempre", () => {
  const src = read("lib/marketplace-chat.js");
  const fn = src.slice(src.indexOf("export async function linkMarketplaceConversationWhatsapp"), src.indexOf("// Contador do menu e do atalho"));
  assert.ok(fn.includes("assertManualClientPhoneAllowed(phone)"));
  assert.ok(fn.includes("findDoNotContactInboundBlock(phoneNormalized"));
  assert.ok(fn.includes("ensureClientForConversation("));
  assert.ok(fn.includes("manualPhone: true"));
  assert.ok(!fn.includes("queueOutbound"), "nunca envia mensagem");
  const route = read("app/api/admin/marketplace-chat/conversations/[id]/whatsapp-link/route.js");
  assert.ok(route.indexOf("requireAdminApi(request)") < route.indexOf("linkMarketplaceConversationWhatsapp(id"));
});
