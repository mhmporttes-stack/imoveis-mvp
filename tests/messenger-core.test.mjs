import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MESSENGER_AD_WINDOW_MS,
  MESSENGER_WINDOW_MS,
  buildMessengerSendBody,
  describeMessengerSendError,
  isMessengerThreadKey,
  messengerMessageRow,
  messengerReceiptLabel,
  messengerThreadKey,
  messengerWindow,
  parseMessengerWebhook,
  psidFromThreadKey,
  validateMessengerText,
  verifyMessengerChallenge,
  verifyMessengerSignature
} from "../lib/messenger-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-25, MSG-1] Messenger oficial da Página do Facebook, fase 1: receber e responder pelo
// CRM (Chat Marketplace, canal "Messenger"), sem automação; janela de 24 h (7 dias se veio de anúncio); sem tags.

const PAGE = "111222333";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sign = (body, secret) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("assinatura: aceita só HMAC correto e falha fechado sem segredo", () => {
  const body = JSON.stringify({ object: "page" });
  assert.equal(verifyMessengerSignature(body, sign(body, "s3gr3d0"), "s3gr3d0"), true);
  assert.equal(verifyMessengerSignature(body, sign(body, "outro"), "s3gr3d0"), false);
  assert.equal(verifyMessengerSignature(body + " ", sign(body, "s3gr3d0"), "s3gr3d0"), false);
  assert.equal(verifyMessengerSignature(body, null, "s3gr3d0"), false);
  assert.equal(verifyMessengerSignature(body, sign(body, ""), ""), false, "sem segredo configurado nada passa");
  assert.equal(verifyMessengerSignature(body, "sha1=abc", "s3gr3d0"), false);
});

test("verificação GET: só com o token certo e hub.mode=subscribe", () => {
  const params = (mode, token) => new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "42" });
  assert.equal(verifyMessengerChallenge(params("subscribe", "tok"), "tok"), "42");
  assert.equal(verifyMessengerChallenge(params("subscribe", "x"), "tok"), null);
  assert.equal(verifyMessengerChallenge(params("other", "tok"), "tok"), null);
  assert.equal(verifyMessengerChallenge(params("subscribe", ""), ""), null, "sem token configurado recusa");
});

const at = Date.parse("2026-10-25T12:00:00.000Z");
const webhook = (messaging, pageId = PAGE) => ({ object: "page", entry: [{ id: pageId, time: at, messaging }] });

test("leitura do webhook: mensagem, eco, entrega, leitura, postback e anúncio", () => {
  const events = parseMessengerWebhook(webhook([
    { sender: { id: "900" }, recipient: { id: PAGE }, timestamp: at, message: { mid: "m_1", text: "Oi, tem casa?" } },
    { sender: { id: "900" }, recipient: { id: PAGE }, timestamp: at + 1, message: { mid: "m_1", text: "Oi, tem casa?" } },
    { sender: { id: PAGE }, recipient: { id: "900" }, timestamp: at + 2, message: { mid: "m_2", is_echo: true, app_id: 77, text: "Temos sim" } },
    { sender: { id: "900" }, recipient: { id: PAGE }, timestamp: at + 3, delivery: { mids: ["m_2"], watermark: at + 3 } },
    { sender: { id: "900" }, recipient: { id: PAGE }, timestamp: at + 4, read: { watermark: at + 4 } },
    { sender: { id: "901" }, recipient: { id: PAGE }, timestamp: at + 5, postback: { mid: "m_3", title: "Quero simular", payload: "SIMULAR" } },
    { sender: { id: "902" }, recipient: { id: PAGE }, timestamp: at + 6, message: { mid: "m_4", text: "Vi o anúncio", referral: { source: "ADS", ad_id: "123" } } },
    { sender: { id: "903" }, recipient: { id: PAGE }, timestamp: at + 7, message: { mid: "m_5", attachments: [{ type: "image", payload: { url: "https://scontent.example/foto.jpg" } }, { type: "image", payload: { url: "http://inseguro" } }] } }
  ]), PAGE);
  assert.deepEqual(events.map((event) => event.type), ["message", "message", "delivery", "read", "message", "message", "message"]);
  assert.equal(events.filter((event) => event.mid === "m_1").length, 1, "mid repetido no mesmo payload entra uma vez");
  const echo = events.find((event) => event.mid === "m_2");
  assert.equal(echo.echo, true);
  assert.equal(echo.psid, "900", "no eco o cliente é o destinatário");
  assert.equal(events.find((event) => event.mid === "m_3").text, "Quero simular");
  assert.equal(events.find((event) => event.mid === "m_4").adReferral, true);
  assert.equal(events.find((event) => event.mid === "m_1").adReferral, false);
  assert.deepEqual(events.find((event) => event.mid === "m_5").attachments.map((item) => item.type), ["image"], "só link https");
  assert.equal(events[2].at, new Date(at + 3).toISOString());
});

test("leitura do webhook: outra Página, objeto errado ou sem Página configurada = nada", () => {
  const messaging = [{ sender: { id: "900" }, recipient: { id: "999" }, timestamp: at, message: { mid: "m_1", text: "oi" } }];
  assert.deepEqual(parseMessengerWebhook(webhook(messaging, "999"), PAGE), []);
  assert.deepEqual(parseMessengerWebhook({ ...webhook(messaging), object: "whatsapp_business_account" }, PAGE), []);
  assert.deepEqual(parseMessengerWebhook(webhook(messaging), ""), []);
  assert.deepEqual(parseMessengerWebhook(webhook([{ sender: { id: "abc" }, message: { mid: "m_9", text: "x" } }]), PAGE), [], "PSID inválido");
});

test("janela: 24 h desde a última mensagem do cliente", () => {
  const last = new Date(at).toISOString();
  assert.equal(messengerWindow({ lastInboundAt: last }, new Date(at + MESSENGER_WINDOW_MS - 1)).open, true);
  const closed = messengerWindow({ lastInboundAt: last }, new Date(at + MESSENGER_WINDOW_MS));
  assert.equal(closed.open, false);
  assert.equal(closed.kind, "24h");
  assert.equal(messengerWindow({}, new Date(at)).open, false, "sem mensagem do cliente não abre");
});

test("janela: até 7 dias quando veio de anúncio de clique para o Messenger", () => {
  const last = new Date(at).toISOString();
  const day3 = new Date(at + 3 * 24 * 60 * 60 * 1000);
  const viaAd = messengerWindow({ lastInboundAt: last, adReferralAt: last }, day3);
  assert.equal(viaAd.open, true);
  assert.equal(viaAd.kind, "7d");
  assert.equal(messengerWindow({ lastInboundAt: last, adReferralAt: last }, new Date(at + MESSENGER_AD_WINDOW_MS)).open, false);
  assert.equal(messengerWindow({ lastInboundAt: last }, day3).open, false, "sem anúncio, 3 dias depois está fechada");
  assert.equal(messengerWindow({ adReferralAt: last }, new Date(at + 1)).open, false, "anúncio sem mensagem do cliente não abre");
});

test("envio: RESPONSE, sem tag; texto ou foto", () => {
  const text = buildMessengerSendBody("900", { text: "Olá" });
  assert.deepEqual(text, { recipient: { id: "900" }, messaging_type: "RESPONSE", message: { text: "Olá" } });
  const image = buildMessengerSendBody("900", { imageUrl: "https://cdn/foto.jpg" });
  assert.equal(image.message.attachment.type, "image");
  assert.equal("tag" in text || "tag" in image, false, "nunca usa tag de mensagem");
  assert.throws(() => validateMessengerText("   "), /Digite/);
  assert.throws(() => validateMessengerText("x".repeat(2001)), /2000/);
  assert.match(describeMessengerSendError({ code: 10, error_subcode: 2018278 }), /janela do Messenger/i);
  assert.match(describeMessengerSendError({ code: 190 }), /expirou/);
});

test("projeção: PSID na conversa, mid como id externo, recibo de entrega/leitura", () => {
  assert.equal(messengerThreadKey("900"), "messenger:900");
  assert.equal(messengerThreadKey("abc"), "");
  assert.equal(isMessengerThreadKey("messenger:900"), true);
  assert.equal(isMessengerThreadKey("1234567890"), false, "conversa do Marketplace (extensão) não é Messenger");
  assert.equal(psidFromThreadKey("messenger:900"), "900");
  const inbound = messengerMessageRow({ mid: "m_1", echo: false, text: "Oi", attachments: [], at: "2026-10-25T12:00:00.000Z" }, { contactName: "Ana" });
  assert.deepEqual([inbound.external_id, inbound.direction, inbound.status, inbound.sender_name], ["m_1", "inbound", "received", "Ana"]);
  const echo = messengerMessageRow({ mid: "m_2", echo: true, text: "Oi", attachments: [], at: "2026-10-25T12:00:00.000Z" });
  assert.deepEqual([echo.direction, echo.status], ["outbound", "sent"]);
  const sent = { direction: "outbound", status: "sent", message_at: "2026-10-25T12:00:00.000Z" };
  assert.equal(messengerReceiptLabel(sent, { deliveredAt: "2026-10-25T12:00:05.000Z" }), "Entregue");
  assert.equal(messengerReceiptLabel(sent, { deliveredAt: "2026-10-25T12:00:05.000Z", readAt: "2026-10-25T12:01:00.000Z" }), "Lida");
  assert.equal(messengerReceiptLabel(sent, { readAt: "2026-10-25T11:00:00.000Z" }), "");
  assert.equal(messengerReceiptLabel({ ...sent, status: "failed" }, { readAt: "2026-10-25T13:00:00.000Z" }), "");
});

test("idempotência e isolamento no código: mid repetido ignorado; extensão nunca vê conversa do Messenger", () => {
  const messenger = read("lib/messenger.js");
  assert.match(messenger, /error\?\.code === "23505"\) return false/, "mid já gravado = ignorado");
  const chat = read("lib/marketplace-chat.js");
  assert.match(chat, /if \(isMessengerThreadKey\(item\.threadKey\)\) continue;/, "sincronização da extensão pula Messenger");
  assert.ok((chat.match(/MESSENGER_LIKE\)/g) || []).length >= 3, "limite por hora, reprocessamento e renormalização excluem Messenger");
  const send = chat.slice(chat.indexOf("async function sendViaMessenger("), chat.indexOf("async function queueOutbound("));
  assert.match(send, /assertMessengerWindowOpen\(conversation, now\)/, "janela conferida antes de enviar");
  assert.doesNotMatch(send, /status: "queued"|status: "sending"/, "Messenger nunca fica na fila da extensão");
  const route = read("app/api/webhooks/messenger/route.js");
  assert.match(route, /verifyMessengerWebhookSignature\(rawBody, signature\)/);
  assert.match(route, /status: 401/);
});
