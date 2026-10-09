// Editar o nome do contato no Chat (pedido do dono, 2026-10-09): mesmo escopo do Chat, nome do cliente junto pelo
// caminho normal do cadastro, e mensagem nova não sobrescreve o nome corrigido.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib = fs.readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/admin/whatsapp-chat/conversations/[id]/route.js", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");

test("renameChatContact: valida, usa o escopo do Chat e o caminho normal do cadastro", () => {
  const fn = lib.slice(lib.indexOf("export async function renameChatContact"), lib.indexOf("export async function updateChatConversationStatus"));
  assert.match(fn, /normalizePersonName\(String\(rawName/);
  assert.match(fn, /name\.length < 2 \|\| name\.length > 80/);
  assert.match(fn, /await loadConversation\(id, auth/);
  assert.match(fn, /updateSimulationRegistration\(conversation\.client_id, \{ fullName: name, adminEmail: getActingAdminEmail\(auth\) \}, auth\)/);
  assert.match(fn, /update\(\{ contact_name: name/);
});

test("rota: PATCH { contactName } só depois do guard de login", () => {
  assert.match(route, /export async function PATCH[\s\S]*?const auth = await requireAdminApi\(request\);\s*\n\s*if \(!auth\.ok\)[\s\S]*?body\?\.contactName/);
});

test("tela: lápis no painel do contato", () => {
  assert.match(ui, /<ContactNameEditor conversation=\{conversation\} onChanged=\{onChanged\} \/>/);
  assert.match(ui, /body: JSON\.stringify\(\{ contactName: value \}\)/);
});

test("mensagem nova não sobrescreve o nome já preenchido (apply_inbound)", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261009160000_whatsapp_private_conversations.sql", import.meta.url), "utf8");
  assert.match(sql, /contact_name = coalesce\(nullif\(c\.contact_name, ''\), nullif\(p_name, ''\)\)/);
});
