// "Conectado, mas sem receber" (2026-10-23, Gabriel Nº1 e ketlin Nº1): defesas da fila de processamento do microsserviço.
// Sem rede, sem Baileys — só as regras puras de pipeline-guard.js e a fiação em sessions.js (leitura do código-fonte).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MISSING_KEYS_ERROR_TEXT, NACK_UNHANDLED_ERROR, NO_MESSAGE_FOUND_ERROR_TEXT, PIPELINE_RESTART_LIMIT, PIPELINE_STUCK_MS, PLACEHOLDER_BATCH_MAX,
  PDO_TYPE_PLACEHOLDER_MESSAGE_RESEND, buildAckStanza, buildPlaceholderResendRequest, createNodeTracker, createRateWindow, decidePipelineAction,
  describeNode, monitorMutex, placeholderKeyFor, shouldNackFailedDecrypt, snapshotNode
} from "../whatsapp-individual-service/src/pipeline-guard.js";
import { DIAG_REASON, createMessageDiagnostics } from "../whatsapp-individual-service/src/message-diagnostics.js";

const ME = "5514999990000:12@s.whatsapp.net";
const messageNode = (attrs = {}, content = [{ tag: "enc", attrs: { type: "msg" }, content: new Uint8Array([1]) }]) => ({
  tag: "message", attrs: { id: "ABC123", from: "26409804292133:0@lid", type: "text", t: "1761134836", ...attrs }, content
});
const stub = (param, key = {}) => ({ key: { id: "ABC123", remoteJid: "26409804292133@lid", fromMe: true, ...key }, messageStubType: 2, messageStubParameters: [param] });

test("ack igual ao Baileys 7 (buildAckStanza): id, to = from, class, error, type, participant/recipient e from = nós", () => {
  const node = snapshotNode(messageNode({ participant: "x@lid", recipient: "y@s.whatsapp.net", offline: "1" }));
  assert.deepEqual(buildAckStanza(node, { errorCode: NACK_UNHANDLED_ERROR, meId: ME }), {
    tag: "ack",
    attrs: { id: "ABC123", to: "26409804292133:0@lid", class: "message", error: "500", participant: "x@lid", recipient: "y@s.whatsapp.net", type: "text", from: ME }
  });
  const receipt = snapshotNode({ tag: "receipt", attrs: { id: "R1", from: "a@s.whatsapp.net" } });
  assert.deepEqual(buildAckStanza(receipt, { meId: ME }), { tag: "ack", attrs: { id: "R1", to: "a@s.whatsapp.net", class: "receipt" } });
  assert.equal(buildAckStanza({ tag: "message", attrs: { id: "x" } }), null, "sem from não confirma");
});

test("snapshot guarda só atributos (nunca o conteúdo cifrado)", () => {
  const snap = snapshotNode(messageNode());
  assert.equal(snap.encType, "msg");
  assert.equal(snap.unavailable, false);
  assert.equal(JSON.stringify(snap).includes("content"), false);
});

test("NACK só para falha que o Baileys 6.7.24 deixa sem confirmação", () => {
  const node = snapshotNode(messageNode());
  assert.equal(shouldNackFailedDecrypt(stub("No matching sessions found for message"), node), true);
  assert.equal(shouldNackFailedDecrypt(stub(MISSING_KEYS_ERROR_TEXT), node), false, "missing keys: o Baileys já nega");
  const unavailable = snapshotNode(messageNode({}, [{ tag: "unavailable", attrs: {} }]));
  assert.equal(shouldNackFailedDecrypt(stub(NO_MESSAGE_FOUND_ERROR_TEXT), unavailable), false, "<unavailable>: o Baileys já confirma");
  assert.equal(shouldNackFailedDecrypt(stub(NO_MESSAGE_FOUND_ERROR_TEXT), snapshotNode(messageNode({}, []))), true);
  assert.equal(shouldNackFailedDecrypt({ key: { id: "ABC123" }, message: { conversation: "oi" } }, node), false, "decifrada não");
  assert.equal(shouldNackFailedDecrypt(stub("x"), null), false, "sem o nó original não há o que confirmar");
});

test("rastreador de nós: lembra por id, marca confirmado, ignora o que não é mensagem e limita o tamanho", () => {
  let clock = 1000;
  const tracker = createNodeTracker({ max: 2, ttlMs: 100, now: () => clock });
  tracker.remember({ tag: "receipt", attrs: { id: "R", from: "a" } });
  assert.equal(tracker.get("R"), null);
  tracker.remember(messageNode({ id: "A" }));
  tracker.remember(messageNode({ id: "B" }));
  tracker.remember(messageNode({ id: "C" }));
  assert.equal(tracker.get("A"), null, "passou do limite");
  assert.equal(tracker.get("C").attrs.id, "C");
  tracker.markAcked("C");
  assert.equal(tracker.isAcked("C"), true);
  clock += 1000;
  tracker.remember(messageNode({ id: "D" }));
  assert.equal(tracker.get("B"), null, "velho demais");
});

test("vigia do mutex: mede a tarefa em execução, sabe o nó e não muda o resultado", async () => {
  let clock = 0;
  const calls = [];
  let release;
  const mutexObject = { mutex(code) { calls.push("orig"); return code(); } };
  const monitor = monitorMutex(mutexObject, { currentNode: () => snapshotNode(messageNode()), now: () => clock });
  assert.equal(await mutexObject.mutex(async () => 42), 42);
  assert.equal(monitor.oldestRunning(), null, "terminou");
  const hanging = mutexObject.mutex(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  clock = PIPELINE_STUCK_MS + 1;
  const running = monitor.oldestRunning();
  assert.equal(running.node.attrs.id, "ABC123");
  assert.equal(calls.length, 2, "o mutex original continua sendo usado");
  release("ok");
  assert.equal(await hanging, "ok");
  assert.equal(monitorMutex(null), null);
});

test("decisão do vigia: presa só depois do prazo; confirma o nó conhecido; reinicia até o limite por hora", () => {
  const node = snapshotNode(messageNode({ offline: "1" }));
  assert.deepEqual(decidePipelineAction({ running: null }), { stuck: false });
  assert.equal(decidePipelineAction({ running: { startedAt: 1000, node }, now: 1000 + PIPELINE_STUCK_MS - 1 }).stuck, false);
  const now = 1000 + PIPELINE_STUCK_MS;
  const stuck = decidePipelineAction({ running: { startedAt: 1000, node }, now });
  assert.equal(stuck.stuck, true);
  assert.equal(stuck.ackNode.attrs.id, "ABC123");
  assert.equal(stuck.restart, true);
  const many = Array.from({ length: PIPELINE_RESTART_LIMIT }, (_, i) => now - i * 1000);
  assert.equal(decidePipelineAction({ running: { startedAt: 1000, node }, now, restarts: many }).restart, false, "limite por hora");
  const old = Array.from({ length: PIPELINE_RESTART_LIMIT }, () => now - 2 * 60 * 60_000);
  assert.equal(decidePipelineAction({ running: { startedAt: 1000, node }, now, restarts: old }).restart, true, "reinícios antigos não contam");
  assert.equal(decidePipelineAction({ running: { startedAt: 1000, node: null }, now }).ackNode, null, "nó desconhecido: só reinicia");
  assert.equal(describeNode(node), "message.text.msg.off");
  assert.equal(describeNode(null), "unknown");
});

test("pedido ao celular: só conversa individual, até 10 por pedido, formato do whatsmeow", () => {
  assert.deepEqual(placeholderKeyFor(stub("x")), { remoteJid: "26409804292133@lid", fromMe: true, id: "ABC123" });
  assert.equal(placeholderKeyFor(stub("x", { remoteJid: "1203@g.us" })), null);
  assert.equal(placeholderKeyFor(stub("x", { remoteJid: "status@broadcast" })), null);
  assert.equal(placeholderKeyFor({ key: { id: "a", remoteJid: "b@s.whatsapp.net" }, message: {} }), null);
  const keys = Array.from({ length: 12 }, (_, i) => ({ remoteJid: "a@s.whatsapp.net", fromMe: false, id: `ID${i}` }));
  const built = buildPlaceholderResendRequest(keys);
  const request = built.message.protocolMessage.peerDataOperationRequestMessage;
  assert.equal(built.message.protocolMessage.type, 16);
  assert.equal(request.peerDataOperationRequestType, PDO_TYPE_PLACEHOLDER_MESSAGE_RESEND);
  assert.equal(request.placeholderMessageResendRequest.length, PLACEHOLDER_BATCH_MAX);
  assert.deepEqual(request.placeholderMessageResendRequest[0], { messageKey: { remoteJid: "a@s.whatsapp.net", fromMe: false, id: "ID0" } });
  assert.equal(built.stanzaAttrs.category, "peer");
  assert.equal(buildPlaceholderResendRequest([]), null);
});

test("limite de pedidos por hora", () => {
  let clock = 0;
  const window = createRateWindow({ limit: 3, windowMs: 1000, now: () => clock });
  assert.equal(window.take(2), 2);
  assert.equal(window.take(5), 1);
  assert.equal(window.take(1), 0);
  clock = 1001;
  assert.equal(window.take(1), 1);
});

test("resumo do socket ganha pedidos/recuperadas/confirmações só quando houver", () => {
  const diag = createMessageDiagnostics();
  diag.track(DIAG_REASON.DECRYPT_FAIL);
  assert.deepEqual(diag.summary(), { reason: DIAG_REASON.SOCKET_SUMMARY, detail: "dec1_rr0" });
  diag.track(DIAG_REASON.PLACEHOLDER_REQUEST);
  diag.track(DIAG_REASON.PLACEHOLDER_RECOVERED);
  diag.track(DIAG_REASON.DECRYPT_NACK);
  assert.deepEqual(diag.summary(), { reason: DIAG_REASON.SOCKET_SUMMARY, detail: "dec1_rr0_ph1_rec1_nk1" });
});

test("fiação em sessions.js: prazo dos downloads, vigia, reinício sem QR e rota /restart", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /options: \{ timeout: BAILEYS_HTTP_TIMEOUT_MS \}/);
  assert.match(sessions, /attachPipelineGuard\(userId, entry, sock, diag\)/);
  assert.match(sessions, /prependListener\(`CB:\$\{tag\}`/);
  assert.match(sessions, /monitorMutex\(sock\.processingMutex/);
  assert.match(sessions, /connectSession\(userId, \{ trigger: "restart" \}\)/);
  const restartBody = sessions.slice(sessions.indexOf("async function restartLiveSocket"), sessions.indexOf("export async function restartSession"));
  assert.ok(restartBody.length > 50);
  assert.equal(/clearSessionCreds|logout\(/.test(restartBody), false, "reinício nunca apaga credenciais nem faz logout");
  const server = readFileSync(new URL("../whatsapp-individual-service/src/server.js", import.meta.url), "utf8");
  assert.match(server, /app\.post\("\/sessions\/:userId\/restart"/);
  const db = readFileSync(new URL("../whatsapp-individual-service/src/db.js", import.meta.url), "utf8");
  assert.match(db, /signal: AbortSignal\.timeout\(CRM_CALL_TIMEOUT_MS\)/);
});
