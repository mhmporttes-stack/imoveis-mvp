import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decideCardWhatsapp, CARD_WA_EXTERNAL } from "../lib/client-card-whatsapp-core.mjs";

// Chat desativado pelo dono (2026-10-05): ninguém envia pelo Chat; corretor/associado nem abre; admin/gestor só leem.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

test("botão WhatsApp do card abre o WhatsApp externo quando o Chat está desativado (cliente do corretor)", () => {
  const base = { stateKnown: true, sessionStatus: "connected", isOwnClient: true, phone: "5514999990000", device: "desktop" };
  assert.equal(decideCardWhatsapp(base).action !== CARD_WA_EXTERNAL, true, "ligado: segue o Chat");
  const off = decideCardWhatsapp({ ...base, chatDisabled: true });
  assert.equal(off.action, CARD_WA_EXTERNAL);
  assert.equal(off.reason, "chat_disabled");
});

test("backend: envio/reação/edição/exclusão/modelo exigem o Chat ligado; API e página bloqueiam corretor", () => {
  const chat = source("lib/whatsapp-chat.js");
  assert.match(chat, /async function assertChatEnabled\(\)/);
  assert.equal((chat.match(/await assertChatEnabled\(\);/g) || []).length >= 5, true);
  assert.match(chat, /reason: "chat_disabled"/);
  assert.match(source("lib/admin-auth.js"), /applyChatDisabledGuard\(request, guarded\)/);
  assert.match(source("lib/admin-auth.js"), /\/\^\\/api\\/admin\\/whatsapp-chat/);
  assert.match(source("app/admin/chat/page.jsx"), /isChatRestrictedProfile\(auth\.profile\) && \(await isChatDisabled\(\)\)/);
  assert.match(source("lib/chat-control.js"), /whatsapp_chat_control/);
});
