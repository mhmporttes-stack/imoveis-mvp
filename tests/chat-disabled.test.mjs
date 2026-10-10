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
  assert.match(source("lib/admin-auth.js"), /\/\^\\\/api\\\/admin\\\/whatsapp-chat/);
  assert.match(source("app/admin/chat/page.jsx"), /isChatRestrictedProfile\(auth\.profile\) && \(await isChatDisabled\(\)\)/);
  assert.match(source("lib/chat-control.js"), /whatsapp_chat_control/);
});

test("Chat híbrido: oficial envia, sessão pessoal não (individualSendDisabled)", () => {
  const control = source("lib/chat-control.js");
  assert.match(control, /individualSendDisabled: data\?\.setting_value\?\.individualSendDisabled === true/);
  const chat = source("lib/whatsapp-chat.js");
  assert.match(chat, /if \(await isIndividualChatSendDisabled\(\)\) return \{ sendChannel: "cloud_api", sessionUserId: null, sessionSlot: null \};/);
  assert.match(chat, /code: CHAT_INDIVIDUAL_DISABLED_CODE/);
  const individual = source("lib/whatsapp-individual.js");
  assert.equal((individual.match(/await assertChatActionsOnPersonalSession\(\);/g) || []).length, 3);
});

test("Chat híbrido: filtros Oficial/Pessoal, etiqueta na lista, 'Enviando por' e bloqueio da janela de 24 h do oficial", () => {
  const chat = source("lib/whatsapp-chat.js");
  assert.match(chat, /"silent", "official", "personal", "slot1", "slot2", "private"\]/);
  assert.match(chat, /safeFilter === "official"\) request = request\.eq\("session_key", OFFICIAL_SESSION_KEY\)/);
  assert.match(chat, /code: "WINDOW_CLOSED"/);
  assert.equal((chat.match(/assertOfficialWindowOpen\(conversation, sendChannel\);/g) || []).length, 2);
  const ui = source("components/WhatsappChat.jsx");
  assert.match(ui, /key: "official", label: "Oficial"/);
  assert.match(ui, /key: "personal", label: "Corretores"/);
  assert.match(ui, /Enviando por:/);
  assert.match(ui, /A janela de 24 horas deste cliente fechou\./);
});
