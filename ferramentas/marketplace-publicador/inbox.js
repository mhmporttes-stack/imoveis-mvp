// Chat do Marketplace (MKT-2): roda na aba dedicada do Facebook, injetado depois de selectors.js. Lê SÓ a caixa de
// entrada do Marketplace e as conversas listadas nela; envia a resposta digitada no CRM com teclas reais (o background
// liga o chrome.debugger). Seletores em selectors.js (MP.inbox) — A CALIBRAR com a caixa real do dono.

(function marketplaceInbox() {
  if (globalThis.__mpInboxLoaded && globalThis.__mpInbox) return;
  globalThis.__mpInboxLoaded = true;
  const MP = globalThis.MP;
  // 1.9.3: espera pelo relógio do service worker (mensagem "mp-sleep"), com o setTimeout da página em paralelo — o que
  // terminar primeiro. Com a aba oculta o Chrome segura os timers da página (até 1 min cada) e os prazos da leitura
  // estouravam (erro real "passou de 210 s"); a resposta da extensão chega na hora certa. Sem resposta ok → só o timer.
  const sleep = (ms) => new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(finish, ms);
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: "mp-sleep", ms })).then((reply) => reply?.ok && finish(), () => {});
    } catch {
      // extensão recarregada: fica o timer da página
    }
  });
  const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  async function waitFor(finder, timeoutMs = 15000, intervalMs = 500) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = finder();
      if (found) return found;
      await sleep(intervalMs);
    }
    return null;
  }

  function pageCheckpoint() {
    return MP.isCheckpoint(location.href, document.body ? document.body.innerText.slice(0, 20000) : "");
  }

  function itemLines(element) {
    return String(element.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
  }

  // Itens "Nome · Anúncio" dentro de `root` (role=main da página da caixa ou o painel "← Marketplace"). Só itens com
  // " · " entram: conversas pessoais (sem anúncio) nunca são lidas. Regra em MP.findListItems (selectors.js, 1.8.6):
  // clicável com miniatura cujas folhas de texto têm " · " (nome e anúncio ficam em spans separados).
  function findItemElements(root) {
    const found = MP.findListItems(root, { visible });
    return found.length ? found : findItemElementsByLines(root);
  }

  // Reserva (1.8.4): sobe de cada miniatura até o nó pequeno (2–6 linhas de innerText) com "Nome · Anúncio" na 1ª linha;
  // também aceita itens com role (lista/linha/link). Nunca o contêiner da lista inteira.
  function findItemElementsByLines(root) {
    const found = [];
    const seen = new Set();
    const consider = (element) => {
      if (!element || seen.has(element) || !visible(element)) return false;
      const lines = itemLines(element);
      if (lines.length < 2 || lines.length > 6) return false;
      const parsed = MP.parseInboxItem(lines);
      if (!parsed) return false;
      seen.add(element);
      found.push({ element, parsed });
      return true;
    };
    for (const img of root.querySelectorAll("img, image")) {
      const rect = img.getBoundingClientRect();
      if (rect.width && (rect.width < 24 || rect.width > 140)) continue; // miniatura do anúncio (~60 px)
      let node = img.parentElement;
      for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
        if (itemLines(node).length > 6) break; // chegou no contêiner da lista
        if (consider(node)) break;
      }
    }
    for (const element of root.querySelectorAll(MP.inbox.listItems)) consider(element);
    // Só o mais interno de cada conversa (um item que contém outro item igual não conta duas vezes).
    return found
      .filter((item) => !found.some((other) => other !== item && item.element.contains?.(other.element)))
      .map(({ element, parsed }) => {
        const link = element.matches?.("a") ? element : element.querySelector?.("a[href]") || element.closest?.("a[href]");
        const href = link?.getAttribute("href") || "";
        return { element, parsed, href, threadKey: MP.parseThreadKey(href) || MP.itemKey(parsed.contactName, parsed.listingTitle) };
      });
  }

  function listRoot() {
    return [...document.querySelectorAll('[role="main"]')].find(visible) || document;
  }

  function collectItems(root) {
    const byKey = new Map();
    for (const { element, parsed, href, threadKey } of findItemElements(root)) {
      if (byKey.has(threadKey)) continue;
      const photo = element.querySelector?.("img, image");
      const label = `${element.getAttribute?.("aria-label") || ""}`;
      byKey.set(threadKey, {
        threadKey,
        threadUrl: MP.parseThreadKey(href) ? new URL(href, location.origin).toString() : "",
        contactName: parsed.contactName,
        listingTitle: parsed.listingTitle,
        preview: parsed.preview,
        lastActivityAt: MP.parseRelativeTime(parsed.timeLabel) || null,
        unread: /n[ãa]o lida|unread/i.test(label) || /font-weight:\s*(6|7|8|9)00|bold/i.test(String(element.innerHTML || "").slice(0, 2000)),
        contactPhotoUrl: photo?.getAttribute?.("src") || photo?.getAttribute?.("xlink:href") || ""
      });
    }
    return [...byKey.values()];
  }

  // Janelas de chat flutuantes abertas atrapalham a lista (o cabeçalho delas também é "Nome · Anúncio"): fecha todas.
  async function closeOpenChats() {
    let closed = 0;
    for (let i = 0; i < 6; i += 1) {
      const button = MP.chatCloseButtons(document).find(visible);
      if (!button) break;
      await clickElement(button);
      closed += 1;
    }
    return closed;
  }

  function findByText(selector, texts, root = document) {
    return [...root.querySelectorAll(selector)].find((element) => visible(element) && (MP.matchesAny(element.getAttribute?.("aria-label"), texts, true) || MP.matchesAny(itemLines(element)[0], texts, true))) || null;
  }

  // Caminho do print do dono: ícone do Messenger → painel "Conversas" → item fixo "Marketplace" → "← Marketplace".
  async function openMarketplaceFromMessenger(steps) {
    const button = findByText('[role="button"], a, [aria-label]', MP.inbox.messengerButtonLabels);
    if (!button) {
      steps.push("ícone do Messenger não encontrado");
      return null;
    }
    await clickElement(button);
    const entry = await waitFor(() => findByText(MP.inbox.listItems, MP.inbox.marketplaceEntryTexts), 10000);
    if (!entry) {
      steps.push("painel de conversas sem o item Marketplace");
      return null;
    }
    await clickElement(entry);
    await sleep(between(1500, 2500));
    steps.push("abriu Messenger → Marketplace");
    // O painel que mostra "← Marketplace" (ou o diálogo aberto) é a raiz da lista.
    // Nunca a página inteira: só o painel que agora mostra "← Marketplace" (sem ele, não lê nada).
    const panel = [...document.querySelectorAll('[role="dialog"], [role="complementary"]')].find((element) => visible(element) && MP.matchesAny(itemLines(element)[0], MP.inbox.marketplaceEntryTexts));
    if (panel) return panel;
    // Painel sem role conhecido: sobe do título "Marketplace" até o bloco que contém os itens "Nome · Anúncio".
    const header = await waitFor(() => [...document.querySelectorAll('[role="heading"], h1, h2, h3, span')].find((element) => visible(element) && MP.matchesAny(element.innerText, MP.inbox.marketplaceEntryTexts, true)) || null, 5000);
    for (let node = header?.parentElement, level = 0; node && level < 10; node = node.parentElement, level += 1) {
      if (collectItems(node).length) {
        steps.push(`painel achado pelo título (nível ${level + 1})`);
        return node;
      }
    }
    steps.push("painel \"← Marketplace\" não encontrado depois do clique");
    return null;
  }

  async function clickElement(element) {
    element.scrollIntoView?.({ block: "center" });
    await sleep(between(200, 400));
    const rect = element.getBoundingClientRect();
    if (!(await trusted("click", { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 18) }))) element.click?.();
    await sleep(between(600, 1200));
  }

  // Lista da caixa do Marketplace: 1º a página /marketplace/inbox; sem itens, o caminho do Messenger. Devolve também
  // os passos (diagnóstico do popup).
  function scrollableIn(root) {
    const all = [root, ...root.querySelectorAll("div")];
    const scrolls = (node) => typeof getComputedStyle !== "function" || /(auto|scroll)/.test(getComputedStyle(node).overflowY);
    return all.find((node) => node.scrollHeight > node.clientHeight + 40 && node.nodeType === 1 && scrolls(node)) || document.scrollingElement || null;
  }

  // Lê o painel inteiro: rola para baixo (a lista carrega mais com "esqueleto" cinza) juntando os itens, até parar.
  async function collectAll(root, steps, label) {
    const byKey = new Map(collectItems(root).map((item) => [item.threadKey, item]));
    const box = scrollableIn(root);
    for (let i = 0; box && i < 30; i += 1) {
      const before = byKey.size;
      box.scrollTop = box.scrollHeight;
      await sleep(between(900, 1500));
      for (const item of collectItems(root)) if (!byKey.has(item.threadKey)) byKey.set(item.threadKey, item);
      if (byKey.size === before && box.scrollTop + box.clientHeight >= box.scrollHeight - 5) break;
    }
    steps.push(`${label}: ${byKey.size} conversa(s)`);
    return [...byKey.values()];
  }

  // Lista das conversas do Marketplace: a página /marketplace/inbox (aba "Venda", confirmada pelo print do dono) rolada
  // até o fim; sem itens, o caminho do Messenger → "Marketplace". Passos e contagens vão para o popup.
  async function listThreads() {
    const steps = [`aba em ${location.pathname}`];
    let threads = [];
    if (location.pathname.startsWith("/marketplace/inbox")) {
      const closed = await closeOpenChats();
      if (closed) steps.push(`fechou ${closed} janela(s) de chat`);
      await waitFor(() => collectItems(listRoot()).length || null, 15000, 800);
      threads = await collectAll(listRoot(), steps, "página /marketplace/inbox");
    }
    if (!threads.length) {
      const root = await openMarketplaceFromMessenger(steps);
      if (root) {
        await waitFor(() => collectItems(root).length || null, 10000, 800);
        threads = await collectAll(root, steps, "painel Marketplace");
      }
    }
    return { threads: threads.slice(0, 40), checkpoint: pageCheckpoint(), url: location.href, steps };
  }

  // Abre a conversa clicando no item (quando não há link). 1.8.8: o clique NÃO recarrega a página — abre a janela
  // de chat flutuante na mesma página ou só troca a rota (pushState para /marketplace/t/ ou /messages/t/). Por isso
  // espera AQUI, no DOM (até 20 s), o painel da conversa: div[role=log] num painel cujo cabeçalho
  // ([role=button][aria-label] ou h2) tem o nome do item clicado; ou a rota de conversa com um role=log visível.
  // (A 1.8.7 esperava o "complete" da aba / reinjetava e esgotava o tempo em todas as conversas — caso real do dono.)
  const OPEN_WAIT_MS = 20000;
  const THREAD_PATH = /\/(?:marketplace\/t|messages\/t|t)\//;

  function namedPane(contactName) {
    const key = MP.normalize(contactName);
    // Sem nome (envio de resposta sem o nome do contato): qualquer painel de conversa visível.
    return MP.chatPanes(document).find((pane) => visible(pane) && pane.querySelector?.('[role="log"]')
      && (!key || [...pane.querySelectorAll('[role="button"][aria-label], h2, [role="heading"]')].some((node) => MP.normalize(node.getAttribute?.("aria-label") || node.textContent).includes(key)))) || null;
  }

  function threadRouteWithLog() {
    if (!THREAD_PATH.test(location.pathname)) return null;
    return [...document.querySelectorAll('[role="log"]')].find(visible) || null;
  }

  function itemHrefOf(element) {
    const links = [element, ...(element.querySelectorAll?.("a[href]") || [])].filter((node) => node.getAttribute?.("href"));
    const outer = element.closest?.("a[href]");
    if (outer) links.push(outer);
    const href = links.map((node) => node.getAttribute("href")).find((value) => value && !value.startsWith("#"));
    try {
      return href ? new URL(href, location.origin).toString() : "";
    } catch {
      return "";
    }
  }

  // Esqueleto anonimizado do que estava na tela quando a conversa não abriu (calibração; sem nomes nem mensagens).
  function openDiagnostic({ before, clicked, waitedMs, stage }) {
    const budget = { left: 1200 };
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].slice(0, 8).map((dialog) => ({
      visible: visible(dialog),
      logs: dialog.querySelectorAll('[role="log"]').length,
      textboxes: dialog.querySelectorAll('[role="textbox"]').length,
      headers: [...dialog.querySelectorAll('[role="button"][aria-label], h2')].slice(0, 8).map((node) => MP.skeletonText(node.getAttribute?.("aria-label") || node.textContent))
    }));
    const panes = MP.chatPanes(document);
    return {
      stage: "open_conversation",
      result: stage,
      path: MP.skeletonPath(location.href),
      before: MP.skeletonPath(before),
      waitedMs,
      visibility: document.visibilityState,
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      clicked: clicked ? { item: skeleton(clicked.element, 0, { left: 150 }), href: MP.skeletonPath(clicked.href) } : null,
      counts: { dialogs: dialogs.length, logs: document.querySelectorAll('[role="log"]').length, panes: panes.length, visiblePanes: panes.filter(visible).length, textboxes: document.querySelectorAll('[role="textbox"]').length },
      dialogs,
      panes: panes.slice(0, 3).map((pane) => skeleton(pane, 0, budget)),
      truncated: budget.left <= 0
    };
  }

  // 1.8.10: ponto do clique = linha do NOME do contato. O centro do item pode cair no botão interno de menu da
  // conversa (div[role=button] dentro do item — diagnóstico real de 21/10), e o Facebook ignora clique sintético:
  // o clique de verdade é feito pelo background (chrome.debugger) neste ponto.
  function nameClickPoint(element, contactName = "") {
    const key = MP.normalize(contactName);
    const innerButtons = [...element.querySelectorAll('[role="button"]')].filter((button) => button !== element);
    const insideInner = (node) => innerButtons.some((button) => button.contains(node));
    const leaves = [];
    const walk = (node, depth) => {
      if (depth > 40) return;
      for (const child of node.children || []) {
        if (/^(svg|script|style)$/i.test(child.tagName || "")) continue;
        const own = [...(child.childNodes || [])].filter((item) => item.nodeType === 3).map((item) => item.textContent).join(" ").replace(/\s+/g, " ").trim();
        if (own && !insideInner(child)) leaves.push({ element: child, text: own });
        walk(child, depth + 1);
      }
    };
    walk(element, 0);
    const nameLeaf = (key && leaves.find((leaf) => MP.normalize(leaf.text).startsWith(key))) || leaves.find((leaf) => leaf.text !== "·" && MP.normalize(leaf.text).length > 1) || null;
    const rect = (nameLeaf?.element || element).getBoundingClientRect();
    const x = Math.round(rect.left + Math.min(rect.width / 2, 30));
    const y = Math.round(rect.top + rect.height / 2);
    const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    return { x, y, by: nameLeaf ? (key && MP.normalize(nameLeaf.text).startsWith(key) ? "nome" : "1o texto") : "item", hitOk: hit ? element.contains(hit) && !insideInner(hit) : null, innerButtons: innerButtons.length };
  }

  // Atributos do item (só NOMES para o diagnóstico) e um id de conversa, se algum data-*/aria-controls/href revelar.
  function itemAttributes(element) {
    const names = new Set();
    let threadId = "";
    const nodes = [element, ...element.querySelectorAll("*")].slice(0, 300);
    for (let up = element.parentElement, level = 0; up && level < 3; up = up.parentElement, level += 1) nodes.push(up);
    for (const node of nodes) {
      for (const attr of node.attributes || []) {
        const name = attr.name;
        if (name.startsWith("data-") || ["aria-controls", "aria-describedby", "aria-labelledby", "aria-owns", "id", "href"].includes(name)) names.add(name);
        if (!threadId && (name.startsWith("data-") || name === "aria-controls" || name === "href")) threadId = MP.parseThreadKey(String(attr.value || "")) || "";
      }
    }
    return { names: [...names].slice(0, 40), threadId: /^\d{6,}$/.test(threadId) ? threadId : "" };
  }

  let pendingItem = null;

  // Prepara o clique (1.8.10): fecha janelas, acha o item, rola até ele e devolve o ponto — o background clica.
  async function prepareOpen(threadKey, contactName = "") {
    await closeOpenChats();
    const root = listRoot();
    const box = scrollableIn(root);
    for (let i = 0; i < 20; i += 1) {
      const item = findItemElements(root).find((candidate) => candidate.threadKey === threadKey);
      if (item) {
        item.element.scrollIntoView?.({ block: "center" });
        await sleep(between(300, 500));
        const attrs = itemAttributes(item.element);
        pendingItem = { element: item.element, href: itemHrefOf(item.element) };
        return { ok: true, ...nameClickPoint(item.element, contactName), before: location.href, itemHref: pendingItem.href, attrNames: attrs.names, threadId: attrs.threadId, iframes: document.querySelectorAll("iframe").length };
      }
      if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 5) break;
      box.scrollTop += Math.max(300, box.clientHeight * 0.8);
      await sleep(between(900, 1500));
    }
    pendingItem = null;
    return { ok: false, error: `Item da conversa não encontrado na lista (${findItemElements(root).length} itens visíveis).` };
  }

  // Checagem instantânea (o background repete a cada 0,5 s — sem depender de timer da aba, que o Chrome segura).
  function openState(contactName = "") {
    return { found: namedPane(contactName) ? "painel" : threadRouteWithLog() ? "rota" : null, path: MP.skeletonPath(location.href), visibility: document.visibilityState, iframes: document.querySelectorAll("iframe").length, dialogs: document.querySelectorAll('[role="dialog"]').length, logs: document.querySelectorAll('[role="log"]').length };
  }

  async function openItem(threadKey, contactName = "", waitMs = OPEN_WAIT_MS) {
    await closeOpenChats();
    const root = listRoot();
    const box = scrollableIn(root);
    const before = location.href;
    for (let i = 0; i < 20; i += 1) {
      const item = findItemElements(root).find((candidate) => candidate.threadKey === threadKey);
      if (item) {
        const itemHref = itemHrefOf(item.element);
        item.element.scrollIntoView?.({ block: "center" });
        await sleep(between(200, 400));
        const point = nameClickPoint(item.element, contactName);
        if (!(await trusted("click", { x: point.x, y: point.y }))) item.element.click?.();
        await sleep(between(600, 1200));
        const startedAt = Date.now();
        const found = await waitFor(() => (namedPane(contactName) ? "painel" : threadRouteWithLog() ? "rota" : null), waitMs, 400);
        if (found) return { ok: true, opened: found, navigated: location.href !== before, url: location.href };
        return { ok: false, itemHref, error: `A conversa não abriu em ${Math.round(waitMs / 1000)} s depois do clique (aba em ${MP.skeletonPath(location.href)}).`, diagnostic: openDiagnostic({ before, clicked: { element: item.element, href: itemHref }, waitedMs: Date.now() - startedAt, stage: "sem_painel" }) };
      }
      if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 5) break;
      box.scrollTop += Math.max(300, box.clientHeight * 0.8);
      await sleep(between(900, 1500));
    }
    return { ok: false, error: `Item da conversa não encontrado na lista (${findItemElements(root).length} itens visíveis).`, diagnostic: openDiagnostic({ before, clicked: null, waitedMs: 0, stage: "item_nao_encontrado" }) };
  }

  // Abre e lê no MESMO contexto da página (sem esperar carregamento da aba nem reinjetar).
  async function openAndRead(message) {
    const startedAt = Date.now();
    const opened = await openItem(message.threadKey, message.contactName || "", Number(message.openWaitMs) || OPEN_WAIT_MS);
    if (!opened.ok) return { ok: false, opened, error: opened.error };
    // O prazo vale para abrir + ler: a leitura fica com o que sobrou (mínimo 20 s).
    const maxMs = Number(message.maxMs) || 0;
    const read = await readThread(message.threadKey, message.full === true, message.contactName || "", maxMs ? Math.max(20000, maxMs - (Date.now() - startedAt)) : 0);
    return { ...read, opened };
  }

  // Só anexos de verdade (1.8.11): nunca o avatar do remetente (≤ 40 px na tela, ou dentro do link do perfil).
  function bubbleAttachments(row) {
    return [...row.querySelectorAll("img")]
      .filter((img) => (img.naturalWidth || img.width || 0) >= 80 && /^https:/.test(img.src))
      .filter((img) => {
        const rect = img.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.width <= 40) return false;
        return !img.closest?.('a[href*="/marketplace/profile/"], a[href*="/profile.php"]');
      })
      .map((img) => ({ type: "image", url: img.src, name: "" }))
      .slice(0, 5);
  }

  // Janela de chat flutuante aberta (a menor que tem o campo "Aa"); com `name`, a que mostra esse nome no cabeçalho.
  function chatWindow(name = "") {
    const key = MP.normalize(name);
    // Estrutura real (1.8.6): painel = menor bloco com o div[role=log] e o campo de escrever (+ cabeçalho).
    const panes = MP.chatPanes(document).filter((pane) => visible(pane) && pane.querySelector?.(MP.inbox.composer));
    const named = panes.find((pane) => !key || [...pane.querySelectorAll('[role="button"][aria-label], h2')].some((node) => MP.normalize(node.getAttribute?.("aria-label") || node.textContent).startsWith(key)));
    if (named) return named;
    const candidates = [...document.querySelectorAll(MP.inbox.chatWindow)]
      .filter((element) => visible(element) && element.querySelector?.(MP.inbox.composer))
      .filter((element) => !key || MP.normalize(itemLines(element)[0] || "").includes(key));
    const area = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    };
    return candidates.sort((a, b) => area(a) - area(b))[0] || null;
  }

  // Bolhas visíveis: linhas [role=row] ou, sem elas, cada bloco de texto. Lado pela geometria (direita = nossa);
  // separador de hora centralizado ("12:23") vale para as mensagens seguintes; nome do cliente acima do grupo e faixa
  // do anúncio são ignorados.
  function visibleRows(area, contactName = "") {
    const areaRect = area.getBoundingClientRect();
    const center = (areaRect.left + areaRect.right) / 2;
    const nameKey = MP.normalize(contactName);
    const rows = [];
    let currentAt = null;
    const units = [...area.querySelectorAll(MP.inbox.messageRows)];
    const nodes = units.length ? units : [...area.querySelectorAll(MP.inbox.messageText)];
    const panels = MP.quickReplyPanels(area);
    for (const row of nodes) {
      if (panels.some((panel) => panel.contains?.(row))) continue;
      const textNode = units.length ? [...row.querySelectorAll(MP.inbox.messageText)].find((node) => node.innerText?.trim()) : row;
      const body = textNode ? String(textNode.innerText || "").trim() : "";
      const rect = (textNode || row).getBoundingClientRect();
      const clock = body && MP.parseClockSeparator(body);
      if (clock && Math.abs((rect.left + rect.right) / 2 - center) < areaRect.width * 0.15) {
        currentAt = clock;
        continue;
      }
      if (nameKey && MP.normalize(body) === nameKey) continue; // nome do cliente acima do grupo
      const attachments = units.length ? bubbleAttachments(row) : [];
      if (!body && !attachments.length) continue;
      rows.push({ direction: MP.directionFromGeometry(rect, areaRect), body, attachments, at: currentAt });
    }
    return rows;
  }

  // Linhas pela estrutura real (div[role=log] → div[role=article] com data-message-id); sem ela, pela geometria.
  function geometryDirection(article, log) {
    const bubble = article.querySelector(MP.inbox.messageId) || article;
    return MP.directionFromGeometry(bubble.getBoundingClientRect(), log.getBoundingClientRect());
  }

  function readRows(scope, area, contactName = "") {
    const log = (scope || document).querySelector(MP.inbox.log);
    // 1.9.1: com role=log, SÓ ele conta (mensagem = data-message-id). A leitura pela geometria (que pegava o painel de
    // respostas rápidas e avisos do sistema como mensagem do cliente) fica só para a tela sem role=log.
    if (log) return MP.readLogRows(log, { contactName, directionOf: (article) => geometryDirection(article, log), attachmentsOf: bubbleAttachments });
    return area ? visibleRows(area, contactName).filter((row) => !MP.isSystemMessage(row.body)) : [];
  }

  async function closeChatWindow(win) {
    if (!win) return;
    const button = [...win.querySelectorAll('[role="button"], [aria-label]')].find((element) => visible(element) && MP.matchesAny(element.getAttribute?.("aria-label"), MP.inbox.closeLabels, true))
      || MP.chatCloseButtons(win).find(visible);
    if (button) await clickElement(button);
  }

  function scroller(area) {
    let node = area;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 20) return node;
      node = node.parentElement;
    }
    return area;
  }

  // Mensagens da conversa aberta, com lado pela geometria. full=true (1ª vez que a conversa é vista): sobe até o
  // início (o Messenger carrega aos poucos) e desce juntando tudo — histórico completo (dono, 2026-10-20).
  // Endereço direto da conversa (1.9.2): a rota atual, se for /marketplace/t/… ou /messages/t/…, ou um link assim dentro
  // da janela (cabeçalho "Abrir no Messenger"). O CRM guarda e o envio abre por ele, sem clicar na lista.
  function conversationUrl(scope) {
    const absolute = (href) => {
      try {
        const url = new URL(href, location.origin);
        return url.origin === "https://www.facebook.com" && /^\/(marketplace\/t|messages\/t|t)\/[A-Za-z0-9_.:-]+/.test(url.pathname) ? `${url.origin}${url.pathname}` : "";
      } catch {
        return "";
      }
    };
    const fromRoute = absolute(location.href);
    if (fromRoute) return fromRoute;
    for (const link of (scope || document).querySelectorAll?.('a[href*="/messages/t/"], a[href*="/marketplace/t/"]') || []) {
      const url = absolute(link.getAttribute("href"));
      if (url) return url;
    }
    return "";
  }

  // maxMs (1.8.7): prazo da leitura dado pelo background; a rolagem para antes dele e devolve o que juntou.
  async function readThread(threadKey, full = false, contactName = "", maxMs = 0) {
    const deadline = maxMs > 0 ? Date.now() + maxMs : Infinity;
    // Janela flutuante (caminho do Messenger) ou, se não houver, a área principal da página da conversa.
    const win = await waitFor(() => chatWindow(contactName) || chatWindow(), 15000);
    const scope = win || document;
    const log = scope.querySelector?.(MP.inbox.log) || null;
    const area = log || (win ? scroller(win.querySelector(MP.inbox.messageRows)?.parentElement || win) : document.querySelector(MP.inbox.messageArea));
    const bodyText = String(scope.innerText || document.body?.innerText || "").slice(0, 20000);
    if (MP.matchesAny(bodyText, MP.inbox.pinTexts) && (!area || !readRows(scope, area, contactName).length)) {
      await closeChatWindow(win);
      return { ok: false, error: "Restaure o histórico com o PIN do Messenger (a conversa está criptografada e sem mensagens).", checkpoint: pageCheckpoint() };
    }
    if (!area) return { ok: false, error: `Janela/área de mensagens não encontrada (${location.pathname}; janelas com campo "Aa": ${document.querySelectorAll(MP.inbox.composer).length}).`, checkpoint: pageCheckpoint() };
    await sleep(between(1200, 2200));
    let rows = readRows(scope, area, contactName);
    if (full) {
      const box = scroller(area);
      // Sobe até parar de carregar (máx. 60 voltas).
      for (let i = 0, lastHeight = -1, still = 0; i < 60 && still < 3 && Date.now() < deadline - 60000; i += 1) {
        box.scrollTop = 0;
        await sleep(between(900, 1500));
        still = box.scrollHeight === lastHeight ? still + 1 : 0;
        lastHeight = box.scrollHeight;
      }
      // Desce juntando as janelas.
      rows = readRows(scope, area, contactName);
      for (let i = 0; i < 200 && box.scrollTop + box.clientHeight < box.scrollHeight - 5 && Date.now() < deadline - 5000; i += 1) {
        box.scrollTop += Math.max(200, box.clientHeight * 0.8);
        await sleep(between(250, 450));
        rows = MP.mergeRowWindows(rows, readRows(scope, area, contactName));
      }
      rows = MP.mergeRowWindows(rows, readRows(scope, area, contactName));
    }
    const listing = scope.querySelector?.(MP.listingLink) || document.querySelector(MP.listingLink);
    const threadUrl = conversationUrl(scope);
    // 1.8.9: linhas lidas mas nenhuma mensagem válida (tudo texto do sistema/vazio) é FALHA — antes ia ao CRM uma
    // conversa sem mensagens e a prévia era guardada (o histórico nunca mais era lido).
    const messages = rows.length ? MP.buildMessages(threadKey, rows).slice(full ? -500 : -60) : [];
    const result = messages.length
      ? { ok: true, listingUrl: listing ? MP.cleanListingUrl(listing.href || listing.getAttribute("href")) : "", threadUrl, messages, checkpoint: pageCheckpoint() }
      : { ok: false, error: `Conversa aberta, mas nenhuma mensagem reconhecida (${rows.length} linha(s) lidas, todas descartadas; ${area.querySelectorAll(MP.inbox.article).length} article, ${area.querySelectorAll(MP.inbox.messageId).length} data-message-id, ${area.querySelectorAll(MP.inbox.messageRows).length} linhas, ${area.querySelectorAll(MP.inbox.messageText).length} textos na área; seletores a calibrar).`, checkpoint: pageCheckpoint() };
    await closeChatWindow(win); // não acumula janelas abertas
    return result;
  }

  async function trusted(action, payload = {}) {
    try {
      return Boolean((await chrome.runtime.sendMessage({ type: "mp-trusted", action, ...payload }))?.ok);
    } catch {
      return false;
    }
  }

  // Quantas mensagens NOSSAS (saída ou rótulo "por Você"/"by You") contêm o texto, nas últimas 15 da conversa.
  function ownMessagesWith(target, win = null) {
    if (!target) return 0;
    const log = (win || document).querySelector(MP.inbox.log);
    const rows = log ? MP.readLogRows(log, { directionOf: (article) => geometryDirection(article, log) }) : [];
    const own = (row) => row.direction === "outbound" || /\b(por voce|by you)\b/.test(MP.normalize(row.body));
    const found = rows.slice(-15).filter((row) => own(row) && MP.normalize(row.body).includes(target)).length;
    return found || lastOutboundTexts(5, win).filter((text) => text.includes(target)).length;
  }

  function lastOutboundTexts(count = 3, win = null) {
    const log = (win || document).querySelector(MP.inbox.log);
    if (log) {
      const rows = MP.readLogRows(log, { directionOf: (article) => geometryDirection(article, log) });
      if (rows.length) return rows.filter((row) => row.direction === "outbound").slice(-count).map((row) => MP.normalize(row.body));
    }
    const area = win || document.querySelector(MP.inbox.messageArea);
    if (!area) return [];
    const areaRect = area.getBoundingClientRect();
    return [...area.querySelectorAll(MP.inbox.messageText)]
      .filter((node) => node.innerText?.trim() && MP.directionFromGeometry(node.getBoundingClientRect(), areaRect) === "outbound")
      .slice(-count)
      .map((node) => MP.normalize(node.innerText));
  }

  // Envia UMA resposta. sentAttempted=true a partir do Enter (o background não tenta de novo depois disso).
  async function sendText(text) {
    if (pageCheckpoint()) return { ok: false, checkpoint: true, sentAttempted: false, error: "O Facebook mostrou verificação/limite." };
    // Campo "Aa" da janela de chat aberta (ou da página da conversa).
    const win = await waitFor(() => chatWindow(), 15000);
    const composer = await waitFor(() => [...(win || document).querySelectorAll(MP.inbox.composer)].find((element) => visible(element)), 15000);
    if (!composer) return { ok: false, sentAttempted: false, error: "Campo de mensagem não encontrado." };
    composer.scrollIntoView({ block: "center" });
    await sleep(between(300, 600));
    const rect = composer.getBoundingClientRect();
    if (!(await trusted("click", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }))) composer.focus();
    await sleep(between(300, 700));
    // Quebra de linha vira Shift+Enter no Messenger; para não arriscar envio parcial, junta as linhas com espaço.
    const flat = String(text).replace(/\s*\n+\s*/g, " ").trim();
    for (const chunk of flat.match(/.{1,12}/gs) || []) {
      if (!(await trusted("text", { text: chunk }))) document.execCommand("insertText", false, chunk);
      await sleep(between(80, 260));
    }
    await sleep(between(400, 900));
    const target = MP.normalize(flat).slice(0, 40);
    const seenBefore = ownMessagesWith(target, win);
    if (!(await trusted("key", { key: "Enter" }))) return { ok: false, sentAttempted: false, error: "Depurador desligado: não envio com eventos simulados." };
    // 1.9.2: confirma pela própria mensagem na conversa (texto igual, "por Você"/saída), não só pelas 3 últimas de saída
    // (a direção às vezes vinha errada e dava "Não confirmei" para mensagem que saiu). Até 30 s; depois relê uma vez.
    let confirmed = await waitFor(() => ownMessagesWith(target, win) > seenBefore || null, 30000, 700);
    if (!confirmed) {
      await sleep(4000);
      confirmed = ownMessagesWith(target, win) > seenBefore || ownMessagesWith(target, null) > seenBefore;
    }
    if (pageCheckpoint()) return { ok: false, checkpoint: true, sentAttempted: true, error: "O Facebook mostrou verificação/limite depois do envio." };
    await closeChatWindow(win); // não acumula janelas abertas
    // Sem confirmação: unconfirmed — o CRM não reenvia sozinho; confirma pelo eco na próxima leitura da conversa.
    return confirmed ? { ok: true, sentAttempted: true } : { ok: false, sentAttempted: true, unconfirmed: true, error: "Não confirmei a mensagem na conversa (confira no Facebook)." };
  }

  // --- Diagnóstico de estrutura (1.8.5) ---------------------------------------------------------------------------
  // Esqueleto do DOM da região da lista: tag, role, aria-label mascarado, tabindex, caminho do link, nomes de data-*,
  // texto próprio mascarado (MP.skeletonText) e filhos. Nunca classes, nomes ou mensagens reais.
  function ownText(element) {
    return [...(element.childNodes || [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ").trim();
  }

  function skeleton(element, depth, budget) {
    if (!element || budget.left <= 0 || depth > 25) return null;
    budget.left -= 1;
    const node = { t: String(element.tagName || "").toLowerCase() };
    const role = element.getAttribute?.("role");
    const label = element.getAttribute?.("aria-label");
    const tabindex = element.getAttribute?.("tabindex");
    const href = element.getAttribute?.("href");
    if (role) node.r = role;
    if (label) node.a = MP.skeletonText(label);
    if (tabindex !== null && tabindex !== undefined) node.ti = tabindex;
    if (href) node.h = MP.skeletonPath(href);
    const dataNames = [...(element.attributes || [])].map((attr) => attr.name).filter((name) => name.startsWith("data-"));
    if (dataNames.length) node.d = dataNames;
    const text = MP.skeletonText(ownText(element));
    if (text) node.x = text;
    if (node.t === "img" || node.t === "image") {
      const rect = element.getBoundingClientRect?.();
      if (rect) node.wh = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }
    const children = [];
    for (const child of element.children || []) {
      const built = skeleton(child, depth + 1, budget);
      if (built) children.push(built);
      if (budget.left <= 0) break;
    }
    if (children.length) node.c = children;
    return node;
  }

  // Raiz: ancestral comum dos textos com " · " (as conversas); sem eles, role="main"; senão o body.
  function diagnosticRoot() {
    const holders = [...document.querySelectorAll("span, div, a")].filter((element) => ownText(element).includes(" · ")).slice(0, 20);
    if (holders.length >= 2) {
      let root = holders[0];
      while (root && !holders.every((holder) => root.contains(holder))) root = root.parentElement;
      if (root) return { root, how: `ancestral de ${holders.length} textos " · "` };
    }
    const main = document.querySelector('[role="main"]');
    return main ? { root: main, how: holders.length ? "role=main (1 texto · )" : "role=main (nenhum texto · )" } : { root: document.body, how: "body" };
  }

  async function diagnose(stage) {
    const steps = [];
    if (stage === "messenger_panel") await openMarketplaceFromMessenger(steps);
    // Espera a lista renderizar (aparece texto com " · ") até 15 s.
    await waitFor(() => [...document.querySelectorAll("span, div, a")].some((element) => ownText(element).includes(" · ")) || null, 15000, 700);
    const { root, how } = diagnosticRoot();
    const budget = { left: 3000 };
    return {
      stage,
      path: MP.skeletonPath(location.href),
      how,
      steps,
      counts: { dots: [...document.querySelectorAll("span, div, a")].filter((element) => ownText(element).includes(" · ")).length, imgs: document.querySelectorAll("img").length, dialogs: document.querySelectorAll('[role="dialog"]').length, textboxes: document.querySelectorAll('[role="textbox"]').length },
      tree: skeleton(root, 0, budget),
      truncated: budget.left <= 0
    };
  }

  // Diagnóstico "inbox_list" (1.8.6): ancorado em role=main e nos clicáveis COM miniatura (sem depender de " · "),
  // depois de fechar janelas de chat. Mesmo mascaramento do esqueleto acima (nunca nome nem mensagem real).
  async function diagnoseList() {
    const steps = [];
    const closed = await closeOpenChats();
    steps.push(`janelas de chat fechadas: ${closed}`);
    await waitFor(() => document.querySelector('[role="main"] img, [role="main"] image') || null, 15000, 700);
    await sleep(1500);
    const main = listRoot() === document ? document.body : listRoot();
    const clickables = [...main.querySelectorAll(MP.inbox.clickables)].filter(visible);
    const withThumb = clickables.filter((element) => element.querySelector("img, image"));
    // Prioriza os do tamanho de um item: os que não contêm 2+ outros clicáveis com miniatura.
    const itemLike = withThumb.filter((element) => withThumb.filter((other) => other !== element && element.contains(other)).length < 2);
    const items = itemLike.slice(0, 25).map((element) => {
      const leaves = MP.textLeaves(element);
      const budget = { left: 150 };
      return {
        leaves: leaves.length,
        dotLeaf: leaves.some((text) => /(^|\s)·(\s|$)/.test(text)),
        parsed: Boolean(MP.parseInboxLeaves(leaves)),
        inChatPane: MP.chatPanes(document).some((pane) => pane.contains(element)),
        tree: skeleton(element, 0, budget)
      };
    });
    const budget = { left: 1500 };
    return {
      stage: "inbox_list",
      path: MP.skeletonPath(location.href),
      how: main === document.body ? "body (sem role=main)" : "role=main",
      steps,
      counts: {
        mains: document.querySelectorAll('[role="main"]').length,
        clickables: clickables.length,
        withThumb: withThumb.length,
        itemLike: itemLike.length,
        dotLeaf: items.filter((item) => item.dotLeaf).length,
        items: findItemElements(main).length,
        chatPanes: MP.chatPanes(document).length,
        imgs: main.querySelectorAll("img").length
      },
      items,
      tree: skeleton(main, 0, budget),
      truncated: budget.left <= 0
    };
  }

  // 1.8.9: um único despachante. O background chama `globalThis.__mpInbox.handle(msg)` por
  // chrome.scripting.executeScript (o valor volta direto; exceção vira { ok:false, error, stack } — nunca fica sem
  // resposta). O listener de mensagem continua (testes e compatibilidade).
  function handle(message) {
    switch (message?.type) {
      case "mp-inbox-list":
        return listThreads().catch((error) => ({ threads: [], steps: [`erro ao listar: ${error.message}`], url: location.href, error: error.message, stack: String(error.stack || "").slice(0, 1500) }));
      case "mp-inbox-diagnose":
        return message.stage === "inbox_list" ? diagnoseList() : diagnose(message.stage);
      case "mp-inbox-open":
        return openItem(message.threadKey, message.contactName || "", Number(message.openWaitMs) || OPEN_WAIT_MS);
      case "mp-inbox-prepare-open":
        return prepareOpen(message.threadKey, message.contactName || "");
      case "mp-inbox-open-state":
        return openState(message.contactName || "");
      case "mp-inbox-open-diagnostic":
        return { ...openDiagnostic({ before: message.before || "", clicked: pendingItem, waitedMs: Number(message.waitedMs) || 0, stage: message.stage || "sem_painel" }), attrNames: pendingItem ? itemAttributes(pendingItem.element).names : [] };
      case "mp-inbox-open-read":
        return openAndRead(message);
      case "mp-inbox-read":
        return readThread(message.threadKey, message.full === true, message.contactName || "", Number(message.maxMs) || 0);
      case "mp-inbox-send":
        return sendText(message.text);
      default:
        return null;
    }
  }
  const failure = (error) => ({ ok: false, error: String(error?.message || error), stack: String(error?.stack || "").slice(0, 1500) });
  globalThis.__mpInbox = { handle: (message) => Promise.resolve().then(() => handle(message)).catch(failure) };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!String(message?.type || "").startsWith("mp-inbox-")) return false;
    globalThis.__mpInbox.handle(message).then(sendResponse);
    return true;
  });
})();
