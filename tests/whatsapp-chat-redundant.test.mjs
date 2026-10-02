import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildChatScope } from "../lib/whatsapp-chat-scope.mjs";
import { isUsefulMessage, redundantOfficialConversationIds } from "../lib/whatsapp-chat-redundant.mjs";

// Regra do dono (2026-10-02), SÓ apresentação: conversa do número oficial que ficou apenas com
// envio que falhou, quando existe a conversa pessoal correta do mesmo telefone, sai da lista normal.

const OFFICIAL = "00000000-0000-0000-0000-000000000000";
const KETLIN = "f67fa793-330e-4951-8128-401d56e9ecf5";
const OTHER = "8cb63e68-7bb8-4df1-b4bc-35a53e8c2064";
const PHONE = "+5514996322044";

const official = { id: "conv-oficial", contact_phone: PHONE, session_key: OFFICIAL };
const personal = { contact_phone: PHONE, session_key: KETLIN };
const admin = buildChatScope({ generalAdmin: true });
const ketlin = buildChatScope({ broker: true, profileId: KETLIN });
const outro = buildChatScope({ broker: true, profileId: OTHER });
const hide = (extra = {}) => redundantOfficialConversationIds({ rows: [official], personalSiblings: [personal], usefulConversationIds: new Set(), scope: admin, ...extra });

test("só envio que falhou + conversa pessoal correta -> esconde da lista", () => {
  assert.deepEqual([...hide()], ["conv-oficial"]);
  assert.deepEqual([...hide({ scope: ketlin })], ["conv-oficial"]);
});

test("conversa vazia do oficial (sem nenhuma mensagem) também é redundante", () => {
  assert.deepEqual([...hide()], ["conv-oficial"]);
});

test("com mensagem útil (recebida, nota interna ou envio que não falhou) continua aparecendo", () => {
  assert.equal(hide({ usefulConversationIds: new Set(["conv-oficial"]) }).size, 0);
  assert.equal(isUsefulMessage({ direction: "inbound", status: "received" }), true);
  assert.equal(isUsefulMessage({ direction: "internal", status: null }), true);
  assert.equal(isUsefulMessage({ direction: "outbound", status: "delivered" }), true);
  assert.equal(isUsefulMessage({ direction: "outbound", status: "sent" }), true);
  assert.equal(isUsefulMessage({ direction: "outbound", status: "failed" }), false);
});

test("sem conversa pessoal do mesmo telefone, ou fora do escopo de quem olha, não esconde", () => {
  assert.equal(hide({ personalSiblings: [] }).size, 0);
  assert.equal(hide({ personalSiblings: [{ contact_phone: "+5511999999999", session_key: KETLIN }] }).size, 0);
  assert.equal(hide({ scope: outro }).size, 0, "quem não enxerga a conversa pessoal continua vendo a entrada");
});

test("só esconde conversa do número oficial; conversa pessoal nunca é escondida", () => {
  const rows = [{ id: "conv-pessoal", contact_phone: PHONE, session_key: KETLIN }];
  assert.equal(redundantOfficialConversationIds({ rows, personalSiblings: [personal], usefulConversationIds: new Set(), scope: admin }).size, 0);
});

test("é só apresentação: a listagem filtra linhas e nunca altera/apaga dados", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const code = readFileSync(path.join(root, "lib/whatsapp-chat.js"), "utf8");
  const start = code.indexOf("async function hideRedundantOfficialRows(");
  const body = code.slice(start, code.indexOf("async function buildConversationRows("));
  assert.doesNotMatch(body, /\.(update|delete|insert|upsert)\(/, "nenhuma escrita no banco");
  assert.match(code, /await hideRedundantOfficialRows\(rows\.slice\(0, pageSize\), auth\)/);
  assert.match(code, /await hideRedundantOfficialRows\(data\.slice\(0, 500\), auth\)/);
});
