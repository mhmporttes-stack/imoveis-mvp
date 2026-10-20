import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";
import { MAX_THREADS_PER_ROUND, decideChatTick, outboundResultBody, rememberPreviews, threadsToRead } from "../lib/chat-agenda.js";
import { decideTick, initialState } from "../lib/agenda.js";
import { fetchNextOutbound, postChatSync, postOutboundResult } from "../lib/crm-api.js";

const { MP } = globalThis;
const at = (hhmm) => new Date(`2026-10-20T${hhmm}:00-03:00`);

test("chat: horário do CRM, liga/desliga, pausa e uma automação por vez", () => {
  const settings = { syncEnabled: true, startHour: 7, endHour: 22 };
  assert.equal(decideChatTick({ state: initialState(), settings, now: at("06:59") }).reason, "chat_fora_do_horario");
  assert.equal(decideChatTick({ state: initialState(), settings, now: at("07:00") }).action, "sync");
  assert.equal(decideChatTick({ state: initialState(), settings, now: at("22:00") }).reason, "chat_fora_do_horario");
  assert.equal(decideChatTick({ state: initialState(), settings: { ...settings, syncEnabled: false }, now: at("10:00") }).reason, "chat_desligado");
  assert.equal(decideChatTick({ state: { ...initialState(), manualPause: true }, settings, now: at("10:00") }).reason, "pausado");
  assert.equal(decideChatTick({ state: { ...initialState(), running: { startedAt: at("09:58").toISOString() } }, settings, now: at("10:00") }).reason, "publicando");
  // E a publicação espera o chat terminar.
  assert.equal(decideTick({ ...initialState(), chatRunning: at("09:59").toISOString() }, at("10:00")).reason, "chat_em_andamento");
});

test("lê só conversas que mudaram, no máximo 5 por rodada", () => {
  const threads = Array.from({ length: 8 }, (_, i) => ({ threadKey: `t${i}`, preview: `oi ${i}`, unread: false }));
  const known = rememberPreviews({}, threads.slice(0, 6));
  assert.deepEqual(threadsToRead(threads, known).map((t) => t.threadKey), ["t6", "t7"]);
  assert.deepEqual(threadsToRead([{ ...threads[0], unread: true }], known).map((t) => t.threadKey), ["t0"]);
  assert.equal(threadsToRead(threads, {}).length, MAX_THREADS_PER_ROUND);
});

test("retorno do envio: nova tentativa só se nada saiu", () => {
  assert.deepEqual(outboundResultBody({ ok: true }), { status: "sent" });
  assert.equal(outboundResultBody({ ok: false, sentAttempted: false, error: "x" }).retry, true);
  assert.equal(outboundResultBody({ ok: false, sentAttempted: true, error: "x" }).retry, false);
  assert.equal(outboundResultBody({ ok: false, checkpoint: true }).retry, false);
});

test("selectors do chat: id da conversa, id estável da mensagem, lado pela geometria", () => {
  assert.equal(MP.parseThreadKey("/marketplace/t/123456789/"), "123456789");
  assert.equal(MP.parseThreadKey("https://www.facebook.com/messages/t/987/"), "987");
  assert.equal(MP.parseThreadKey("/marketplace/item/1/"), "");
  assert.equal(MP.messageExternalId("t1", "inbound", "Oi"), MP.messageExternalId("t1", "inbound", " oi "));
  assert.notEqual(MP.messageExternalId("t1", "inbound", "Oi", 0), MP.messageExternalId("t1", "inbound", "Oi", 1));
  assert.equal(MP.directionFromGeometry({ left: 600, right: 900 }, { left: 0, right: 1000 }), "outbound");
  assert.equal(MP.directionFromGeometry({ left: 20, right: 300 }, { left: 0, right: 1000 }), "inbound");
  const messages = MP.buildMessages("t1", [{ direction: "inbound", body: "Oi" }, { direction: "inbound", body: "Oi" }, { direction: "outbound", body: "Visto por João" }, { direction: "outbound", body: "Olá! Tudo bem?" }]);
  assert.equal(messages.length, 3);
  assert.notEqual(messages[0].externalId, messages[1].externalId);
});

test("crm-api do chat: rotas e chave", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const config = { baseUrl: "https://www.matheusmachadoimoveis.com.br", key: "mkp_x" };
  await postChatSync(config, [{ threadKey: "t1" }], fetchImpl);
  await fetchNextOutbound(config, fetchImpl);
  await postOutboundResult(config, "abc", { status: "sent" }, fetchImpl);
  assert.deepEqual(calls.map((c) => c.url.replace(config.baseUrl, "")), ["/api/marketplace/chat/sync", "/api/marketplace/chat/outbox/next", "/api/marketplace/chat/outbox/abc/result"]);
  assert.ok(calls.every((c) => c.options.headers.Authorization === "Bearer mkp_x"));
});

// --- inbox.js com DOM falso ---------------------------------------------------------------------------------------
function el({ tag = "div", text = "", href = "", attrs = {}, rect = { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }, children = [], html = "" } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    innerText: text,
    innerHTML: html || text,
    href,
    src: attrs.src || "",
    naturalWidth: attrs.naturalWidth || 0,
    getAttribute: (name) => (name === "href" ? href : attrs[name] ?? null),
    getBoundingClientRect: () => rect,
    querySelector: (sel) => node.querySelectorAll(sel)[0] || null,
    querySelectorAll: (sel) => children.filter((child) => child.matches(sel)),
    matches: (sel) => sel.split(",").some((part) => (attrs.match || []).includes(part.trim()) || part.trim() === tag),
    scrollIntoView() {}
  };
  return node;
}

async function loadInbox(doc) {
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: "https://www.facebook.com/marketplace/inbox/", origin: "https://www.facebook.com" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  const code = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  new Function(code)();
  return (message) => new Promise((resolve) => listeners[0](message, {}, resolve));
}

test("inbox.js (DOM falso): lista só as conversas da caixa do Marketplace", async () => {
  const links = [
    el({ tag: "a", href: "/marketplace/t/111/", text: "Ana Souza · Casa com piscina\nAinda está disponível?", attrs: { match: ['a[href*="/marketplace/t/"]'] }, html: '<span style="font-weight: 700">Ana</span>' }),
    el({ tag: "a", href: "/marketplace/t/111/", text: "duplicado", attrs: { match: ['a[href*="/marketplace/t/"]'] } }),
    el({ tag: "a", href: "/marketplace/t/222/", text: "Bruno · Apartamento Centro\nObrigado", attrs: { match: ['a[href*="/marketplace/t/"]'] } })
  ];
  const doc = { body: { innerText: "Caixa de entrada do Marketplace" }, querySelector: (sel) => (sel.includes("/marketplace/t/") ? links[0] : null), querySelectorAll: (sel) => (sel.includes("/marketplace/t/") ? links : []) };
  const send = await loadInbox(doc);
  const result = await send({ type: "mp-inbox-list" });
  assert.equal(result.checkpoint, false);
  assert.deepEqual(result.threads.map((t) => [t.threadKey, t.contactName, t.listingTitle, t.preview, t.unread]), [
    ["111", "Ana Souza", "Casa com piscina", "Ainda está disponível?", true],
    ["222", "Bruno", "Apartamento Centro", "Obrigado", false]
  ]);
  assert.equal(result.threads[0].threadUrl, "https://www.facebook.com/marketplace/t/111/");
});

test("inbox.js (DOM falso): lê as mensagens com o lado certo", async () => {
  const textNode = (text, left, right) => el({ text, rect: { left, right, top: 0, bottom: 20, width: right - left, height: 20 }, attrs: { match: ['div[dir="auto"]'] } });
  const rows = [
    el({ attrs: { match: ['[role="row"]'] }, children: [textNode("Olá, ainda está disponível?", 20, 300)] }),
    el({ attrs: { match: ['[role="row"]'] }, children: [textNode("Está sim! Quer agendar uma visita?", 600, 950)] })
  ];
  const area = el({ attrs: { match: ['[role="main"]'] }, rect: { left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 }, children: rows });
  area.querySelectorAll = (sel) => (sel.includes('[role="row"]') ? rows : []);
  const doc = { body: { innerText: "" }, querySelector: (sel) => (sel.includes('[role="main"]') ? area : null), querySelectorAll: () => [] };
  const send = await loadInbox(doc);
  const result = await send({ type: "mp-inbox-read", threadKey: "111" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages.map((m) => [m.direction, m.body]), [["inbound", "Olá, ainda está disponível?"], ["outbound", "Está sim! Quer agendar uma visita?"]]);
});

test("inbox.js nunca envia com evento simulado (sem depurador = não envia)", () => {
  const code = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  assert.match(code, /Depurador desligado: não envio com eventos simulados/);
  assert.match(code, /MP\.inbox\.threadLinks/);
  assert.doesNotMatch(code, /messages\/t\/["'`]\s*\)/, "não abre a lista geral do Messenger");
});

test("1ª vez que vê a conversa: lê o histórico inteiro (full); depois só incremental", () => {
  const threads = [{ threadKey: "a", preview: "oi", unread: false }, { threadKey: "b", preview: "novo", unread: false }];
  const read = threadsToRead(threads, { a: "antigo" });
  assert.deepEqual(read.map((t) => [t.threadKey, t.full]), [["a", false], ["b", true]]);
});

test("hora da última atividade pelo rótulo da caixa", () => {
  const now = new Date("2026-10-20T15:00:00Z");
  assert.equal(MP.parseRelativeTime("agora", now), now.toISOString());
  assert.equal(MP.parseRelativeTime("5 min", now), "2026-10-20T14:55:00.000Z");
  assert.equal(MP.parseRelativeTime("2 h", now), "2026-10-20T13:00:00.000Z");
  assert.equal(MP.parseRelativeTime("3 d", now), "2026-10-17T15:00:00.000Z");
  assert.equal(MP.parseRelativeTime("1 sem", now), "2026-10-13T15:00:00.000Z");
  assert.equal(MP.parseRelativeTime("10:32", now), "2026-10-20T13:32:00.000Z");
  assert.equal(MP.parseRelativeTime("Ana Souza", now), null);
});

test("junta as janelas da rolagem sem repetir a sobreposição", () => {
  const r = (direction, body) => ({ direction, body, attachments: [] });
  const merged = MP.mergeRowWindows([r("inbound", "Oi"), r("outbound", "Olá"), r("inbound", "Tem garagem?")], [r("outbound", "Olá"), r("inbound", "Tem garagem?"), r("outbound", "Tem sim"), r("inbound", "ok")]);
  assert.deepEqual(merged.map((m) => m.body), ["Oi", "Olá", "Tem garagem?", "Tem sim", "ok"]);
  assert.deepEqual(MP.mergeRowWindows([], [r("inbound", "a")]).map((m) => m.body), ["a"]);
});

test("popup mostra o diagnóstico do chat (última sincronização, conversas, erro)", () => {
  const popup = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  assert.match(popup, /Chat — última sincronização/);
  assert.match(popup, /Chat — conversas/);
  assert.match(popup, /Chat — erro/);
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /full: thread\.full === true/);
  assert.match(bg, /lastActivityAt: thread\.lastActivityAt/);
});
