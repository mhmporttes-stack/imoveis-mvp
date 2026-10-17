import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collapseSiblingRows, groupConversationsOnce, replyConversation, siblingKey } from "../lib/whatsapp-chat-siblings.mjs";

// Regra do dono (2026-10-17 — WA-34): o mesmo cliente aparece UMA vez por corretor no Chat, mesmo com conversa nos dois
// números. Só apresentação: nenhuma conversa é fundida nem apagada no banco.

const OFFICIAL = "00000000-0000-0000-0000-000000000000";
const KETLIN = "f67fa793-330e-4951-8128-401d56e9ecf5";
const OTHER = "8cb63e68-7bb8-4df1-b4bc-35a53e8c2064";
const PHONE = "+5514996322044";

const n1 = { id: "n1", contact_phone: PHONE, session_key: KETLIN, session_slot: 1, last_message_at: "2026-10-17T10:00:00Z", last_inbound_at: "2026-10-17T10:00:00Z", unread_count: 2 };
const n2 = { id: "n2", contact_phone: PHONE, session_key: KETLIN, session_slot: 2, last_message_at: "2026-10-17T12:00:00Z", last_inbound_at: null, unread_count: 0 };

test("irmãs: mesmo dono + mesmo telefone + mesmo lado do Particular; oficial, grupo e excluída nunca se juntam", () => {
  assert.equal(siblingKey(n1), siblingKey(n2));
  assert.notEqual(siblingKey(n1), siblingKey({ ...n2, session_key: OTHER }));
  assert.notEqual(siblingKey(n1), siblingKey({ ...n2, private_at: "2026-10-17T00:00:00Z" }));
  assert.equal(siblingKey({ ...n1, session_key: OFFICIAL }), "");
  assert.equal(siblingKey({ ...n1, contact_phone: "group:123" }), "");
  assert.equal(siblingKey({ ...n1, deleted_at: "2026-10-17T00:00:00Z" }), "");
});

test("lista: as duas conversas na mesma página viram uma linha (a mais recente)", () => {
  const { rows, members } = collapseSiblingRows([n2, n1], []);
  assert.deepEqual(rows.map((row) => row.id), ["n2"]);
  assert.deepEqual(members.get("n2").map((row) => row.id), ["n2", "n1"]);
});

test("lista: página seguinte não repete o cliente quando a irmã mais nova entra na aba", () => {
  const { rows } = collapseSiblingRows([n1], [n2], () => true);
  assert.deepEqual(rows, []);
});

test("lista: irmã mais nova que NÃO entra na aba não esconde o cliente (ex.: não lidas só no Número 1)", () => {
  const { rows, members } = collapseSiblingRows([n1], [n2], () => false);
  assert.deepEqual(rows.map((row) => row.id), ["n1"]);
  assert.equal(members.get("n1").length, 2);
});

test("lista: corretores diferentes continuam com uma linha cada", () => {
  const other = { ...n2, id: "x", session_key: OTHER };
  const { rows } = collapseSiblingRows([other, n1], []);
  assert.deepEqual(rows.map((row) => row.id), ["x", "n1"]);
});

test("abrir: responde pelo número em que o cliente escreveu por último; sem mensagem dele, a mais recente", () => {
  assert.equal(replyConversation([n2, n1]).id, "n1");
  assert.equal(replyConversation([{ ...n2 }, { ...n1, last_inbound_at: null }]).id, "n2");
});

test("contadores: cada cliente conta uma vez, com a conversa mais recente primeiro", () => {
  const groups = groupConversationsOnce([n1, n2, { id: "official", contact_phone: PHONE, session_key: OFFICIAL }]);
  assert.equal(groups.length, 2);
  const personal = groups.find((group) => group.length === 2);
  assert.equal(personal[0].id, "n2");
});

test("servidor: lista, abertura e contadores usam a regra (sem fundir nada no banco)", () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const source = readFileSync(path.join(root, "lib/whatsapp-chat.js"), "utf8");
  assert.match(source, /collapseSiblingRows\(tabRows, siblings/);
  assert.match(source, /\.in\("conversation_id", groupIds\)/);
  assert.match(source, /groupConversationsOnce\(rows\)/);
  assert.doesNotMatch(source, /from\("whatsapp_conversations"\)\.delete\(/);
  const ui = readFileSync(path.join(root, "components/WhatsappChat.jsx"), "utf8");
  assert.match(ui, /isSameConversation\(conversation, selectedId\)/);
});
