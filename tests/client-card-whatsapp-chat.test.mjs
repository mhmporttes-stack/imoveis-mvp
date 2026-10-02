import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Regra do dono (2026-10-02): o botão "WhatsApp" do card de cliente abre a conversa
// do cliente DENTRO do Chat do CRM — sem WhatsApp Web/app externo, sem conversa
// duplicada e sem mudar atendente/responsável. Teste estrutural dos pontos que
// garantem isso.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

function functionBody(code, signature) {
  const start = code.indexOf(signature);
  assert.ok(start >= 0, `não achei ${signature}`);
  const next = code.indexOf("\n  async function ", start + signature.length);
  return code.slice(start, next > 0 ? next : undefined);
}

test("botão WhatsApp do card navega para o Chat focado no cliente (sem WhatsApp externo)", () => {
  const body = functionBody(source("components/clients/useClientList.js"), "async function openWhatsApp(client)");
  assert.match(body, /router\.push\(`\/admin\/chat\?client=\$\{encodeURIComponent\(client\.registration\.id\)\}`\)/);
  assert.doesNotMatch(body, /window\.open|window\.location|buildWhatsAppUrl|wa\.me|api\.whatsapp\.com|web\.whatsapp/);
  assert.match(body, /toWhatsAppDigits\(value\)/, "telefone inválido continua barrado antes de sair da lista");
});

test("o Chat recebe ?client= e abre a conversa (mobile e desktop usam a mesma página)", () => {
  assert.match(source("app/admin/chat/page.jsx"), /initialClientId=\{typeof params\.client === "string" \? params\.client : ""\}/);
  assert.match(source("components/WhatsappChat.jsx"), /\/api\/admin\/whatsapp-chat\/open-client/);
});

test("abrir pelo card nunca muda atendente/status e nunca duplica conversa", () => {
  assert.match(source("app/api/admin/whatsapp-chat/open-client/route.js"), /openChatForClient\(String\(body\.clientId\), auth, \{ assign: false \}\)/);
  const code = source("lib/whatsapp-chat.js");
  const start = code.indexOf("export async function openChatForClient(");
  const body = code.slice(start, code.indexOf("export async function getClientChatWindow("));
  assert.match(body, /\{ assign = true \} = \{\}/);
  assert.match(body, /if \(assign && isResponsible && !conversation\.assigned_user_id\)/);
  assert.ok(body.indexOf('.eq("client_id", client.id)') < body.indexOf("phoneLookupCandidates(phone)"), "procura a conversa vinculada ao cliente antes da do telefone");
  assert.match(body, /createError\.code !== "23505"/, "corrida na criação reaproveita a conversa existente");
  assert.match(body, /scope\.all \|\| scope\.brokerIds\.includes\(client\.responsible_user_id\)/, "escopo/hierarquia do Chat mantido");
});
