// 1.8.6: leitores pela estrutura REAL da caixa do Marketplace (diagnóstico do dono, 2026-10-20). Nomes e textos dos
// fixtures são fictícios.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";
import { fakeDocument, h } from "./fake-dom.js";

const { MP } = globalThis;
const now = new Date("2026-10-20T15:00:00-03:00");

// Item da lista: miniatura + "Nome" "·" "Anúncio" em spans separados + prévia + hora.
function listItem({ name, title, preview, time = "6 min", href = null, role = "button", youPrefix = false }) {
  const body = [
    h("img", { src: "https://scontent.example/thumb.jpg" }),
    h("div", {},
      h("span", {}, h("span", {}, name), h("span", {}, " · "), h("span", {}, title)),
      h("div", {}, youPrefix ? h("span", {}, "Você:") : "", h("span", {}, preview), h("span", {}, " · "), h("span", {}, time))
    )
  ];
  return href ? h("a", { href, role: "link" }, ...body) : h("div", { role, tabindex: "0" }, ...body);
}

// Janela de chat flutuante aberta (cabeçalho "Nome · Anúncio" com img 32x32, faixa do anúncio, log, campo "Aa").
function chatWindow(name, title, articles) {
  return h("div", {},
    h("div", {},
      h("div", { role: "button", tabindex: "0", "aria-label": `${name} · ${title}` }, h("img", { src: "x" }), h("h2", {}, h("span", {}, h("span", {}, h("span", {}, `${name} · ${title}`))))),
      h("div", { role: "button", "data-prevent_chattab_focus": "1", "aria-label": "Minimizar bate-papo" }),
      h("div", { role: "button", "data-prevent_chattab_focus": "1", "aria-label": "Fechar bate-papo" })
    ),
    h("a", { role: "link", href: "/marketplace/item/123456789/" }, h("span", {}, "Marketplace"), h("span", {}, `R$ 200.000 - ${title}`),
      h("div", { role: "button", "aria-label": "Mark as pending" }), h("div", { role: "button", "aria-label": "More options" })),
    h("h2", {}, "Mensagens"),
    h("div", { role: "status" }),
    h("div", { role: "log" }, ...articles),
    h("div", { role: "textbox", "data-lexical-editor": "true", contenteditable: "true", "aria-placeholder": "Aa" })
  );
}

const separator = (clock) => h("div", { "data-virtualized": "false" }, h("div", { "data-release-focus-from": "x", "data-scope": "y", tabindex: "0" }, h("div", {}, h("span", {}, clock))));

function inbound(id, name, text, { profile = true } = {}) {
  return h("div", { "data-virtualized": "false" }, h("div", {}, h("div", { role: "article" },
    h("div", { "data-message-id": id, "data-scope": "m", tabindex: "0" },
      profile ? h("a", { role: "link", href: "/marketplace/profile/555/" }, h("span", {}, name)) : "",
      h("div", { dir: "auto" }, text)),
    h("div", { role: "button", tabindex: "-1", "aria-label": text }, h("span", {}, text)),
    h("div", { role: "toolbar" })
  )));
}

function outbound(id, text, { status = true, heading = true } = {}) {
  return h("div", { "data-virtualized": "false" }, h("div", {}, h("div", { role: "article" },
    h("div", { "data-message-id": id, "data-scope": "m", tabindex: "0" },
      heading ? h("h2", {}, "Você enviou") : "",
      h("div", { dir: "auto" }, text),
      status ? h("div", { role: "status", "data-visualcompletion": "ignore" }) : ""),
    h("div", { role: "button", tabindex: "-1", "aria-label": text }, h("span", {}, text)),
    h("div", { role: "toolbar" })
  )));
}

test("lista: nome e anúncio em spans separados viram item; conversa pessoal e janela de chat não", () => {
  const main = h("div", { role: "main" },
    h("div", { role: "tablist" }, h("div", { role: "tab" }, "Venda"), h("div", { role: "tab" }, "Compra")),
    h("div", {},
      listItem({ name: "Ana Teste", title: "Casa 2 quartos", preview: "Ainda está disponível?" }),
      listItem({ name: "Bruno Teste", title: "Apartamento Centro", preview: "Pode sim", youPrefix: true, href: "/marketplace/t/987654321/" }),
      // Conversa pessoal (sem " · anúncio") nunca entra.
      h("div", { role: "button" }, h("img", { src: "x" }), h("span", {}, "Carlos Pessoal"), h("span", {}, "oi, tudo bem?"))
    ),
    chatWindow("Ana Teste", "Casa 2 quartos", [inbound("mid.1", "Ana Teste", "Oi")])
  );
  const items = MP.findListItems(main);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.parsed.contactName), ["Ana Teste", "Bruno Teste"]);
  assert.equal(items[0].parsed.listingTitle, "Casa 2 quartos");
  assert.equal(items[0].parsed.preview, "Ainda está disponível?");
  assert.equal(items[0].parsed.timeLabel, "6 min");
  assert.equal(items[0].threadKey, MP.itemKey("Ana Teste", "Casa 2 quartos"));
  assert.equal(items[1].threadKey, "987654321");
  assert.equal(items[1].href, "/marketplace/t/987654321/");
  assert.equal(items[1].parsed.previewDirection, "outbound");
  assert.equal(items[1].parsed.preview, "Você: Pode sim");
});

test("lista: contêiner com vários itens não conta; clicável externo com link vence o interno", () => {
  const inner = listItem({ name: "Dora Teste", title: "Terreno", preview: "Qual o valor?" });
  const outer = h("a", { href: "/messages/t/111222333/" }, inner);
  const container = h("div", { role: "listitem" }, outer, listItem({ name: "Eva Teste", title: "Sobrado", preview: "Obrigada" }));
  const main = h("div", { role: "main" }, container);
  const items = MP.findListItems(main);
  // listitem contém 2 itens → descartado; a[href] externo absorve o role=button interno.
  assert.deepEqual(items.map((item) => item.parsed.contactName), ["Dora Teste", "Eva Teste"]);
  assert.equal(items[0].element, outer);
  assert.equal(items[0].threadKey, "111222333");
});

test("lista: variações de folha (\"Nome ·\" + \"Anúncio\", tudo num nó só) e sem miniatura", () => {
  assert.deepEqual(MP.parseInboxLeaves(["Fábio ·", "Casa", "Você:", "ok", "15h"]).listingTitle, "Casa");
  assert.equal(MP.parseInboxLeaves(["Fábio · Casa", "Ainda tem?", "1 d"]).timeLabel, "1 d");
  assert.equal(MP.parseInboxLeaves(["Só um nome", "mensagem"]), null);
  const main = h("div", { role: "main" }, h("div", { role: "button" }, h("span", {}, "Gil"), h("span", {}, "·"), h("span", {}, "Casa")));
  assert.equal(MP.findListItems(main).length, 0); // sem miniatura não é item
});

test("conversa: direção por h2/link de perfil/role=status, id do Facebook e hora pelos separadores", () => {
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [
    separator("10:00"),
    inbound("mid.$aaa", "Ana Teste", "Olá, ainda está disponível?"),
    inbound("mid.$bbb", "Ana Teste", "Aceita financiamento?", { profile: false }),
    separator("12:55"),
    outbound("mid.$ccc", "Sim! Posso te ligar?"),
    outbound("mid.$ddd", "Aceita sim.", { status: false, heading: false }),
    outbound("", "Sem id")
  ]);
  const log = win.querySelector('[role="log"]');
  const rows = MP.readLogRows(log, { contactName: "Ana Teste", now });
  assert.deepEqual(rows.map((row) => [row.direction, row.body]), [
    ["inbound", "Olá, ainda está disponível?"],
    ["inbound", "Aceita financiamento?"], // sem marcador: herda o anterior
    ["outbound", "Sim! Posso te ligar?"],
    ["outbound", "Aceita sim."],
    ["outbound", "Sem id"]
  ]);
  assert.equal(rows[0].externalId, "fb:mid.$aaa");
  assert.equal(rows[4].externalId, "");
  assert.equal(rows[0].at, "2026-10-20T13:00:00.000Z");
  assert.equal(rows[2].at, "2026-10-20T15:55:00.000Z");
  // Geometria só entra quando não há marcador.
  const geo = MP.readLogRows(log, { directionOf: () => "outbound", now });
  assert.equal(geo[1].direction, "outbound");
  assert.equal(geo[0].direction, "inbound");
  const messages = MP.buildMessages("t1", rows);
  assert.equal(messages[0].externalId, "fb:mid.$aaa");
  assert.match(messages[4].externalId, /^h:/); // sem data-message-id: hash estável
});

test("conversa: painel do chat, botão de fechar e janela não vira item; merge de janelas por id", () => {
  const win = chatWindow("Ana Teste", "Casa", [inbound("mid.1", "Ana Teste", "Oi")]);
  const doc = h("body", {}, h("div", { role: "main" }), win);
  const panes = MP.chatPanes(doc);
  assert.equal(panes.length, 1);
  assert.ok(panes[0].querySelector("[data-prevent_chattab_focus]"));
  assert.deepEqual(MP.chatCloseButtons(doc).map((button) => button.getAttribute("aria-label")), ["Fechar bate-papo"]);
  assert.equal(MP.findListItems(doc).length, 0);
  // Sem rótulo conhecido: último botão do cabeçalho.
  const bare = h("div", {}, h("div", {}, h("div", { role: "button", "data-prevent_chattab_focus": "1", "aria-label": "Minimize" }), h("div", { role: "button", "data-prevent_chattab_focus": "1", "aria-label": "Xyz" })));
  assert.deepEqual(MP.chatCloseButtons(bare).map((button) => button.getAttribute("aria-label")), ["Xyz"]);
  const a = { externalId: "fb:1", direction: "inbound", body: "oi" };
  const b = { externalId: "fb:2", direction: "inbound", body: "oi" };
  assert.deepEqual(MP.mergeRowWindows([a, b], [b, { externalId: "fb:3", direction: "outbound", body: "x" }]).map((row) => row.externalId), ["fb:1", "fb:2", "fb:3"]);
});

test("diagnóstico: separador e nomes mascarados", () => {
  assert.equal(MP.skeletonText("·"), "·");
  assert.equal(MP.skeletonText("Ana Teste"), "TXT(9)");
  assert.equal(MP.parseThreadKey("/marketplace/inbox/?thread_id=42"), "42");
});

async function loadInbox(doc, pathname = "/marketplace/inbox/") {
  const listeners = [];
  globalThis.document = doc;
  globalThis.location = { href: `https://www.facebook.com${pathname}`, origin: "https://www.facebook.com", pathname };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({ ok: false }) } };
  globalThis.__mpInboxLoaded = false;
  new Function(readFileSync(new URL("../inbox.js", import.meta.url), "utf8"))();
  return (message) => new Promise((resolve) => listeners[0](message, {}, resolve));
}

test("inbox.js (estrutura real): fecha a janela de chat aberta e lista só os itens com · da caixa", async () => {
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [inbound("mid.1", "Ana Teste", "Oi")]);
  win.querySelector('[aria-label="Fechar bate-papo"]').onClick = () => win.remove();
  const main = h("div", { role: "main" },
    listItem({ name: "Ana Teste", title: "Casa 2 quartos", preview: "Ainda está disponível?" }),
    listItem({ name: "Bruno Teste", title: "Apartamento Centro", preview: "Pode sim", youPrefix: true, href: "/marketplace/t/987654321/" }),
    h("div", { role: "button" }, h("img", { src: "x" }), h("span", {}, "Carlos Pessoal"), h("span", {}, "oi"))
  );
  const send = await loadInbox(fakeDocument(h("body", {}, main, win)));
  const result = await send({ type: "mp-inbox-list" });
  assert.match(result.steps.join(" | "), /fechou 1 janela\(s\) de chat/);
  assert.deepEqual(result.threads.map((t) => [t.contactName, t.listingTitle, t.threadUrl]), [
    ["Ana Teste", "Casa 2 quartos", ""],
    ["Bruno Teste", "Apartamento Centro", "https://www.facebook.com/marketplace/t/987654321/"]
  ]);
});

test("inbox.js (estrutura real): lê a conversa aberta pelo role=log e fecha a janela", async () => {
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [
    separator("10:00"),
    inbound("mid.$aaa", "Ana Teste", "Olá, ainda está disponível?"),
    outbound("mid.$ccc", "Sim! Posso te ligar?")
  ]);
  let closed = false;
  win.querySelector('[aria-label="Fechar bate-papo"]').onClick = () => { closed = true; win.remove(); };
  const send = await loadInbox(fakeDocument(h("body", {}, h("div", { role: "main" }), win)));
  const result = await send({ type: "mp-inbox-read", threadKey: "n1", contactName: "Ana Teste" });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.messages.map((m) => [m.externalId, m.direction, m.body]), [
    ["fb:mid.$aaa", "inbound", "Olá, ainda está disponível?"],
    ["fb:mid.$ccc", "outbound", "Sim! Posso te ligar?"]
  ]);
  assert.equal(result.listingUrl, "https://www.facebook.com/marketplace/item/123456789/");
  assert.equal(closed, true);
});

test("inbox.js (estrutura real): diagnóstico inbox_list anonimizado", async () => {
  const main = h("div", { role: "main" }, listItem({ name: "Ana Teste", title: "Casa 2 quartos", preview: "Ainda está disponível?" }));
  const send = await loadInbox(fakeDocument(h("body", {}, main)));
  const result = await send({ type: "mp-inbox-diagnose", stage: "inbox_list" });
  assert.equal(result.stage, "inbox_list");
  assert.equal(result.how, "role=main");
  assert.equal(result.counts.withThumb, 1);
  assert.equal(result.counts.items, 1);
  assert.equal(result.items[0].dotLeaf, true);
  assert.equal(result.items[0].parsed, true);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /Ana Teste|Casa 2 quartos|disponível/);
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /postDiagnostic\(config, "inbox_list", list\)/);
});

// 1.8.8: o clique no item NÃO navega — abre a janela flutuante na mesma página (caso real do dono: "Tempo esgotado
// esperando a página do Facebook" em todas as conversas). Abre e lê no mesmo contexto, sem esperar a aba carregar.
test("inbox.js 1.8.8: abre a conversa pelo clique na mesma página e lê o role=log da janela com o nome", async () => {
  const item = listItem({ name: "Ana Teste", title: "Casa 2 quartos", preview: "Ainda está disponível?" });
  const main = h("div", { role: "main" }, item);
  const body = h("body", {}, main);
  // Outra janela já aberta (de outro contato) não pode ser confundida.
  item.onClick = () => {
    body.append(chatWindow("Bruno Teste", "Apartamento", [inbound("mid.$zz", "Bruno Teste", "Outra conversa")]));
    body.append(chatWindow("Ana Teste", "Casa 2 quartos", [inbound("mid.$aaa", "Ana Teste", "Olá, ainda está disponível?"), outbound("mid.$ccc", "Sim! Posso te ligar?")]));
  };
  const send = await loadInbox(fakeDocument(body));
  const threadKey = MP.itemKey("Ana Teste", "Casa 2 quartos");
  const result = await send({ type: "mp-inbox-open-read", threadKey, contactName: "Ana Teste", full: false, maxMs: 60000 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.opened.opened, "painel");
  assert.equal(result.opened.navigated, false);
  assert.deepEqual(result.messages.map((m) => [m.externalId, m.direction]), [["fb:mid.$aaa", "inbound"], ["fb:mid.$ccc", "outbound"]]);
});

test("inbox.js 1.8.8: conversa que não abre devolve diagnóstico open_conversation anonimizado", async () => {
  const item = listItem({ name: "Ana Teste", title: "Casa 2 quartos", preview: "Ainda está disponível?" });
  const send = await loadInbox(fakeDocument(h("body", {}, h("div", { role: "main" }, item))));
  const result = await send({ type: "mp-inbox-open-read", threadKey: MP.itemKey("Ana Teste", "Casa 2 quartos"), contactName: "Ana Teste", openWaitMs: 800 });
  assert.equal(result.ok, false);
  assert.match(result.error, /não abriu em 1 s depois do clique/);
  const diagnostic = result.opened.diagnostic;
  assert.equal(diagnostic.stage, "open_conversation");
  assert.equal(diagnostic.result, "sem_painel");
  assert.equal(diagnostic.path, "/marketplace/inbox/");
  assert.ok(diagnostic.clicked.item);
  assert.doesNotMatch(JSON.stringify(diagnostic), /Ana Teste|Casa 2 quartos|disponível/);
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /type: "mp-inbox-prepare-open"/);
  assert.match(bg, /postDiagnostic\(config, "thread", diagnostic\)/);
  assert.doesNotMatch(bg.slice(bg.indexOf("async function readThread"), bg.indexOf("function MP_PATH")), /waitTabSettled/, "não espera a aba carregar depois do clique");
});

// 1.8.9: leitor chamado por executeScript (valor direto, exceção vira objeto) e retrato direto da página.
test("inbox.js 1.8.9: __mpInbox.handle devolve o resultado e transforma exceção em { ok:false, error, stack }", async () => {
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [inbound("mid.$aaa", "Ana Teste", "Olá")]);
  await loadInbox(fakeDocument(h("body", {}, h("div", { role: "main" }), win)));
  const ok = await globalThis.__mpInbox.handle({ type: "mp-inbox-read", threadKey: "n1", contactName: "Ana Teste" });
  assert.equal(ok.ok, true, ok.error);
  globalThis.document = null; // página quebrada: o leitor lança
  const broken = await globalThis.__mpInbox.handle({ type: "mp-inbox-read", threadKey: "n1" });
  assert.equal(broken.ok, false);
  assert.ok(broken.error);
  assert.equal(typeof broken.stack, "string");
});

test("inbox.js 1.8.9: linhas lidas mas nenhuma mensagem válida é falha (não vai conversa vazia ao CRM)", async () => {
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [outbound("mid.$s", "Você enviou uma foto.")]);
  const send = await loadInbox(fakeDocument(h("body", {}, h("div", { role: "main" }), win)));
  MP.inbox.systemTexts.push("Você enviou uma foto.");
  try {
    const result = await send({ type: "mp-inbox-read", threadKey: "n1", contactName: "Ana Teste" });
    assert.equal(result.ok, false);
    assert.match(result.error, /nenhuma mensagem reconhecida \(1 linha\(s\) lidas, todas descartadas/);
  } finally {
    MP.inbox.systemTexts.pop();
  }
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /!conversation\.messages\.length/);
});

test("background 1.8.9: executeScript no frame principal (ISOLATED) e retrato anonimizado direto da página", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /target: \{ tabId, allFrames: false \}, world: "ISOLATED", func: callInboxInPage/);
  assert.doesNotMatch(bg, /sendWithTimeout\((tabId|tab\.id), \{ type: "mp-inbox-/, "leitor só por executeScript");
  const source = bg.slice(bg.indexOf("function pageSnapshot()"), bg.indexOf("async function takeSnapshot"));
  const pageSnapshot = new Function(`${source}; return pageSnapshot;`)();
  const win = chatWindow("Ana Teste", "Casa 2 quartos", [inbound("mid.$aaa", "Ana Teste", "Olá, ainda está disponível?")]);
  globalThis.document = fakeDocument(h("body", {}, h("div", { role: "main" }), h("div", { role: "dialog" }, win)));
  globalThis.location = { href: "https://www.facebook.com/marketplace/t/123456789/", origin: "https://www.facebook.com", pathname: "/marketplace/t/123456789/" };
  const snap = pageSnapshot();
  assert.equal(snap.path, "/marketplace/t/:id/");
  assert.deepEqual([snap.counts.logs, snap.counts.articles, snap.counts.messageIds, snap.counts.dialogs], [1, 1, 1, 1]);
  assert.ok(snap.trees.length >= 1);
  const json = JSON.stringify(snap);
  assert.doesNotMatch(json, /Ana Teste|Casa 2 quartos|disponível|123456789/);
  assert.match(json, /"r":"log"/);
});

// 1.8.10: diagnóstico real — clique sem efeito (sintético ou no botão de menu dentro do item).
test("inbox.js 1.8.10: prepara o clique na linha do NOME, fora do botão de menu interno, e informa os atributos", async () => {
  const item = h("div", { role: "button", tabindex: "0", "data-testid": "mwthreadlist-item" },
    h("svg", {}, h("image", { width: "60", height: "60" })),
    h("div", {}, h("span", {}, h("span", {}, "Ana Teste"), h("span", {}, " · "), h("span", {}, "Casa 2 quartos")), h("span", {}, "Ainda está disponível?")),
    h("div", { role: "button", tabindex: "0", "aria-label": "Mais opções da conversa" }, h("span", {}, "Mais"))
  );
  item.append(h("img", { src: "https://scontent.example/thumb.jpg" }));
  const send = await loadInbox(fakeDocument(h("body", {}, h("div", { role: "main" }, item))));
  const threadKey = MP.itemKey("Ana Teste", "Casa 2 quartos");
  const prep = await send({ type: "mp-inbox-prepare-open", threadKey, contactName: "Ana Teste" });
  assert.equal(prep.ok, true, prep.error);
  assert.equal(prep.by, "nome");
  assert.equal(prep.innerButtons, 1);
  assert.ok(Number.isFinite(prep.x) && Number.isFinite(prep.y));
  assert.ok(prep.attrNames.includes("data-testid"));
  assert.equal(prep.threadId, "");
  const state = await send({ type: "mp-inbox-open-state", contactName: "Ana Teste" });
  assert.deepEqual([state.found, state.path, state.logs], [null, "/marketplace/inbox/", 0]);
  const diag = await send({ type: "mp-inbox-open-diagnostic", before: "https://www.facebook.com/marketplace/inbox/", waitedMs: 20000 });
  assert.ok(diag.attrNames.includes("data-testid"));
  assert.doesNotMatch(JSON.stringify(diag), /Ana Teste|Casa 2 quartos|disponível/);
});

test("background 1.8.10: clique confiável pelo depurador, aba visível só durante a conversa, espera no background", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const flow = bg.slice(bg.indexOf("async function openAndReadByClick"), bg.indexOf("async function readThread"));
  assert.match(flow, /const focus = await focusTab\(tabId\);/);
  assert.match(flow, /await trustedClick\(tabId, prep\.x, prep\.y\)/);
  assert.match(flow, /finally \{\s*await focus\.restore\(\);/);
  assert.match(bg, /withTimeout\(chrome\.debugger\.sendCommand/);
  // Último recurso pelo endereço só lê se a janela aberta tiver o nome do contato (nunca outra conversa).
  assert.match(flow, /state\.found === "painel" \? await readOpenThread/);
});
