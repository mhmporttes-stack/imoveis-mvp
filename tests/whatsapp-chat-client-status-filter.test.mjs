// Chat: filtro pela ETAPA do cliente (pedido do dono 2026-10-06). Aplicado no servidor (junção com o cadastro), dentro do
// escopo de sempre; "Arquivado" respeita a WA-13: só a conta do dono lista, e em somente leitura.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("servidor: status validado, junção interna no cadastro e dentro do escopo; arquivados só para o dono", () => {
  const lib = read("lib/whatsapp-chat.js");
  const fn = /export async function listChatConversations[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(fn, /CLIENT_STATUS_VALUES\.has\(clientStatus\)/);
  assert.match(fn, /if \(status\) request = request\.eq\("cs\.status", status\);/);
  assert.match(fn, /runScopedQuery\(auth, status \? `\*, \$\{CLIENT_STATUS_EMBED\}` : "\*"/, "o filtro roda DENTRO do escopo de sempre");
  assert.match(fn, /if \(!isArchivedChatViewer\(auth\)\) return \[\];/);
  assert.match(fn, /archivedReadOnly: true/);
  assert.match(lib, /const \{ scope, cs, \.\.\.clean \} = row;/, "a junção não vaza para a linha da lista");
  assert.match(read("app/api/admin/whatsapp-chat/conversations/route.js"), /clientStatus: params\.get\("clientStatus"\)/);
});

test("tela: seletor de status na lista; opção Arquivados só para quem pode ver", () => {
  const ui = read("components/WhatsappChat.jsx");
  assert.match(ui, /data-client-status-filter=""/);
  assert.match(ui, /option\.value !== "archived" \|\| canSeeArchived/);
  assert.match(ui, /params\.set\("clientStatus", clientStatusRef\.current\)/);
  assert.match(read("app/admin/chat/page.jsx"), /canSeeArchived=\{isArchivedChatViewer\(auth\)\}/);
});
