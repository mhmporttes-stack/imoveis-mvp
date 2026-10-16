import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICIAL_SESSION_KEY, transferHistoryConversationAllowed, transferHistoryMessageAllowed } from "../lib/whatsapp-chat-scope.mjs";
import { transferHistoryDivider, transferHistoryNumberLabel } from "../lib/cooled-clients-core.mjs";

// FUN-15g (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16): o corretor que recebe o cliente transferido lê, somente
// leitura, o histórico das conversas do cliente com o corretor anterior, com divisor "Até aqui ... A partir daqui".

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CLIENT = "11111111-1111-4111-8111-111111111111";
const JENNYFER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ctx = { clientId: CLIENT, previousBrokerId: JENNYFER };
const conversation = (patch = {}) => ({ client_id: CLIENT, contact_phone: "5541999990000", session_key: JENNYFER, private_at: null, deleted_at: null, ...patch });

test("conversa: número pessoal do corretor anterior e oficial entram; outro cliente/outro número não", () => {
  assert.equal(transferHistoryConversationAllowed(conversation(), ctx), true);
  assert.equal(transferHistoryConversationAllowed(conversation({ session_key: OFFICIAL_SESSION_KEY }), ctx), true);
  assert.equal(transferHistoryConversationAllowed(conversation({ session_key: OTHER }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ client_id: OTHER }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ contact_phone: "group:123" }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation(), { clientId: CLIENT, previousBrokerId: "" }), false);
});

test("conversa Particular ou excluída nunca entra", () => {
  assert.equal(transferHistoryConversationAllowed(conversation({ private_at: "2026-10-10T10:00:00Z" }), ctx), false);
  assert.equal(transferHistoryConversationAllowed(conversation({ deleted_at: "2026-10-10T10:00:00Z" }), ctx), false);
});

test("mensagem: só até a transferência, sem interna/reação/apagada/outro WhatsApp pessoal", () => {
  const opts = { previousBrokerId: JENNYFER, cutoffAt: "2026-10-16T12:00:00Z", historyCutoffAt: null };
  const msg = (patch = {}) => ({ direction: "inbound", message_type: "text", message_at: "2026-10-15T12:00:00Z", session_user_id: JENNYFER, metadata: {}, ...patch });
  assert.equal(transferHistoryMessageAllowed(msg(), opts), true);
  assert.equal(transferHistoryMessageAllowed(msg({ session_user_id: null }), opts), true);
  assert.equal(transferHistoryMessageAllowed(msg({ message_at: "2026-10-16T12:00:01Z" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ direction: "internal" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ message_type: "reaction" }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ metadata: { revoked_at: "2026-10-15T13:00:00Z" } }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg({ session_user_id: OTHER }), opts), false);
  assert.equal(transferHistoryMessageAllowed(msg(), { ...opts, historyCutoffAt: "2026-10-15T13:00:00Z" }), false);
});

test("divisor e rótulo do número", () => {
  assert.equal(transferHistoryNumberLabel({ official: true }), "oficial");
  assert.equal(transferHistoryNumberLabel({ slot: 1 }), "1");
  assert.equal(transferHistoryNumberLabel({ slot: 2, label: "Pessoal" }), "2 · Pessoal");
  assert.equal(
    transferHistoryDivider({ previousName: "Jennyfer", numberLabel: "1 · Pessoal", newName: "Gabriel" }),
    "Até aqui: conversa com Jennyfer (número 1 · Pessoal). A partir daqui: Gabriel assume."
  );
  assert.match(transferHistoryDivider({}), /^Até aqui: conversa com o corretor anterior \(número não identificado\)\. A partir daqui: o novo corretor assume\.$/);
});

test("permissão: rotas exigem login e a lib checa o escopo do responsável atual antes de ler", () => {
  for (const path of ["app/api/admin/cooled-clients/handoff/history/route.js", "app/api/admin/cooled-clients/handoff/history/media/[messageId]/route.js"]) {
    const source = read(path);
    assert.match(source, /const auth = await requireAdminApi\(request\);\n\s+if \(!auth\.ok\)/, path);
  }
  const lib = read("lib/cooled-clients.js");
  const loader = lib.slice(lib.indexOf("async function loadTransferredCase"), lib.indexOf("export async function getCooledHandoff"));
  assert.match(loader, /assertCanAccessResponsibleUser\(auth, registration\.responsible_user_id\)/);
  // Ainda com o corretor anterior, sem responsável ou na fila de espera: nada.
  assert.match(loader, /registration\.responsible_user_id === row\.broker_id/);
  assert.match(loader, /registration\.pending_distribution_at\) return null/);
  for (const name of ["export async function getCooledChatHistory", "export async function resolveCooledHistoryMedia"]) {
    const body = lib.slice(lib.indexOf(name), lib.indexOf("\n}\n", lib.indexOf(name)));
    assert.match(body, /await loadTransferredCase\(auth, clientId\)/, name);
    assert.match(body, /transferHistoryConversationAllowed/, name);
    assert.match(body, /transferHistoryMessageAllowed/, name);
  }
});

test("somente leitura: nada é copiado, gravado nem enviado", () => {
  const lib = read("lib/cooled-clients.js");
  const section = lib.slice(lib.indexOf("const HISTORY_MESSAGE_LIMIT"));
  assert.doesNotMatch(section, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(section, /ensureInboundMediaStored/);
  const component = read("components/cooled/CooledChatHistory.jsx");
  assert.doesNotMatch(component, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(component, /<textarea|sendChat|sendWhatsapp|whatsapp-chat\/conversations/i);
  assert.match(component, /data-transfer-divider/);
  assert.match(read("components/clients/ClientSheet.jsx"), /<CooledChatHistory clientId=\{registration\.id\} \/>/);
});
