import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SMS_SHORTCUT_PREFIX, generateSmsShortcutKey, hashSmsShortcutKey, shortcutItems, smsShortcutKeyFromHeaders, smsShortcutKeyMatches } from "../lib/sms-shortcut-core.mjs";

test("chave do Atalho: prefixo, hash estável e comparação só com a chave certa", () => {
  const key = generateSmsShortcutKey();
  assert.ok(key.startsWith(SMS_SHORTCUT_PREFIX) && key.length > 40);
  assert.notEqual(generateSmsShortcutKey(), key);
  const hash = hashSmsShortcutKey(key);
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes(key));
  assert.equal(smsShortcutKeyMatches(hash, key), true);
  assert.equal(smsShortcutKeyMatches(hash, key + "x"), false);
  assert.equal(smsShortcutKeyMatches("", key), false);
});

test("chave só vale em Authorization: Bearer com o prefixo sms_", () => {
  const key = generateSmsShortcutKey();
  assert.equal(smsShortcutKeyFromHeaders(new Headers({ authorization: `Bearer ${key}` })), key);
  assert.equal(smsShortcutKeyFromHeaders(new Headers({ authorization: key })), "");
  assert.equal(smsShortcutKeyFromHeaders(new Headers({ authorization: "Bearer wfp_abc" })), "");
  assert.equal(smsShortcutKeyFromHeaders(new Headers()), "");
});

test("o Atalho recebe só o necessário de cada contato", () => {
  const items = shortcutItems([
    { id: "a", firstName: "Ana", phoneE164: "+5514999990000", text: "Oi Ana", text2: "Segunda", bothText: "Oi Ana\n\nSegunda", phoneMasked: "(14) 9****-0000", name: "Ana Souza", href: "sms:x" },
    { id: "b", firstName: "Sem", phoneE164: "", text: "x" }
  ]);
  assert.deepEqual(items, [{ id: "a", name: "Ana", phone: "+5514999990000", text: "Oi Ana", text2: "Segunda", together: "Oi Ana\n\nSegunda" }]);
});

test("a rota do Atalho usa as mesmas travas do Lote (Wi-Fi + WhatsApp) e nunca envia SMS", () => {
  const route = readFileSync(new URL("../app/api/atalhos/lote-sms/route.js", import.meta.url), "utf8");
  assert.match(route, /assertSmsBatchOffice\(auth, clientIpFromHeaders\(request\.headers\), action\)/);
  assert.match(route, /checkPublicRateLimit/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.ok(!/fetch\(/.test(route), "a rota só entrega texto e registra; não chama nenhum serviço de SMS");
  const lib = readFileSync(new URL("../lib/sms-shortcut.js", import.meta.url), "utf8");
  assert.match(lib, /profile\.status !== "active" \|\| profile\.role === "associate"/);
});
