import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../src/utils/phone.js";
import { isWithinWindow, backoffDelay, localDate } from "../src/utils/time.js";
import { verifyHubSignature, hubSignature } from "../src/utils/crypto.js";
import { classifyGraphError } from "../src/whatsapp/graph-client.js";
import { parseCloudWebhook, verifySubscription } from "../src/whatsapp/webhooks.js";
import { buildCloudMessageBody } from "../src/whatsapp/messages.js";
import { assertTransition, CONNECTION_TRANSITIONS, OPERATIONAL_TRANSITIONS } from "../src/services/instances.js";
import { desiredProfile } from "../src/services/onboarding.js";
import { leadSchema, profileConfigSchema } from "../src/validation/schemas.js";
import { comparisonKey } from "../src/services/consent/crm-db-verifier.js";
import { sanitizeText } from "../src/utils/logger.js";
import { loadConfig } from "../src/config/index.js";

test("telefone: normaliza celular BR e recusa fixo/inválido", () => {
  assert.equal(normalizePhone("(11) 98765-4321"), "+5511987654321");
  assert.equal(normalizePhone("+55 11 98765-4321"), "+5511987654321");
  assert.equal(normalizePhone("5511987654321"), "+5511987654321");
  assert.equal(normalizePhone("1132654321"), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("+14155550123"), "+14155550123");
});

test("janela de envio respeita fuso, dia e horário", () => {
  const w = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  // 2026-10-26 é segunda. 12:00 UTC = 09:00 em São Paulo.
  assert.equal(isWithinWindow(w, "America/Sao_Paulo", new Date("2026-10-26T12:00:00Z")), true);
  assert.equal(isWithinWindow(w, "America/Sao_Paulo", new Date("2026-10-26T11:59:00Z")), false);
  assert.equal(isWithinWindow(w, "America/Sao_Paulo", new Date("2026-10-26T21:00:00Z")), false);
  assert.equal(isWithinWindow(w, "America/Sao_Paulo", new Date("2026-10-25T15:00:00Z")), false); // domingo
  assert.equal(localDate("America/Sao_Paulo", new Date("2026-10-26T02:00:00Z")), "2026-10-25");
});

test("backoff exponencial com teto", () => {
  const mid = () => 0.5;
  assert.equal(backoffDelay(1, 1000, 60000, mid), 1000);
  assert.equal(backoffDelay(3, 1000, 60000, mid), 4000);
  assert.equal(backoffDelay(20, 1000, 60000, mid), 60000);
});

test("assinatura X-Hub-Signature-256", () => {
  const body = Buffer.from('{"a":1}');
  const sig = hubSignature(body, "s3cr3t");
  assert.equal(verifyHubSignature(body, sig, "s3cr3t"), true);
  assert.equal(verifyHubSignature(body, sig, "outro"), false);
  assert.equal(verifyHubSignature(Buffer.from('{"a":2}'), sig, "s3cr3t"), false);
  assert.equal(verifyHubSignature(body, "sha1=abc", "s3cr3t"), false);
  assert.equal(verifyHubSignature(body, sig, ""), false);
});

test("classificação dos erros da Graph API", () => {
  assert.equal(classifyGraphError(400, { code: 130429 }).kind, "temporary");
  assert.equal(classifyGraphError(400, { code: 131026 }).kind, "permanent");
  assert.equal(classifyGraphError(401, { code: 190 }).instanceImpact, "auth");
  assert.equal(classifyGraphError(400, { code: 131031 }).instanceImpact, "restricted");
  assert.equal(classifyGraphError(400, { code: 131048 }).instanceImpact, "quality");
  assert.equal(classifyGraphError(400, { code: 132001 }).instanceImpact, "template");
  assert.equal(classifyGraphError(400, { code: 131056 }).instanceImpact, "rate_limited");
});

test("corpo de envio de template com biz_opaque_callback_data", () => {
  const body = buildCloudMessageBody({ to: "+5511987654321", campaign: { message_type: "template", template_name: "t1", template_language: "pt_BR", template_components: [] }, callbackData: "abc" });
  assert.deepEqual(body, { messaging_product: "whatsapp", recipient_type: "individual", to: "+5511987654321", type: "template", template: { name: "t1", language: { code: "pt_BR" } }, biz_opaque_callback_data: "abc" });
});

test("webhook: verificação de inscrição e parse de status/entrada/conta", () => {
  assert.equal(verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }, "tok"), "123");
  assert.equal(verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "123" }, "tok"), null);
  assert.equal(verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }, ""), null);
  const events = parseCloudWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "900", changes: [
      { field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000", recipient_id: "5511", biz_opaque_callback_data: "cb" }], messages: [{ from: "5511", id: "wamid.in", type: "text", timestamp: "1700000001", text: { body: "SAIR" } }] } },
      { field: "account_update", value: { event: "ACCOUNT_RESTRICTION" } }
    ] }]
  });
  assert.equal(events.length, 3);
  assert.equal(events[0].callbackData, "cb");
  assert.equal(events[1].text, "SAIR");
  assert.equal(events[2].blocking, true);
});

test("transições de estado da instância", () => {
  assert.doesNotThrow(() => assertTransition(CONNECTION_TRANSITIONS, "registered", "verifying"));
  assert.throws(() => assertTransition(CONNECTION_TRANSITIONS, "registered", "connected"), /Transição inválida/);
  assert.throws(() => assertTransition(OPERATIONAL_TRANSITIONS, "inactive", "paused"), /Transição inválida/);
});

test("perfil desejado: Instagram vira site, no máximo 2 sites", () => {
  const d = desiredProfile({ about: "Oi", instagram_url: "https://instagram.com/mm", websites: ["https://a.com"] });
  assert.deepEqual(d.profile.websites, ["https://instagram.com/mm", "https://a.com"]);
  assert.deepEqual(d.required.sort(), ["about", "websites"]);
  assert.equal(profileConfigSchema.safeParse({ instagram_url: "https://instagram.com/x", websites: ["https://a.com", "https://b.com"] }).success, false);
  assert.equal(profileConfigSchema.safeParse({ about: "x".repeat(140) }).success, false);
});

test("lead: só campos permitidos", () => {
  assert.equal(leadSchema.safeParse({ crm_lead_id: "1", phone: "11987654321", campaign_code: "abc", consent_reference: "x" }).success, true);
  assert.equal(leadSchema.safeParse({ crm_lead_id: "1", phone: "11987654321", campaign_code: "abc", consent_reference: "x", cpf: "1" }).success, false);
  assert.equal(leadSchema.safeParse({ crm_lead_id: "1", phone: "11987654321", campaign_code: "abc" }).success, false);
});

test("chave de comparação de telefone igual à do CRM (DDD + 8 últimos)", () => {
  assert.equal(comparisonKey("11987654321"), "1187654321");
  assert.equal(comparisonKey("1187654321"), "1187654321");
});

test("logs: tokens removidos de mensagens de erro", () => {
  assert.equal(sanitizeText("https://x/y?access_token=ABC123&b=1"), "https://x/y?access_token=[redigido]&b=1");
  assert.equal(sanitizeText("Authorization: Bearer EAAB.xyz"), "Authorization: Bearer [redigido]");
});

test("configuração: porta padrão 3031 e verificador padrão crm-db", () => {
  const c = loadConfig({});
  assert.equal(c.PORT, 3031);
  assert.equal(c.CONSENT_VERIFIER, "crm-db");
  assert.deepEqual(c.CONSENT_CRM_ACCEPTED_PURPOSES, ["retorno_simulacao"]);
});
