import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_POPUP_KIND,
  CLIENT_POPUP_LOOKBACK_MS,
  buildClientPopup,
  clientPopupHref,
  clientPopupReceiverIds,
  clientPopupWindowStart
} from "../lib/client-popup-core.mjs";
import {
  CLIENT_POPUP_AUTO_DISMISS_MS,
  CLIENT_POPUP_SEEN_TTL_MS,
  addClientPopupSeen,
  advanceClientPopupTimers,
  clientPopupAge,
  clientPopupDetail,
  mergeClientPopups,
  overflowClientPopupKeys,
  parseClientPopupSeen,
  serializeClientPopupSeen,
  visibleClientPopups
} from "../lib/client-popup-view-core.mjs";

// Janelinha de cliente novo (REGRA OFICIAL — dono, 2026-10-24, CLI-16).

const NOW = Date.parse("2026-10-24T15:00:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const BROKER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CLIENT = "33333333-3333-3333-3333-333333333333";
const CONVERSATION = "44444444-4444-4444-4444-444444444444";
const FROM = clientPopupWindowStart("", NOW);

function registration(extra = {}) {
  return {
    id: CLIENT,
    full_name: "Ana Souza",
    created_at: iso(30),
    status: "pending",
    responsible_user_id: BROKER,
    pending_distribution_at: null,
    private_contact_at: null,
    direct_broker_link: false,
    distribution_type: "round_robin",
    acquisition_context: { kind: "roulette_link", label: "Link da roleta", actor: "sistema" },
    prospecting_contact_id: null,
    ...extra
  };
}

function popup(extra = {}) {
  return buildClientPopup({ fromIso: FROM, receiverIds: [BROKER], viewerEmail: "corretor@exemplo.com", now: NOW, ...extra });
}

test("escopo no servidor: cada um só os dele; associado também os do corretor vinculado; Alterar conta nenhum", () => {
  assert.deepEqual(clientPopupReceiverIds({ profileId: BROKER, role: "broker" }), [BROKER]);
  // Gestor e admin seguem o escopo privado das notificações (AUT-9): nunca os da equipe.
  assert.deepEqual(clientPopupReceiverIds({ profileId: BROKER, role: "manager" }), [BROKER]);
  assert.deepEqual(clientPopupReceiverIds({ profileId: BROKER, role: "admin" }), [BROKER]);
  assert.deepEqual(clientPopupReceiverIds({ profileId: OTHER, role: "associate", linkedBrokerId: BROKER }), [OTHER, BROKER]);
  assert.deepEqual(clientPopupReceiverIds({ profileId: BROKER, role: "broker", linkedBrokerId: OTHER }), [BROKER]);
  assert.deepEqual(clientPopupReceiverIds({ profileId: BROKER, role: "admin", accountSwitchMode: true }), []);
  assert.deepEqual(clientPopupReceiverIds({}), []);
});

test("janela: abrir a tela lê só as últimas 12 h; depois, desde o cursor (menos 1 min)", () => {
  assert.equal(clientPopupWindowStart("", NOW), new Date(NOW - CLIENT_POPUP_LOOKBACK_MS).toISOString());
  assert.equal(clientPopupWindowStart(iso(1), NOW), iso(2));
  assert.equal(clientPopupWindowStart(iso(13 * 60), NOW), new Date(NOW - CLIENT_POPUP_LOOKBACK_MS).toISOString());
  assert.equal(clientPopupWindowStart("lixo", NOW), new Date(NOW - CLIENT_POPUP_LOOKBACK_MS).toISOString());
});

test("cliente novo da roleta vira janelinha que abre a ficha", () => {
  const item = popup({ registration: registration(), steps: [{ userId: BROKER, at: iso(5) }] });
  assert.equal(item.kind, CLIENT_POPUP_KIND.NEW);
  assert.equal(item.clientName, "Ana Souza");
  assert.equal(item.origin, "Link da roleta");
  assert.equal(item.at, iso(5));
  assert.equal(item.href, `/admin/simulacoes?clientId=${CLIENT}`);
  assert.equal(item.fromUserId, "");
});

test("cliente de outro corretor nunca vira janelinha (escopo)", () => {
  assert.equal(popup({ registration: registration({ responsible_user_id: OTHER }), steps: [{ userId: OTHER, at: iso(5) }] }), null);
  // o último passo precisa ser o responsável atual (já mudou de novo = não é mais dele)
  assert.equal(popup({ registration: registration(), steps: [{ userId: BROKER, at: iso(9) }, { userId: OTHER, at: iso(5) }] }), null);
});

test("transferido (inclusive fila de reativação) mostra de quem veio; atendimento do anterior não conta", () => {
  const steps = [{ userId: OTHER, at: iso(600) }, { userId: BROKER, at: iso(3) }];
  const item = popup({ registration: registration({ created_at: iso(5000) }), steps, lastAttendanceAt: iso(100) });
  assert.equal(item.kind, CLIENT_POPUP_KIND.TRANSFER);
  assert.equal(item.fromUserId, OTHER);
  assert.equal(clientPopupDetail({ ...item, fromName: "Jennyfer" }), "Transferido de Jennyfer");
  // Prospecção que esfriou e foi transferida (FUN-15l) também aparece.
  assert.ok(popup({ registration: registration({ created_at: iso(5000), prospecting_contact_id: "x" }), steps }));
});

test("atendido depois de recebido não aparece (nem ao abrir a página depois)", () => {
  const steps = [{ userId: BROKER, at: iso(20) }];
  assert.equal(popup({ registration: registration(), steps, lastAttendanceAt: iso(10) }), null);
  // efeito do próprio cadastro (segundos depois) não conta como atendimento
  assert.ok(popup({ registration: registration(), steps, lastAttendanceAt: new Date(NOW - 20 * 60000 + 10000).toISOString() }));
});

test("cadastro manual feito por outra pessoa aparece; o que ele mesmo cadastrou e a Prospecção não", () => {
  const manual = registration({ acquisition_context: { kind: "manual", label: "Cadastro manual — Carol", actor: "carol@exemplo.com" } });
  assert.equal(popup({ registration: manual, steps: [] }).kind, CLIENT_POPUP_KIND.NEW);
  const own = registration({ acquisition_context: { kind: "manual", label: "Cadastro manual — Eu", actor: "Corretor@Exemplo.com" } });
  assert.equal(popup({ registration: own, steps: [] }), null);
  assert.equal(popup({ registration: registration({ prospecting_contact_id: "c1" }), steps: [] }), null);
});

test("fora das últimas 12 h não aparece", () => {
  assert.equal(popup({ registration: registration({ created_at: iso(13 * 60) }), steps: [{ userId: BROKER, at: iso(13 * 60) }] }), null);
  assert.equal(popup({ registration: registration({ created_at: iso(13 * 60) }), steps: [] }), null);
});

test("destino do clique: WhatsApp → Chat da conversa; Messenger → conversa do Marketplace; resto → ficha", () => {
  const whatsapp = popup({ registration: registration({ acquisition_context: { kind: "whatsapp_organic", label: "WhatsApp — Contato direto" } }), steps: [{ userId: BROKER, at: iso(2) }] });
  assert.equal(whatsapp.href, `/admin/chat?client=${CLIENT}`);
  const messenger = popup({ registration: registration({ acquisition_context: { kind: "facebook_marketplace", label: "Facebook Marketplace — Casa" } }), steps: [{ userId: OTHER, at: iso(20) }, { userId: BROKER, at: iso(2) }], conversationId: CONVERSATION });
  assert.equal(messenger.kind, CLIENT_POPUP_KIND.MESSENGER);
  assert.equal(messenger.href, `/admin/chat/marketplace?conversa=${CONVERSATION}`);
  assert.equal(clientPopupHref({ kind: "messenger" }), "/admin/chat/marketplace");
  assert.equal(clientPopupHref({ kind: "new", clientId: "nada" }), "/admin/simulacoes");
});

test("cada recebimento tem a sua chave: transferido de novo mais tarde volta a aparecer", () => {
  const first = popup({ registration: registration(), steps: [{ userId: BROKER, at: iso(50) }] });
  const second = popup({ registration: registration(), steps: [{ userId: BROKER, at: iso(50) }, { userId: OTHER, at: iso(40) }, { userId: BROKER, at: iso(5) }] });
  assert.notEqual(first.key, second.key);
});

test("tela: junta sem repetir, tira os vistos e põe o mais novo em cima", () => {
  const a = { key: "a", at: iso(10) };
  const b = { key: "b", at: iso(2) };
  const c = { key: "c", at: iso(5) };
  assert.deepEqual(mergeClientPopups([a], [a, b, c], new Set(["c"])).map((item) => item.key), ["b", "a"]);
});

test("tela: no máximo 3 + resumo; com a tela cheia do Henry nada aparece e a fila volta quando fecha", () => {
  const items = ["1", "2", "3", "4", "5"].map((key) => ({ key }));
  const shown = visibleClientPopups(items);
  assert.deepEqual(shown.visible.map((item) => item.key), ["1", "2", "3"]);
  assert.equal(shown.extra, 2);
  assert.deepEqual(visibleClientPopups(items, { henryOpen: true }), { visible: [], extra: 0 });
  assert.equal(visibleClientPopups(items, { henryOpen: false }).visible.length, 3);
});

test("saída sozinha (dono, 2026-10-29): ~7 s de tela, pausa não gasta tempo, quem sai da tela esquece o tempo", () => {
  assert.ok(CLIENT_POPUP_AUTO_DISMISS_MS >= 6000 && CLIENT_POPUP_AUTO_DISMISS_MS <= 8000);
  let state = advanceClientPopupTimers(new Map(), ["a", "b"], 4000);
  assert.deepEqual(state.expired, []);
  // pausada (mouse/toque em cima, aba oculta): o tempo não anda
  state = advanceClientPopupTimers(state.elapsed, ["a", "b"], 60000, { paused: true });
  assert.deepEqual(state.expired, []);
  assert.equal(state.elapsed.get("a"), 4000);
  // "c" chegou agora: conta do zero; "b" saiu da tela e esquece
  state = advanceClientPopupTimers(state.elapsed, ["c", "a"], CLIENT_POPUP_AUTO_DISMISS_MS - 4000);
  assert.deepEqual(state.expired, ["a"]);
  assert.deepEqual([...state.elapsed.keys()], ["c"]);
  assert.deepEqual(advanceClientPopupTimers(new Map(), ["x"], Number.NaN).expired, []);
});

test("excedentes vão só para o sino: além das 3 viram vistas na hora e não voltam no próximo ciclo; Henry aberto não descarta", () => {
  const items = ["1", "2", "3", "4", "5"].map((key, index) => ({ key, at: iso(index) }));
  const overflow = overflowClientPopupKeys(items);
  assert.deepEqual(overflow, ["4", "5"]);
  assert.deepEqual(overflowClientPopupKeys(items, { henryOpen: true }), []);
  assert.deepEqual(overflowClientPopupKeys(items.slice(0, 3)), []);
  // expirou/excedeu = "visto" no aparelho: o mesmo item no polling seguinte não reaparece
  const seen = addClientPopupSeen(new Map(), [...overflow, "1"], NOW);
  const next = mergeClientPopups(items.slice(1, 3), items, new Set(seen.keys()));
  assert.deepEqual(next.map((item) => item.key), ["2", "3"]);
});

test("visto: guarda, sobrevive ao recarregar, tolera lixo e expira em 24 h", () => {
  const seen = addClientPopupSeen(new Map(), ["a", "b"], NOW);
  const reloaded = parseClientPopupSeen(serializeClientPopupSeen(seen), NOW + 1000);
  assert.ok(reloaded.has("a") && reloaded.has("b"));
  assert.equal(parseClientPopupSeen(serializeClientPopupSeen(seen), NOW + CLIENT_POPUP_SEEN_TTL_MS + 1).size, 0);
  assert.equal(parseClientPopupSeen("{quebrado", NOW).size, 0);
  assert.equal(parseClientPopupSeen("[1,2]", NOW).size, 0);
  assert.deepEqual(mergeClientPopups([], [{ key: "a", at: iso(1) }], new Set(reloaded.keys())), []);
});

test("há quanto tempo", () => {
  assert.equal(clientPopupAge(iso(0), NOW), "agora");
  assert.equal(clientPopupAge(iso(7), NOW), "há 7 min");
  assert.equal(clientPopupAge(iso(130), NOW), "há 2 h");
  assert.equal(clientPopupAge(iso(60 * 25), NOW), "há 1 dia");
  assert.equal(clientPopupDetail({ kind: "new", origin: "Link da roleta" }), "Link da roleta");
});

test("ligações: guard no servidor, mesmo ciclo do som, pausa oculta, Henry, fora de Alterar conta", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const route = read("app/api/crm-notifications/new-client-alerts/route.js");
  assert.ok(route.indexOf("requireAdminApi(request)") < route.indexOf("= readPopups(auth, params)"));
  const listener = read("components/NewClientSoundListener.jsx");
  assert.match(listener, /hasClientPopupConsumer\(\) && !isPageHidden\(\)/);
  assert.match(listener, /setInterval\(poll, POLL_INTERVAL_MS\)/);
  const stack = read("components/client-popups/ClientPopupStack.jsx");
  assert.match(stack, /useHenryFullscreen\(/);
  assert.match(stack, /visibleClientPopups\(items, \{ henryOpen \}\)/);
  assert.match(stack, /addEventListener\("click", onClick, true\)/);
  assert.match(stack, /advanceClientPopupTimers\(/);
  assert.match(stack, /overflowClientPopupKeys\(items, \{ henryOpen \}\)/);
  assert.match(stack, /document\.visibilityState === "hidden"/);
  assert.doesNotMatch(stack, /crm-notifications\/.*read|markRead/);
  assert.doesNotMatch(stack, /setInterval\(\(\) => fetch|fetch\(/);
  const layout = read("app/admin/layout.jsx");
  assert.match(layout, /clientPopups=\{auth\.accountSwitchMode \? null :/);
  const server = read("lib/client-popups.js");
  assert.match(server, /accountSwitchMode: Boolean\(auth\?\.accountSwitchMode\)/);
});
