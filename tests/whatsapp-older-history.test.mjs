import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOnDemandRequest, classifyHistoryProtocol, createOnDemandRegistry, describePeerNode, onDemandVariants, toUnixSeconds } from "../whatsapp-individual-service/src/history-on-demand.js";
import { isValidOlderHistoryRequestId, olderHistoryMessage, planNextRound, roundPhase } from "../lib/whatsapp-older-history-core.mjs";

// "Carregar mensagens anteriores do celular" (pedido do dono, 2026-10-11): pedido ON_DEMAND por conversa.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("serviço: pede ao celular (pedido próprio, não o fetchMessageHistory em ms) e o ON_DEMAND ignora a janela da semana", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  assert.match(sessions, /export async function requestOlderHistory\(/);
  // Como o whatsmeow: protocolMessage direto (sem deviceSentMessage do relayMessage), cifrado para o próprio celular.
  assert.match(sessions, /const sentId = await sendRawPeerRequest\(sock, item\.built\);/);
  assert.match(sessions, /await sock\.sendNode\(\{ tag: "message", attrs: \{ id, to: meJid, \.\.\.built\.stanzaAttrs \}, content \}\);/);
  assert.doesNotMatch(sessions, /sock\.relayMessage\(/);
  // Recibo do celular e ack do servidor observados no nó bruto (o Baileys não emite evento para peer_msg).
  assert.match(sessions, /sock\.ws\.on\("CB:receipt"/);
  // Retry do celular (não conseguiu decifrar): reenvia o MESMO pedido com sessão nova, no máximo 2 vezes.
  assert.match(sessions, /if \(tag === "receipt" && node\.attrs\.type === "retry"\)/);
  assert.match(sessions, /const PEER_RETRY_LIMIT = 2;/);
  assert.match(sessions, /await sendRawPeerRequest\(sock, item\.built, \{ id, encryptJid, forceSession: true, retryCount: item\.retries \}\);/);
  assert.match(sessions, /reason: "req_retry_resent"/);
  assert.doesNotMatch(sessions, /sock\.fetchMessageHistory\(/);
  assert.match(sessions, /const cutoff = onDemand \? 0 : Date\.now\(\) - HISTORY_WINDOW_MS;/);
  // ON_DEMAND sempre processado, mesmo com o histórico do pareamento desligado na Railway.
  assert.match(sessions, /shouldSyncHistoryMessage: \(notification\) => wantsHistory \|\| Number\(notification\?\.syncType\) === HISTORY_SYNC_ON_DEMAND/);
  assert.match(sessions, /if \(!wantsHistory && Number\(syncType\) !== HISTORY_SYNC_ON_DEMAND\) return;/);
  const server = read("whatsapp-individual-service/src/server.js");
  assert.match(server, /app\.post\("\/sessions\/:userId\/history"/);
  assert.match(server, /app\.get\("\/sessions\/:userId\/history\/:requestId"/);
});

test("pedido ON_DEMAND: horário em SEGUNDOS, atributos e nó meta do WhatsApp", () => {
  const built = buildOnDemandRequest({ chatJid: "123456789012@lid", oldestId: "ABCDEF", oldestFromMe: true, oldestTimestamp: 1760000000123, count: 80 });
  const request = built.message.protocolMessage.peerDataOperationRequestMessage;
  assert.equal(built.message.protocolMessage.type, 16);
  assert.equal(request.peerDataOperationRequestType, 3);
  assert.deepEqual(request.historySyncOnDemandRequest, { chatJid: "123456789012@lid", oldestMsgId: "ABCDEF", oldestMsgFromMe: true, oldestMsgTimestampMs: 1760000000, onDemandMsgCount: 50 });
  assert.deepEqual(built.stanzaAttrs, { type: "text", category: "peer", push_priority: "high_force", privacy_sensitive: "1" });
  assert.deepEqual(built.metaNode, { tag: "meta", attrs: { appdata: "default" } });
  assert.equal(built.message.deviceSentMessage, undefined);
  assert.deepEqual(onDemandVariants("123@lid", "5511988887777"), [{ variant: "raw_lid", chatJid: "123@lid" }, { variant: "raw_pn", chatJid: "5511988887777@s.whatsapp.net" }]);
  assert.deepEqual(onDemandVariants("123@lid", "lid:123"), [{ variant: "raw_lid", chatJid: "123@lid" }]);
  assert.deepEqual(onDemandVariants("5511988887777@s.whatsapp.net", ""), [{ variant: "raw_pn", chatJid: "5511988887777@s.whatsapp.net" }]);
  assert.deepEqual(describePeerNode("receipt", { type: "peer_msg" }), { reason: "req_rcpt_peer_msg" });
  assert.equal(describePeerNode("ack", { error: "479" }).reason, "req_srv_err");
  assert.equal(toUnixSeconds(1760000000), 1760000000);
  assert.throws(() => buildOnDemandRequest({ chatJid: "1@lid", oldestId: "", oldestTimestamp: 1 }));
});

test("diagnóstico: reconhece notificação de histórico e resposta do celular sem ler conteúdo", () => {
  assert.deepEqual(
    classifyHistoryProtocol({ message: { protocolMessage: { type: 5, historySyncNotification: { syncType: 6, peerDataRequestSessionId: "REQ1", chunkOrder: 0 } } } }),
    { kind: "notification", syncType: 6, sessionId: "REQ1", chunkOrder: 0 }
  );
  assert.deepEqual(
    classifyHistoryProtocol({ message: { protocolMessage: { type: 17, peerDataOperationRequestResponseMessage: { peerDataOperationRequestType: 3, stanzaId: "REQ1", peerDataOperationResult: [{ fullHistorySyncOnDemandRequestResponse: { responseCode: 2 } }] } } } }),
    { kind: "pdo_response", requestType: 3, sessionId: "REQ1", results: 1, responseCode: 2 }
  );
  assert.equal(classifyHistoryProtocol({ message: { conversation: "oi" } }), null);
});

test("registro de pedidos: estado, entregues e referência da próxima rodada (mais antiga da conversa)", () => {
  let clock = 1_000_000;
  const registry = createOnDemandRegistry({ now: () => clock });
  registry.start("u1", "REQ1", { to: "5511", chatJid: "1@lid", count: 50 });
  assert.equal(registry.status("u1", "REQ1").state, "waiting");
  assert.equal(registry.status("u2", "REQ1").state, "unknown");
  const entry = registry.match("u1", "OUTRO");
  assert.equal(entry.requestId, "REQ1");
  registry.setVariant("u1", "REQ1", "raw_lid");
  registry.alias("u1", "REQ2", entry, "raw_pn");
  assert.equal(registry.match("u1", "REQ2").requestId, "REQ1");
  assert.equal(registry.variantOf("u1", "REQ2"), "raw_pn");
  assert.equal(registry.isPending("u1", "REQ2"), true);
  registry.beginChunk(entry);
  assert.equal(registry.status("u1", "REQ1").state, "receiving");
  registry.addDelivered(entry, 25);
  clock += 1000;
  registry.recordChunk(entry, {
    messages: [
      { key: { id: "A", fromMe: false, remoteJid: "1@lid" }, t: 300 },
      { key: { id: "B", fromMe: true, remoteJid: "1@lid" }, t: 200 },
      { key: { id: "C", fromMe: false, remoteJid: "9@s.whatsapp.net" }, t: 100 }
    ],
    timestampSecondsOf: (msg) => msg.t,
    chatJidOf: (msg) => msg.key.remoteJid
  });
  const status = registry.status("u1", "REQ1");
  assert.equal(status.state, "received");
  assert.equal(status.received, 3);
  assert.equal(status.delivered, 25);
  assert.equal(status.oldestAt, new Date(200_000).toISOString());
  assert.deepEqual(registry.get("u1", "REQ1").oldest, { id: "B", fromMe: true, seconds: 200, chatJid: "1@lid" });
});

test("rodadas: até 15 dias, fim do histórico, limite de rodadas e sem resposta", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const day = 86_400_000;
  assert.deepEqual(planNextRound({ round: 1, received: 50, oldestAt: new Date(now - 3 * day).toISOString(), nowMs: now }), { next: true, reason: "continue" });
  assert.equal(planNextRound({ round: 2, received: 50, oldestAt: new Date(now - 16 * day).toISOString(), nowMs: now }).reason, "target");
  assert.equal(planNextRound({ round: 2, received: 12, oldestAt: new Date(now - 3 * day).toISOString(), nowMs: now }).reason, "end");
  assert.equal(planNextRound({ round: 1, received: 0, oldestAt: null, nowMs: now }).reason, "end");
  assert.equal(planNextRound({ round: 12, received: 50, oldestAt: new Date(now - 3 * day).toISOString(), nowMs: now }).reason, "max_rounds");
  assert.equal(roundPhase({ state: "waiting", elapsedMs: 10_000 }), "waiting");
  assert.equal(roundPhase({ state: "waiting", elapsedMs: 46_000 }), "timeout");
  assert.equal(roundPhase({ state: "receiving", elapsedMs: 60_000 }), "receiving");
  assert.equal(roundPhase({ state: "received", quietMs: 1000 }), "receiving");
  assert.equal(roundPhase({ state: "received", quietMs: 6000 }), "settled");
  assert.equal(roundPhase({ state: "unknown" }), "timeout");
  assert.match(olderHistoryMessage({ phase: "timeout", total: 0, waitedSeconds: 45 }), /não respondeu em 45 s/);
  assert.equal(
    olderHistoryMessage({ phase: "timeout", total: 0, waitedSeconds: 47, phoneAck: "peer_msg", ownerName: "Bruna" }),
    "O celular de Bruna recebeu o pedido, mas não respondeu em 47 s. Abra o WhatsApp no celular de Bruna, deixe aberto na tela e toque de novo."
  );
  assert.match(olderHistoryMessage({ phase: "done", total: 120, oldestAt: new Date(now - 16 * day).toISOString(), reason: "target" }), /120 mensagens.*15 dias/);
  assert.equal(isValidOlderHistoryRequestId("3EB0A1B2C3D4E5F6A7B8"), true);
  assert.equal(isValidOlderHistoryRequestId("../x"), false);
});

test("vídeo só no ON_DEMAND, com limite de tamanho e de quantidade", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  assert.match(sessions, /const mediaKinds = onDemand \? ON_DEMAND_MEDIA_KINDS_SET : HISTORY_MEDIA_KINDS;/);
  assert.match(sessions, /const HISTORY_MEDIA_KINDS = new Set\(\["image", "audio"\]\);/);
  assert.match(sessions, /counts\.videos >= ON_DEMAND_MAX_VIDEOS/);
  assert.match(sessions, /const MAX_MEDIA_BYTES = 16 \* 1024 \* 1024;/);
});

test("CRM: rota com guard, só WhatsApp pessoal, nunca grupo, mesmo escopo da conversa", () => {
  const route = read("app/api/admin/whatsapp-chat/conversations/[id]/older/route.js");
  assert.match(route, /const auth = await requireAdminApi\(request\);\n\s*if \(!auth\.ok\)/);
  const chat = read("lib/whatsapp-chat.js");
  const body = chat.slice(chat.indexOf("export async function requestChatOlderHistory"), chat.indexOf("export async function getChatContactPhotoUrl"));
  assert.match(body, /const conversation = await loadConversation\(id, auth\);/);
  assert.match(body, /export async function getChatOlderHistoryStatus\(/);
  assert.match(route, /export async function GET\(request, \{ params \}\) \{\n\s*const auth = await requireAdminApi\(request\);/);
  assert.match(body, /assertNotGroup\(conversation\);/);
  assert.match(body, /if \(!owner\) throw new WhatsappChatError/);
  assert.match(body, /\.order\("message_at", \{ ascending: true \}\)/);
});
