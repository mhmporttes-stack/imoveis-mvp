import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLidPlaceholder, lidPlaceholderFromJid } from "../lib/whatsapp-lid-placeholder.mjs";

// Regra do dono (2026-10-10): tudo do WhatsApp do corretor entra no Chat, mesmo antes de se saber o número.
test("LID vira marcador estável e reconhecível", () => {
  assert.equal(lidPlaceholderFromJid("247050881003585@lid"), "lid:247050881003585");
  assert.equal(lidPlaceholderFromJid("247050881003585:12@lid"), "lid:247050881003585");
  assert.equal(lidPlaceholderFromJid("5514999990000@s.whatsapp.net"), "");
  assert.equal(isLidPlaceholder("lid:247050881003585"), true);
  assert.equal(isLidPlaceholder("+5514999990000"), false);
  assert.equal(isLidPlaceholder("lid:abc"), false);
});

test("conversa sem número entra e é juntada quando o telefone aparece", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /export async function mergeLidConversation/);
  assert.match(inbound, /const placeholder = isLidPlaceholder\(from\)/);
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /notifyLidResolved/);
  assert.match(sessions, /if \(lid\) return `\$\{lid\[1\]\}@lid`;/);
  const route = readFileSync(new URL("../app/api/webhooks/whatsapp-individual/route.js", import.meta.url), "utf8");
  assert.match(route, /payload\.type === "lid_resolved"/);
});

// 2026-10-10: serviço reiniciou, esqueceu o par LID -> telefone e criou "Número" duplicado de contato conhecido.
test("LID já visto na sessão usa a conversa existente; duplicatas são juntadas no cron", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /export async function findKnownPhoneForLid/);
  assert.match(inbound, /\.eq\("metadata->>remote_jid", jid\)/);
  assert.match(inbound, /const placeholder = isLidPlaceholder\(from\) && !knownPhone \? String\(from\) : "";/);
  const cron = readFileSync(new URL("../app/api/cron/scheduled-activities/route.js", import.meta.url), "utf8");
  assert.match(cron, /reconcileLidPlaceholders\(\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /if \(full === UNKNOWN_NUMBER_LABEL\) return full;/);
});

// 2026-10-11: mensagem RECEBIDA por LID sem senderPn também não é descartada.
test("mensagem recebida sem número também entra", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /if \(!key\.fromMe && phoneFromJid\(key\.senderPn\)\) return "";/);
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.doesNotMatch(inbound, /lid_sem_telefone/);
  assert.match(inbound, /privateContact \|\| Boolean\(placeholder\) \|\| await findInternalTeamPhone\(phone\)/);
});
