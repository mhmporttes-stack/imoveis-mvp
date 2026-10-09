// "Online / visto por último" (pedido do dono, 2026-10-09): só leitura, só WhatsApp pessoal conectado, no máximo 1
// pedido por minuto por contato, nada gravado no banco.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("microsserviço: presença só leitura, com limite de 1 pedido/min por contato", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  const fn = sessions.slice(sessions.indexOf("export async function getContactPresence"), sessions.indexOf("export async function getProfilePictureUrl"));
  assert.match(fn, /now - \(presenceAsked\.get\(key\) \|\| 0\) > 60_000/);
  assert.match(fn, /sock\.presenceSubscribe\(jid\)/);
  assert.doesNotMatch(fn, /sendMessage|sendPresenceUpdate|logout/);
  assert.match(sessions, /sock\.ev\.on\("presence\.update"/);
});

test("CRM: só conversa do WhatsApp pessoal (oficial não informa), mesmo escopo do Chat, nunca lança", () => {
  const lib = read("lib/whatsapp-chat.js");
  const fn = lib.slice(lib.indexOf("export async function getChatContactPresence"), lib.indexOf("export async function getChatContactPhotoUrl"));
  assert.match(fn, /await loadConversation\(id, auth/);
  assert.match(fn, /if \(!owner \|\| conversation\.private_at\) return \{ available: false \};/);
  assert.match(fn, /catch \{\s*\n\s*return \{ available: false \};/);
  const route = read("app/api/admin/whatsapp-chat/conversations/[id]/presence/route.js");
  assert.match(route, /const auth = await requireAdminApi\(request\);\s*\n\s*if \(!auth\.ok\)/);
});
