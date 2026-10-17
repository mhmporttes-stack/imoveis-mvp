import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DISCONNECT_KIND,
  PRINTED_LIST_MODE_MESSAGE,
  classifyWhatsappDisconnect,
  isForbiddenSessionRow,
  isPrintedListMode,
  isPrintedListProtectedPath,
  printedListModeAppliesTo
} from "../lib/whatsapp-manual-disconnect-core.mjs";
import { hiddenNavKeys } from "../lib/whatsapp-access-core.mjs";
import { decideCardWhatsapp, CARD_WA_EXTERNAL, CARD_WA_CHAT } from "../lib/client-card-whatsapp-core.mjs";
import { createReconnectController } from "../whatsapp-individual-service/src/reconnect-policy.js";
import { createCloseHandler } from "../whatsapp-individual-service/src/session-lifecycle.js";

// PRO-15 (REGRA OFICIAL — dono, 2026-10-15): WhatsApp desconectado que não é banimento (403) nem restrição =
// modo lista impressa (sem Chat e sem Prospecção pelo CRM).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

const CONNECTED_AT = "2026-10-14T12:00:00.000Z";
const broker = (rows, openRestriction = null) => ({ role: "broker", isGeneralAdmin: false, rows, openRestriction });

test("desconectou pelo botão do CRM (status disconnected, sem motivo) = modo lista impressa", () => {
  const rows = [{ slot: 1, status: "disconnected", last_error: null, last_connected_at: CONNECTED_AT }];
  assert.equal(classifyWhatsappDisconnect({ rows }), DISCONNECT_KIND.MANUAL);
  assert.equal(isPrintedListMode(broker(rows)), true);
});

test("saiu pelo celular (logout 401) = modo lista impressa", () => {
  const rows = [{ slot: 1, status: "disconnected", last_error: "logged_out", last_disconnect_code: 401, last_disconnect_at: "2026-10-14T15:00:00Z", last_connected_at: CONNECTED_AT }];
  assert.equal(isPrintedListMode(broker(rows)), true);
});

test("outras quedas que não são ban (440, limite de reconexão, quedas repetidas) = modo lista impressa", () => {
  for (const last_error of ["needs_attention:connection_replaced: x", "needs_attention:retry_limit: x", "needs_attention:repeated_drops: x"]) {
    const rows = [{ slot: 1, status: "error", last_error, last_disconnect_code: 440, last_disconnect_at: "2026-10-14T15:00:00Z", last_connected_at: CONNECTED_AT }];
    assert.equal(isPrintedListMode(broker(rows)), true, last_error);
  }
});

test("banido/recusado (403 ou needs_attention:forbidden depois da última conexão) NÃO entra", () => {
  const byError = [{ slot: 1, status: "error", last_error: "needs_attention:forbidden: recusado", last_connected_at: CONNECTED_AT }];
  const byCode = [{ slot: 1, status: "disconnected", last_disconnect_code: 403, last_disconnect_at: "2026-10-14T15:00:00Z", last_connected_at: CONNECTED_AT }];
  for (const rows of [byError, byCode]) {
    assert.equal(classifyWhatsappDisconnect({ rows }), DISCONNECT_KIND.BANNED);
    assert.equal(isPrintedListMode(broker(rows)), false);
  }
});

test("403 ANTIGO (antes da última reconexão) não marca como banido: a desconexão manual seguinte conta", () => {
  const row = { slot: 1, status: "disconnected", last_error: null, last_disconnect_code: 403, last_disconnect_at: "2026-10-10T10:00:00Z", last_connected_at: CONNECTED_AT };
  assert.equal(isForbiddenSessionRow(row), false);
  assert.equal(isPrintedListMode(broker([row])), true);
});

test("restrição aberta (informada ou validada) NÃO entra — PRO-12/13/14 seguem valendo", () => {
  const rows = [{ slot: 1, status: "disconnected", last_connected_at: CONNECTED_AT }];
  for (const validation_status of ["informed", "validated"]) {
    assert.equal(classifyWhatsappDisconnect({ rows, openRestriction: { validation_status, ended_at: null } }), DISCONNECT_KIND.RESTRICTED);
    assert.equal(isPrintedListMode(broker(rows, { validation_status, ended_at: null })), false);
  }
  // restrição encerrada não protege
  assert.equal(isPrintedListMode(broker(rows, { validation_status: "informed", ended_at: "2026-10-14T16:00:00Z" })), true);
});

test("nunca conectou ('Aguardando WhatsApp') e sem sessão: tratado como hoje (não é 'desconectou')", () => {
  assert.equal(classifyWhatsappDisconnect({ rows: [] }), DISCONNECT_KIND.NEVER_CONNECTED);
  assert.equal(isPrintedListMode(broker([])), false);
  assert.equal(isPrintedListMode(broker([{ slot: 1, status: "qr_required", last_connected_at: null }])), false);
});

test("conectado (qualquer número) e reconexão automática em andamento não entram", () => {
  assert.equal(isPrintedListMode(broker([{ slot: 1, status: "connected", last_connected_at: CONNECTED_AT }])), false);
  assert.equal(isPrintedListMode(broker([
    { slot: 1, status: "disconnected", last_connected_at: CONNECTED_AT },
    { slot: 2, status: "connected", last_connected_at: CONNECTED_AT }
  ])), false);
  for (const status of ["reconnecting", "connecting", "stored"]) {
    assert.equal(classifyWhatsappDisconnect({ rows: [{ slot: 1, status, last_connected_at: CONNECTED_AT }] }), DISCONNECT_KIND.TRANSIENT, status);
  }
  // abrindo o QR para reconectar depois de desconectar: continua no modo lista impressa até conectar
  assert.equal(isPrintedListMode(broker([{ slot: 1, status: "qr_required", last_connected_at: CONNECTED_AT }])), true);
});

test("perfis: só corretor e associado; admin geral e gestor (PENDENTE) ficam de fora", () => {
  const rows = [{ slot: 1, status: "disconnected", last_connected_at: CONNECTED_AT }];
  assert.equal(isPrintedListMode({ role: "associate", rows }), true);
  assert.equal(isPrintedListMode({ role: "manager", rows }), false);
  assert.equal(isPrintedListMode({ role: "admin", rows }), false);
  assert.equal(isPrintedListMode({ role: "broker", isGeneralAdmin: true, rows }), false);
  assert.equal(printedListModeAppliesTo({ role: "broker" }), true);
});

test("menu: chatHidden tira só o Chat (Meta Diária fica); bloqueio antigo inalterado", () => {
  assert.deepEqual([...hiddenNavKeys({ chatHidden: true, isBrokerOrAssociate: true })], ["chat"]);
  assert.deepEqual([...hiddenNavKeys({})], []);
  assert.deepEqual([...hiddenNavKeys({ blocked: true, isBrokerOrAssociate: true })].sort(), ["chat", "daily-goal"]);
});

test("APIs do Chat recusadas no servidor; conexão do WhatsApp e demais rotas livres", () => {
  for (const p of ["/api/admin/whatsapp-chat/conversations", "/api/admin/whatsapp-chat/conversations/x/messages", "/api/admin/whatsapp-chat/summary", "/api/admin/whatsapp-chat/open-client", "/api/admin/client-documents/from-chat"]) {
    assert.equal(isPrintedListProtectedPath(p), true, p);
  }
  for (const p of ["/api/admin/whatsapp-individual/connect", "/api/admin/whatsapp-individual/status", "/api/admin/whatsapp-individual/card-state", "/api/daily-goal", "/api/prospecting/manual-lists"]) {
    assert.equal(isPrintedListProtectedPath(p), false, p);
  }
});

test("card do cliente: modo lista impressa abre o WhatsApp de fora (sem Chat)", () => {
  const base = { stateKnown: true, sessionStatus: "disconnected", isOwnClient: true, phone: "11999998888", device: "desktop" };
  assert.equal(decideCardWhatsapp({ ...base, printedListMode: true }).action, CARD_WA_EXTERNAL);
  assert.equal(decideCardWhatsapp({ ...base, printedListMode: true }).reason, "printed_list_mode");
  assert.equal(decideCardWhatsapp(base).action, CARD_WA_CHAT);
});

test("barreiras ligadas: guard central das APIs, página do Chat, app Chat, Prospecção, Meta Diária e supervisão", () => {
  const auth = source("lib/admin-auth.js");
  assert.match(auth, /applyPrintedListGuard\(request, chatGuarded\)/);
  assert.match(auth, /if \(await isPrintedListModeAuth\(result\)\) redirect\(fallbackPath\)/);
  assert.match(source("app/admin/chat/page.jsx"), /requireWhatsappAccessPage\(\)/);
  assert.match(source("app/chat-app/page.jsx"), /isPrintedListModeAuth\(auth\)/);
  assert.match(source("app/admin/prospeccao/page.jsx"), /PRINTED_LIST_MODE_MESSAGE/);
  assert.match(source("components/ProspectingConnectGate.jsx"), /Conectar WhatsApp/);
  assert.match(source("lib/daily-goal.js"), /printedListMode: !eligible && printedListMode/);
  assert.match(source("components/DailyGoalDashboard.jsx"), /goal\.printedListMode \? PRINTED_LIST_MODE_MESSAGE/);
  assert.match(source("lib/daily-goal-auto.js"), /printedListMode: restrictionsLoaded && isPrintedListMode\(/);
  assert.match(source("components/TeamDailyPerformance.jsx"), /PRINTED_LIST_MODE_LABEL/);
  // Lista de documentos: sem Chat no modo lista impressa (não cai no oficial/individual nem abre o aparelho sem restrição validada).
  assert.match(source("app/api/admin/clients/[id]/lista-documentos/route.js"), /reason: printedListMode \? "printed_list_mode"/);
  assert.match(source("components/clients/ClientSheet.jsx"), /reason === "printed_list_mode"/);
  for (const file of ["app/admin/layout.jsx", "components/AdminSectionNav.jsx"]) assert.match(source(file), /readChatHiddenForNav/);
  assert.match(PRINTED_LIST_MODE_MESSAGE, /modo lista impressa — peça sua lista à gestão\.$/);
});

test("nada apaga dado: o núcleo e a leitura não escrevem no banco", () => {
  const lib = source("lib/whatsapp-manual-disconnect.js");
  assert.doesNotMatch(lib, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(lib, /disconnectIndividualSession/);
});

// Caso Jennyfer (2026-10-17): o status que o MICROSSERVIÇO grava numa queda que ele mesmo reconecta (428/500/503/408 do
// Baileys, 515) precisa ser lido como TRANSIENT aqui — nunca modo lista impressa. Liga os dois lados de verdade.
async function serviceStatusAfterDrop(statusCode) {
  const notified = [];
  const controller = createReconnectController({ random: () => 0.5, setTimer: () => ({}), clearTimer: () => {} });
  const entry = { sock: null, status: "connected", qr: null, pairingCode: null, pairingMode: false, pairingError: null };
  const handleClose = createCloseHandler({
    userId: "u1", entry, controller,
    notifyStatus: async (_id, payload) => { notified.push(payload); },
    clearSessionCreds: async () => {},
    retireSocket: async () => {},
    scheduleRetry: () => {}
  });
  const sock = { authState: { creds: { registered: true, me: { id: "5511999999999:1@s.whatsapp.net" } } } };
  await handleClose({ sock, statusCode, errorMessage: "queda de teste" });
  return notified.at(-1);
}

test("queda que o serviço reconecta sozinho (428/500/503/408/515) = TRANSIENT, nunca modo lista impressa", async () => {
  for (const code of [428, 500, 503, 408, 515]) {
    const payload = await serviceStatusAfterDrop(code);
    assert.ok(["reconnecting", "connecting"].includes(payload.status), `código ${code}: ${payload.status}`);
    const rows = [{ slot: 1, status: payload.status, last_error: payload.error || null, last_disconnect_code: code, last_disconnect_at: "2026-10-17T06:43:14Z", last_connected_at: CONNECTED_AT }];
    assert.equal(classifyWhatsappDisconnect({ rows }), DISCONNECT_KIND.TRANSIENT, `código ${code}`);
    assert.equal(isPrintedListMode(broker(rows)), false, `código ${code}`);
    // Dois números: um caindo e o outro no ar = conectado.
    assert.equal(isPrintedListMode(broker([...rows, { slot: 2, status: "connected", last_connected_at: CONNECTED_AT }])), false);
  }
  // PRO-15 intacta: logout (401) continua tirando o Chat.
  const logout = await serviceStatusAfterDrop(401);
  assert.equal(logout.status, "disconnected");
  assert.equal(isPrintedListMode(broker([{ slot: 1, status: logout.status, last_error: logout.error, last_disconnect_code: 401, last_disconnect_at: "2026-10-17T06:43:14Z", last_connected_at: CONNECTED_AT }])), true);
});

test("Chat volta sozinho ao reconectar: menu/barra leem o valor vivo do provider (sem fechar o app)", () => {
  const provider = source("components/WhatsappAccessProvider.jsx");
  assert.match(provider, /\/api\/admin\/whatsapp-individual\/card-state/);
  assert.match(provider, /data\?\.printedListMode/);
  assert.match(provider, /visibilitychange/);
  assert.match(provider, /export function useLiveChatHidden/);
  for (const file of ["components/AdminBottomNav.jsx", "components/AdminMenu.jsx"]) assert.match(source(file), /useLiveChatHidden\(chatHiddenProp\)/, file);
  const layout = source("app/admin/layout.jsx");
  assert.match(layout, /liveCheck=\{auth\.ok && printedListModeAppliesTo\(/);
  // A barra inferior fica DENTRO do provider (senão não recebe o valor vivo).
  const open = layout.indexOf("<WhatsappAccessProvider");
  const close = layout.indexOf("</WhatsappAccessProvider>");
  const bar = layout.indexOf("<AdminBottomNav");
  assert.ok(open > -1 && open < bar && bar < close, "AdminBottomNav dentro do WhatsappAccessProvider");
  // card-state continua fora das APIs barradas pelo modo lista impressa (é por ela que o Chat volta).
  assert.equal(isPrintedListProtectedPath("/api/admin/whatsapp-individual/card-state"), false);
});
