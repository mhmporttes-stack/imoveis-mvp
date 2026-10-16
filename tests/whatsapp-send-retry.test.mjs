// Reenvio de mensagem enviada pelo CRM quando um aparelho pede de novo (2026-10-16): cache em memória para o getMessage
// do Baileys e a decisão de quem reenvia (Baileys x à mão pelo LID). Sem rede, sem Baileys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MANUAL_RESEND_LIMIT, SEND_RETRY_REASON, SENT_CACHE_MAX_PER_SESSION, SENT_CACHE_TTL_MS, createSentMessageCache, decideSendRetry, jidUser, mediaTypeOf
} from "../whatsapp-individual-service/src/send-retry.js";

const ME_PN = "5514999990000";
const ME_LID = "123456789012345";
const CONTACT = "5514988887777@s.whatsapp.net";
const retryNode = (attrs, count = "1") => ({ tag: "receipt", attrs: { id: "MSG1", type: "retry", ...attrs }, content: [{ tag: "retry", attrs: { count, id: "MSG1" } }] });

test("cache: guarda e devolve por sessão e id; sessões não se misturam", () => {
  const cache = createSentMessageCache();
  const msg = { conversation: "oi" };
  assert.equal(cache.remember("u1", "A", msg), true);
  assert.equal(cache.get("u1", "A"), msg);
  assert.equal(cache.get("u2", "A"), undefined);
  assert.equal(cache.get("u1", "B"), undefined);
  assert.equal(cache.remember("u1", "", msg), false, "sem id não guarda");
  assert.equal(cache.remember("u1", "C", undefined), false, "sem conteúdo não guarda");
  cache.clear("u1");
  assert.equal(cache.get("u1", "A"), undefined, "desconectar limpa a sessão");
});

test("cache: limite por sessão descarta as mais antigas", () => {
  const cache = createSentMessageCache({ maxPerSession: 3 });
  for (const id of ["1", "2", "3", "4"]) cache.remember("u1", id, { conversation: id });
  assert.equal(cache.size("u1"), 3);
  assert.equal(cache.get("u1", "1"), undefined);
  assert.deepEqual(cache.get("u1", "4"), { conversation: "4" });
  assert.equal(SENT_CACHE_MAX_PER_SESSION, 300);
});

test("cache: expira depois da validade (30 min)", () => {
  let now = 1_000_000;
  const cache = createSentMessageCache({ now: () => now });
  cache.remember("u1", "A", { conversation: "a" });
  now += SENT_CACHE_TTL_MS - 1;
  cache.remember("u1", "B", { conversation: "b" });
  assert.ok(cache.get("u1", "A"));
  now += 2;
  assert.equal(cache.get("u1", "A"), undefined, "vencida");
  assert.ok(cache.get("u1", "B"), "a mais nova continua");
  now += SENT_CACHE_TTL_MS;
  assert.equal(cache.size("u1"), 0);
  assert.equal(SENT_CACHE_TTL_MS, 30 * 60 * 1000);
});

test("decisão: recibo comum não é pedido de reenvio", () => {
  assert.equal(decideSendRetry({ attrs: { id: "MSG1", from: CONTACT, type: "read" } }, { meId: `${ME_PN}:5@s.whatsapp.net` }), null);
});

test("decisão: pedido do contato -> o Baileys reenvia (via getMessage)", () => {
  const d = decideSendRetry(retryNode({ from: CONTACT }, "2"), { meId: `${ME_PN}:5@s.whatsapp.net`, cached: true });
  assert.equal(d.action, "baileys");
  assert.equal(d.kind, "contact");
  assert.equal(d.trigger, "from_pn");
  assert.equal(d.attempt, 2);
});

test("decisão: celular do próprio número pelo telefone -> o Baileys reenvia", () => {
  const d = decideSendRetry(retryNode({ from: `${ME_PN}@s.whatsapp.net`, recipient: CONTACT }), { meId: `${ME_PN}:5@s.whatsapp.net`, meLid: "", cached: true });
  assert.equal(d.action, "baileys");
  assert.equal(d.kind, "own_device");
});

test("decisão: celular do próprio número pelo LID com me.lid conhecido -> o Baileys reenvia", () => {
  const d = decideSendRetry(retryNode({ from: `${ME_LID}@lid`, recipient: CONTACT }), { meId: `${ME_PN}:5@s.whatsapp.net`, meLid: `${ME_LID}:5@lid`, cached: true });
  assert.equal(d.action, "baileys");
  assert.equal(d.trigger, "from_lid");
});

test("decisão: celular do próprio número pelo LID com me.lid VAZIO -> reenvio à mão para quem pediu", () => {
  const d = decideSendRetry(retryNode({ from: `${ME_LID}@lid`, recipient: CONTACT }, "1"), { meId: `${ME_PN}:5@s.whatsapp.net`, meLid: "", cached: true });
  assert.equal(d.action, "manual");
  assert.equal(d.kind, "own_device_lid");
  assert.equal(d.trigger, "from_lid");
  assert.equal(d.target, `${ME_LID}@lid`);
  assert.equal(d.recipient, CONTACT);
  assert.ok(MANUAL_RESEND_LIMIT >= 1);
});

test("decisão: mensagem fora do cache -> missing (nada a reenviar), em qualquer caminho", () => {
  const d = decideSendRetry(retryNode({ from: `${ME_LID}@lid`, recipient: CONTACT }), { meId: `${ME_PN}:5@s.whatsapp.net`, meLid: "", cached: false });
  assert.equal(d.action, "missing");
});

test("decisão: LID que não é do próprio número (me.lid conhecido e diferente) -> ignora", () => {
  const d = decideSendRetry(retryNode({ from: "999@lid", recipient: CONTACT }), { meId: `${ME_PN}:5@s.whatsapp.net`, meLid: `${ME_LID}@lid`, cached: true });
  assert.equal(d.action, "ignore");
});

test("auxiliares: usuário do JID e mediatype do <enc>", () => {
  assert.equal(jidUser(`${ME_PN}:7@s.whatsapp.net`), ME_PN);
  assert.equal(jidUser(""), "");
  assert.equal(mediaTypeOf({ conversation: "x" }), null);
  assert.equal(mediaTypeOf({ imageMessage: {} }), "image");
  assert.equal(mediaTypeOf({ videoMessage: { gifPlayback: true } }), "gif");
  assert.equal(mediaTypeOf({ audioMessage: { ptt: true } }), "ptt");
});

test("telemetria: motivos com prefixo send_retry_ e sessions.js liga getMessage ao cache, sem gravar em disco", () => {
  for (const reason of Object.values(SEND_RETRY_REASON)) assert.match(reason, /^send_retry_[a-z]+$/);
  const src = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(src, /getMessage: async \(key\) => sentMessages\.get\(userId, key\?\.id\)/);
  assert.match(src, /sentMessages\.remember\(userId, waMessageId, result\?\.message\)/);
  assert.match(src, /sentMessages\.clear\(userId\)/);
  const mod = readFileSync(new URL("../whatsapp-individual-service/src/send-retry.js", import.meta.url), "utf8");
  assert.doesNotMatch(mod, /from "node:fs"|writeFile|supabase/i);
});
