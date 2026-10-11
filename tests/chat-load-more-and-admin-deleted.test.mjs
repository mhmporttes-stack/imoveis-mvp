import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedidos do dono (2026-10-11): "Carregar mais" na lista e "Excluir conversa" só some para quem não é admin geral.
test("lista do Chat tem Carregar mais (before = conversa mais antiga)", () => {
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /new URLSearchParams\(\{ filter: filterRef\.current, before: oldest \}\)/);
  assert.match(ui, /"Carregar mais"/);
});

test("conversa excluída continua para o administrador geral", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /origin: \{ \.\.\.\(conversation\.origin \|\| \{\}\), deleted_by_user: true \}/);
  assert.match(chat, /\.or\("deleted_at\.is\.null,origin->>deleted_by_user\.eq\.true"\)/);
  assert.match(chat, /const adminSeesDeleted = Boolean\(data\?\.deleted_at && data\.origin\?\.deleted_by_user === true && auth && isGeneralAdminAuth\(auth\)\);/);
  assert.match(chat, /scopedMerge\(columns, build, \[filterId\], \{ allowDeleted: scope\.all \}\)/);
});
