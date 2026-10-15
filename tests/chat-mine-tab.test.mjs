// Aba com o nome da gestora/administrador no Chat: só os clientes dela (2026-10-15).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allowedBrokerFilter, buildChatScope } from "../lib/whatsapp-chat-scope.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("gestora pode filtrar pelo próprio id (entra no escopo dela); corretor comum não ganha filtro", () => {
  const manager = buildChatScope({ manager: true, profileId: "M", managedUserIds: ["A", "B"] });
  assert.equal(allowedBrokerFilter(manager, "M"), "M");
  assert.equal(allowedBrokerFilter(manager, "OUTRA_EQUIPE"), null);
  assert.equal(allowedBrokerFilter(buildChatScope({ generalAdmin: true }), "M"), "M");
  assert.equal(allowedBrokerFilter(buildChatScope({ broker: true, profileId: "A" }), "A"), null);
});

test("a aba aparece só para quem gerencia, com o primeiro nome, como primeira da fila", () => {
  const ui = read("components/WhatsappChat.jsx");
  assert.match(ui, /mineScope=\{canManage && currentUserId \? \{ active: scopedBroker\?\.id === currentUserId/);
  assert.match(ui, /\{mineScope \? \(\s*<button[\s\S]*?\{mineScope\.label\}\s*<\/button>\s*\) : null\}\s*\{FILTERS\.filter/);
  assert.match(read("app/admin/chat/page.jsx"), /currentUserName=\{auth\.profile\?\.name \|\| ""\}/);
});
