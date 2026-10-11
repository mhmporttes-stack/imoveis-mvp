import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// "Carregar mensagens anteriores do celular" (pedido do dono, 2026-10-11): pedido ON_DEMAND por conversa.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("serviço: pede ao celular pelo fetchMessageHistory e o ON_DEMAND ignora a janela da semana", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  assert.match(sessions, /export async function requestOlderHistory\(/);
  assert.match(sessions, /sock\.fetchMessageHistory\(total, \{ remoteJid: jid, id, fromMe: Boolean\(oldestFromMe\) \}, timestampMs\)/);
  assert.match(sessions, /const HISTORY_SYNC_ON_DEMAND = 6;/);
  assert.match(sessions, /const cutoff = onDemand \? 0 : Date\.now\(\) - HISTORY_WINDOW_MS;/);
  const server = read("whatsapp-individual-service/src/server.js");
  assert.match(server, /app\.post\("\/sessions\/:userId\/history"/);
});

test("CRM: rota com guard, só WhatsApp pessoal, nunca grupo, mesmo escopo da conversa", () => {
  const route = read("app/api/admin/whatsapp-chat/conversations/[id]/older/route.js");
  assert.match(route, /const auth = await requireAdminApi\(request\);\n\s*if \(!auth\.ok\)/);
  const chat = read("lib/whatsapp-chat.js");
  const body = chat.slice(chat.indexOf("export async function requestChatOlderHistory"), chat.indexOf("export async function getChatContactPhotoUrl"));
  assert.match(body, /const conversation = await loadConversation\(id, auth\);/);
  assert.match(body, /assertNotGroup\(conversation\);/);
  assert.match(body, /if \(!owner\) throw new WhatsappChatError/);
  assert.match(body, /\.order\("message_at", \{ ascending: true \}\)/);
});
