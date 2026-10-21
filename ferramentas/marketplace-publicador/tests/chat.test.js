import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";
import { CHAT_LOCK_MAX_MS, CHAT_LOCK_TTL_MS, MAX_THREADS_PER_ROUND, chatLockAlive, decideChatTick, describeChatLock, outboundResultBody, rememberPreviews, threadsToRead } from "../lib/chat-agenda.js";
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
  assert.equal(decideTick(initialState(), at("10:00"), { chatBusy: true }).reason, "chat_em_andamento");
  // A trava antiga (state.chatRunning, 1.8.6) não segura mais nada.
  assert.notEqual(decideTick({ ...initialState(), chatRunning: at("09:59").toISOString() }, at("10:00")).reason, "chat_em_andamento");
});

test("1.8.7: trava do chat com dono e prazo — nunca fica presa", () => {
  const settings = { syncEnabled: true, startHour: 7, endHour: 22 };
  const now = at("10:00");
  const lock = { token: "x", instance: "w1", startedAt: at("09:59").toISOString(), heartbeatAt: at("09:59").toISOString(), step: "lendo a caixa do Marketplace" };
  // Viva: mesmo worker, batimento recente.
  assert.equal(chatLockAlive(lock, { now, instance: "w1" }), true);
  assert.equal(decideChatTick({ state: initialState(), settings, now, lock, instance: "w1" }).reason, "chat_em_andamento");
  // Worker que criou a trava morreu (o Chrome encerrou o worker no meio da rodada): morta na hora.
  assert.equal(chatLockAlive(lock, { now, instance: "w2" }), false);
  assert.equal(decideChatTick({ state: initialState(), settings, now, lock, instance: "w2" }).action, "sync");
  // Sem batimento há mais de 4 min: morta.
  const silent = { ...lock, startedAt: at("09:50").toISOString(), heartbeatAt: new Date(now.getTime() - CHAT_LOCK_TTL_MS - 1000).toISOString() };
  assert.equal(chatLockAlive(silent, { now, instance: "w1" }), false);
  // Rodada longa demais no total: morta mesmo com batimento.
  const tooLong = { ...lock, startedAt: new Date(now.getTime() - CHAT_LOCK_MAX_MS - 1000).toISOString(), heartbeatAt: now.toISOString() };
  assert.equal(chatLockAlive(tooLong, { now, instance: "w1" }), false);
  // Sem trava / trava vazia.
  assert.equal(chatLockAlive(null, { now }), false);
  assert.equal(chatLockAlive({}, { now }), false);
  // Popup: etapa e há quanto tempo.
  assert.match(describeChatLock({ ...lock, stepAt: at("09:59").toISOString() }, now), /^lendo a caixa do Marketplace há 60 s/);
  assert.equal(describeChatLock(null, now), "");
});

test("1.8.7: background — trava em chatLock com finally, envio incremental, limite por rodada e Destravar", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /chatRunning:\s*new Date/, "a trava antiga em state.chatRunning não pode voltar");
  assert.match(source, /finally \{\s*round\.stop\(\);/);
  assert.match(source, /if \(stored\?\.token === token\) await chrome\.storage\.local\.remove\("chatLock"\)/);
  assert.match(source, /postChatSync\(config, \[conversation\]\)/, "cada conversa vai ao CRM logo depois de lida");
  assert.match(source, /round\.elapsed\(\) > ROUND_BUDGET_MS/);
  assert.match(source, /"mp-chat-unlock"/);
  const popup = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
  assert.match(popup, /id="unlock"[^>]*>Destravar sincronização</);
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.8.11");
});

test("lê só conversas que mudaram, no máximo 5 por rodada", () => {
  const threads = Array.from({ length: 8 }, (_, i) => ({ threadKey: `t${i}`, preview: `oi ${i}`, unread: false }));
  const known = rememberPreviews({}, threads.slice(0, 6));
  assert.deepEqual(threadsToRead(threads, known).map((t) => t.threadKey), ["t6", "t7"]);
  assert.deepEqual(threadsToRead([{ ...threads[0], unread: true }], known).map((t) => t.threadKey), ["t0"]);
  assert.equal(threadsToRead(threads, {}).length, MAX_THREADS_PER_ROUND);
  // Conversas nunca vistas: histórico completo, no máximo 5 por rodada; as demais ficam para a próxima.
  assert.ok(threadsToRead(threads, {}).every((t) => t.full));
  const afterFirst = rememberPreviews({}, threadsToRead(threads, {}));
  assert.deepEqual(threadsToRead(threads, afterFirst).map((t) => t.threadKey), ["t5", "t6", "t7"]);
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
  globalThis.location = { href: "https://www.facebook.com/marketplace/inbox/", origin: "https://www.facebook.com", pathname: "/marketplace/inbox/" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  const code = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  new Function(code)();
  return (message) => new Promise((resolve) => listeners[0](message, {}, resolve));
}

test("inbox.js (DOM falso): lista só as conversas da caixa do Marketplace", async () => {
  const links = [
    el({ tag: "a", href: "/marketplace/t/111/", text: "Ana Souza · Casa com piscina\nAinda está disponível?", attrs: { match: ['a[role="link"]'] }, html: '<span style="font-weight: 700">Ana</span>' }),
    el({ tag: "a", href: "/marketplace/t/111/", text: "duplicado", attrs: { match: ['a[role="link"]'] } }),
    el({ tag: "a", href: "/marketplace/t/222/", text: "Bruno · Apartamento Centro\nObrigado", attrs: { match: ['a[role="link"]'] } })
  ];
  const doc = { body: { innerText: "Caixa de entrada do Marketplace" }, querySelector: (sel) => (sel.includes('a[role="link"]') ? links[0] : null), querySelectorAll: (sel) => (sel.includes('a[role="link"]') ? links : []) };
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
  assert.match(code, /MP\.inbox\.listItems/);
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

// --- Caminho real (prints do dono, 2026-10-20): Messenger → "Marketplace" → "Nome · Anúncio" ----------------------
test("item da caixa do Marketplace: nome, anúncio, prévia/remetente e hora", () => {
  assert.deepEqual(MP.parseInboxItem(["Stephanie · 2 quartos 1 banheiro Apar…", "Stephanie: Essas unidades são para… · 6 min"]), { contactName: "Stephanie", listingTitle: "2 quartos 1 banheiro Apar…", preview: "Stephanie: Essas unidades são para…", previewDirection: "inbound", timeLabel: "6 min" });
  assert.deepEqual(MP.parseInboxItem(["Tânia · Casa com piscina", "Você: Olá Tânia, bom dia…", "1h"]), { contactName: "Tânia", listingTitle: "Casa com piscina", preview: "Você: Olá Tânia, bom dia…", previewDirection: "outbound", timeLabel: "1h" });
  assert.equal(MP.parseInboxItem(["Ana Paula", "Oi, tudo bem? · 2 h"]), null, "conversa pessoal nunca é item do Marketplace");
  assert.equal(MP.parseInboxItem(["Marketplace", "1 nova mensagem · 6 min"]), null, "a entrada 'Marketplace' não é conversa");
  assert.equal(MP.itemKey("Stephanie", "2 quartos"), MP.itemKey("Stephanie", "2 quartos"));
  assert.match(MP.itemKey("Stephanie", "2 quartos"), /^n[0-9a-f]+$/);
});

function fakeNode({ role = "", tag = "div", text = "", label = "", href = "", children = [], onClick = null, hidden = () => false, rect = null, dir = "" } = {}) {
  const node = {
    tag, role, children, href,
    get innerText() { return text || children.filter((c) => !c.isHidden()).map((c) => c.innerText).join("\n"); },
    innerHTML: "",
    isHidden: hidden,
    getAttribute: (name) => (name === "aria-label" ? label || null : name === "href" ? href || null : name === "role" ? role || null : null),
    getBoundingClientRect: () => (hidden() ? { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } : rect || { left: 0, right: 300, top: 0, bottom: 40, width: 300, height: 40 }),
    scrollIntoView() {},
    click() { onClick?.(); },
    matches(selector) {
      return selector.split(",").some((raw) => {
        const part = raw.trim().split(/\s+/).pop();
        const roleMatch = part.match(/\[role="([^"]+)"\]/);
        if (roleMatch) return role === roleMatch[1] && (!part.startsWith("a") || tag === "a");
        if (part === "a[href]") return tag === "a" && Boolean(href);
        if (part === 'div[dir="auto"]') return tag === "div" && dir === "auto";
        if (part === "[aria-label]") return Boolean(label);
        return part === tag;
      });
    },
    all() { return children.filter((c) => !c.isHidden()).flatMap((c) => [c, ...c.all()]); },
    contains(other) { return node === other || node.all().includes(other); },
    closest() { return null; },
    querySelectorAll(selector) { return node.all().filter((c) => c.matches(selector)); },
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; }
  };
  for (const child of children) child.parentElement = node;
  return node;
}

test("inbox.js (fixture do print): abre Messenger → Marketplace e lê SÓ as conversas do Marketplace", async () => {
  const state = { popover: false, marketplace: false };
  const items = [
    fakeNode({ role: "row", text: "Stephanie · 2 quartos 1 banheiro Apar…\nStephanie: Essas unidades são para… · 6 min" }),
    fakeNode({ role: "row", text: "Tânia · Casa com piscina\nVocê: Olá Tânia, bom dia… · 1h" })
  ];
  const marketplacePanel = fakeNode({ role: "dialog", children: [fakeNode({ text: "Marketplace" }), ...items], hidden: () => !state.marketplace });
  const popover = fakeNode({ role: "dialog", hidden: () => !state.popover || state.marketplace, children: [
    fakeNode({ text: "Conversas" }),
    fakeNode({ text: "O histórico de conversa está faltando — Insira seu PIN para restaurar" }),
    fakeNode({ role: "row", text: "Marketplace\n1 nova mensagem · 6 min", onClick: () => { state.marketplace = true; } }),
    fakeNode({ role: "row", text: "Ana Paula\nOi, tudo bem? · 2 h" }),
    fakeNode({ role: "row", text: "Adriana · Grupo família\nAdriana: oi · 3 h", hidden: () => true })
  ] });
  const messengerButton = fakeNode({ role: "button", label: "Messenger", onClick: () => { state.popover = true; } });
  const body = fakeNode({ children: [messengerButton, popover, marketplacePanel] });
  const doc = { body: { innerText: "" }, querySelectorAll: (sel) => body.querySelectorAll(sel), querySelector: (sel) => body.querySelector(sel) };
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: "https://www.facebook.com/", origin: "https://www.facebook.com", pathname: "/" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  new Function(readFileSync(new URL("../inbox.js", import.meta.url), "utf8"))();
  const result = await new Promise((resolve) => listeners[0]({ type: "mp-inbox-list" }, {}, resolve));
  assert.deepEqual(result.threads.map((t) => [t.contactName, t.listingTitle, t.preview]), [
    ["Stephanie", "2 quartos 1 banheiro Apar…", "Stephanie: Essas unidades são para…"],
    ["Tânia", "Casa com piscina", "Você: Olá Tânia, bom dia…"]
  ]);
  assert.ok(result.threads.every((t) => /^n[0-9a-f]+$/.test(t.threadKey) && t.threadUrl === ""));
  assert.match(result.steps.join(" | "), /abriu Messenger → Marketplace/);
  assert.ok(!result.threads.some((t) => /Ana Paula|Adriana/.test(t.contactName)), "conversas pessoais nunca entram");
});

test("conversa criptografada sem mensagens: erro claro do PIN", () => {
  const code = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  assert.match(code, /Restaure o histórico com o PIN do Messenger/);
  assert.ok(MP.matchesAny("O histórico de conversa está faltando. Insira seu PIN para restaurar", MP.inbox.pinTexts));
});

test("janela de chat flutuante (print do dono): lê as bolhas com lado e hora, ignora nome/faixa do anúncio e fecha a janela", async () => {
  const state = { open: true };
  const bubble = (text, left, right) => fakeNode({ role: "row", children: [fakeNode({ dir: "auto", text, rect: { left, right, top: 0, bottom: 20, width: right - left, height: 20 } })] });
  const win = fakeNode({ role: "dialog", label: "Stephanie", rect: { left: 0, right: 330, top: 0, bottom: 450, width: 330, height: 450 }, hidden: () => !state.open, children: [
    fakeNode({ text: "Stephanie · 2 quartos 1 ba…" }),
    fakeNode({ role: "button", label: "Fechar chat", onClick: () => { state.open = false; } }),
    fakeNode({ text: "Marketplace\nR$870 - 2 quartos 1 banheiro Apartamento\nMark as pending\nMore options" }),
    bubble("12:23", 140, 190),
    bubble("Stephanie", 40, 110),
    bubble("Oi, ainda está disponível?", 40, 200),
    bubble("Está sim! Quer agendar uma visita?", 160, 320),
    fakeNode({ role: "textbox", label: "Aa" })
  ] });
  // O campo "Aa" precisa casar com [role="textbox"][contenteditable="true"] (fakeNode compara só o role).
  const body = fakeNode({ children: [win] });
  const doc = { body: { innerText: "" }, querySelectorAll: (sel) => body.querySelectorAll(sel), querySelector: (sel) => body.querySelector(sel) };
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: "https://www.facebook.com/", origin: "https://www.facebook.com", pathname: "/" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  new Function(readFileSync(new URL("../inbox.js", import.meta.url), "utf8"))();
  const result = await new Promise((resolve) => listeners[0]({ type: "mp-inbox-read", threadKey: "n1", contactName: "Stephanie" }, {}, resolve));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.messages.map((m) => [m.direction, m.body]), [["inbound", "Oi, ainda está disponível?"], ["outbound", "Está sim! Quer agendar uma visita?"]]);
  assert.ok(result.messages.every((m) => /T15:23:00\.000Z$/.test(m.at)), "hora do separador 12:23 (São Paulo)");
  assert.equal(state.open, false, "fecha a janela depois de ler");
});

test("separador de hora da conversa", () => {
  const now = new Date("2026-10-20T18:00:00Z");
  assert.equal(MP.parseClockSeparator("12:23", now), "2026-10-20T15:23:00.000Z");
  assert.equal(MP.parseClockSeparator("Ontem 08:10", now), "2026-10-19T11:10:00.000Z");
  assert.equal(MP.parseClockSeparator("Está sim! 12:23", now), null);
});

test("1.8.3/1.8.4: nunca injeta fora do Facebook e lista pela página /marketplace/inbox primeiro", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /if \(!String\(url \|\| ""\)\.startsWith\(FB_PREFIX\)\) return Promise\.reject/);
  assert.match(bg, /A aba dedicada não está no Facebook/);
  assert.doesNotMatch(bg, /files: \["selectors\.js", "inbox\.js"\] \}\);\n\s+return sendWithTimeout\(tabId, \{ type: "mp-inbox-list"/, "injeção do leitor passa pela checagem");
  assert.equal((bg.match(/chrome\.scripting\.executeScript\(\{ target: \{ tabId \}, files: \["selectors\.js", "inbox\.js"\] \}\)/g) || []).length, 1, "um único ponto de injeção do leitor (com checagem)");
  const inbox = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  const list = inbox.slice(inbox.indexOf("async function listThreads("));
  // 1.8.4: a página /marketplace/inbox funciona (print do dono) e vem primeiro; Messenger é a reserva.
  assert.ok(list.indexOf('startsWith("/marketplace/inbox")') < list.indexOf("openMarketplaceFromMessenger(steps)"));
  assert.match(inbox, /async function collectAll\(root, steps, label\)/);
});

test("página /marketplace/inbox (print do dono, 1.8.4): cada conversa é o bloco miniatura + 'Nome · Anúncio', nunca o contêiner", async () => {
  const thumb = () => fakeNode({ tag: "img", rect: { left: 20, right: 80, top: 0, bottom: 60, width: 60, height: 60 } });
  const item = (title, preview) => fakeNode({ children: [thumb(), fakeNode({ children: [fakeNode({ text: title }), fakeNode({ text: preview })] })] });
  const items = [
    item("Stephanie · 2 quartos 1 banheiro Apartamento", "Essas unidades são para…"),
    item("Tânia · Casa com piscina e 3 suítes", "Você: Olá Tânia, bom dia…"),
    item("Joao · Apartamento Centro", "Joao, esse imóvel está disponível para venda."),
    item("Giovanna · 2 quartos 1 banheiro Apartamento", "Giovanna: … seu classificado: 2 quart…"),
    item("Carla · Terreno Jardim", "Oi"),
    item("Pedro · Casa Palmital", "Ainda disponível?"),
    item("Rita · Apartamento Fragata", "Obrigada")
  ];
  const list = fakeNode({ role: "main", children: [fakeNode({ text: "Venda" }), fakeNode({ text: "Compra" }), ...items] });
  const body = fakeNode({ children: [list] });
  const doc = { body: { innerText: "" }, querySelectorAll: (sel) => body.querySelectorAll(sel), querySelector: (sel) => body.querySelector(sel) };
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: "https://www.facebook.com/marketplace/inbox/", origin: "https://www.facebook.com", pathname: "/marketplace/inbox/" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  new Function(readFileSync(new URL("../inbox.js", import.meta.url), "utf8"))();
  const result = await new Promise((resolve) => listeners[0]({ type: "mp-inbox-list" }, {}, resolve));
  assert.equal(result.threads.length, 7, result.steps.join(" | "));
  assert.deepEqual(result.threads.slice(0, 2).map((t) => [t.contactName, t.listingTitle]), [["Stephanie", "2 quartos 1 banheiro Apartamento"], ["Tânia", "Casa com piscina e 3 suítes"]]);
  assert.match(result.steps.join(" | "), /página \/marketplace\/inbox: 7 conversa\(s\)/);
});

// --- 1.8.5: diagnóstico de estrutura (só metadados) ----------------------------------------------------------------
test("máscara de texto do diagnóstico: nunca nome ou mensagem real", () => {
  assert.equal(MP.skeletonText("Stephanie · 2 quartos 1 banheiro Apartamento"), "NOME · ANUNCIO");
  assert.equal(MP.skeletonText("Você: Olá Tânia, bom dia"), "Você: TEXTO");
  assert.equal(MP.skeletonText("Joao, esse imóvel está disponível para venda."), "TXT(45)");
  assert.equal(MP.skeletonText("2h"), "2h");
  assert.equal(MP.skeletonText("12:23"), "12:23");
  assert.equal(MP.skeletonText("Venda"), "Venda");
  assert.equal(MP.skeletonText("Giovanna"), "TXT(8)");
  assert.equal(MP.skeletonPath("/messages/t/1234567890123/?ref=x"), "/messages/t/:id/");
});

function domEl(tag, { attrs = {}, text = "", children = [] } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    childNodes: [...(text ? [{ nodeType: 3, textContent: text }] : []), ...children],
    children,
    getBoundingClientRect: () => ({ left: 0, right: 60, top: 0, bottom: 60, width: 60, height: 60 }),
    contains(other) { return node === other || children.some((child) => child.contains(other)); }
  };
  for (const child of children) child.parentElement = node;
  node.all = () => children.flatMap((child) => [child, ...child.all()]);
  node.querySelectorAll = (sel) => node.all().filter((el) => sel.split(",").map((s) => s.trim()).some((s) => s === el.tagName.toLowerCase() || (s === '[role="main"]' && el.getAttribute("role") === "main") || (s === '[role="dialog"]' && el.getAttribute("role") === "dialog") || (s === '[role="textbox"]' && el.getAttribute("role") === "textbox")));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] || null;
  return node;
}

test("diagnóstico (DOM falso): esqueleto da lista sem nenhum nome/mensagem/classe", async () => {
  const item = (title, preview) => domEl("div", { attrs: { role: "button", tabindex: "0", class: "x1abc" }, children: [domEl("img"), domEl("span", { text: title }), domEl("span", { text: preview }), domEl("a", { attrs: { href: "/messages/t/123456789/" } })] });
  const main = domEl("div", { attrs: { role: "main" }, children: [domEl("span", { text: "Venda" }), item("Stephanie · 2 quartos", "Essas unidades são para"), item("Tânia · Casa com piscina", "Você: Olá Tânia")] });
  const body = domEl("body", { children: [main] });
  const doc = { body, querySelectorAll: (sel) => body.querySelectorAll(sel), querySelector: (sel) => body.querySelector(sel) };
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: "https://www.facebook.com/marketplace/inbox/", origin: "https://www.facebook.com", pathname: "/marketplace/inbox/" };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  new Function(readFileSync(new URL("../inbox.js", import.meta.url), "utf8"))();
  const result = await new Promise((resolve) => listeners.find((fn) => fn.length >= 3)({ type: "mp-inbox-diagnose", stage: "inbox_page" }, {}, resolve));
  const json = JSON.stringify(result);
  assert.match(json, /NOME · ANUNCIO/);
  assert.match(json, /Você: TEXTO/);
  assert.match(json, /\/messages\/t\/:id\//);
  for (const leak of ["Stephanie", "Tânia", "Essas unidades", "Casa com piscina", "x1abc", "123456789"]) assert.ok(!json.includes(leak), `vazou: ${leak}`);
  assert.equal(result.counts.dots, 2);
  assert.match(result.how, /ancestral de 2 textos/);
});

test("1ª carga (dono, 2026-10-21): conversa anterior ao dia configurado nem é aberta; sem data → lê", async () => {
  const { splitIgnored } = await import("../lib/chat-agenda.js");
  const now = new Date("2026-10-21T15:00:00-03:00");
  const label = (text) => MP.parseRelativeTime(text, now);
  const threads = [
    { threadKey: "hoje", lastActivityAt: label("10:28") },
    { threadKey: "ontem", lastActivityAt: label("Ontem") },
    { threadKey: "1d", lastActivityAt: label("1 d") },
    { threadKey: "2d", lastActivityAt: label("2 d") },
    { threadKey: "sem", lastActivityAt: label("1 sem") },
    { threadKey: "data", lastActivityAt: label("12 de out") },
    { threadKey: "ano", lastActivityAt: label("1 a") },
    { threadKey: "sem-data", lastActivityAt: label("???") }
  ];
  const { keep, ignored } = splitIgnored(threads, "2026-10-20");
  assert.deepEqual(keep.map((t) => t.threadKey), ["hoje", "ontem", "1d", "sem-data"]);
  assert.deepEqual(ignored.map((t) => t.threadKey), ["2d", "sem", "data", "ano"]);
  assert.equal(splitIgnored(threads, "").ignored.length, 0);
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /splitIgnored\(threads, settings\.firstLoadIgnoreBefore\)/);
  assert.match(bg, /previews = rememberPreviews\(previews, ignored\)/);
});
