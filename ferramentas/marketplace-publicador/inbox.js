// Chat do Marketplace (MKT-2): roda na aba dedicada do Facebook, injetado depois de selectors.js. Lê SÓ a caixa de
// entrada do Marketplace e as conversas listadas nela; envia a resposta digitada no CRM com teclas reais (o background
// liga o chrome.debugger). Seletores em selectors.js (MP.inbox) — A CALIBRAR com a caixa real do dono.

(function marketplaceInbox() {
  if (globalThis.__mpInboxLoaded) return;
  globalThis.__mpInboxLoaded = true;
  const MP = globalThis.MP;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  // Abre a conversa clicando no item (quando não há link): a janela de chat abre na mesma página. A lista carrega aos
  // poucos: rola até achar o item.
  async function openItem(threadKey) {
    await closeOpenChats();
    const root = listRoot();
    const box = scrollableIn(root);
    for (let i = 0; i < 20; i += 1) {
      const item = findItemElements(root).find((candidate) => candidate.threadKey === threadKey);
      if (item) {
        const before = location.href;
        await clickElement(item.element);
        await sleep(between(1500, 2500));
        // O clique pode abrir a janela flutuante (mesma página) ou navegar para /messages/t/… (o background reinjeta).
        return { ok: true, navigated: location.href !== before };
      }
      if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 5) break;
      box.scrollTop += Math.max(300, box.clientHeight * 0.8);
      await sleep(between(900, 1500));
    }
    return { ok: false, error: `Item da conversa não encontrado na lista (${findItemElements(root).length} itens visíveis).` };
  }

  function bubbleAttachments(row) {
    return [...row.querySelectorAll("img")]
      .filter((img) => (img.naturalWidth || img.width || 0) >= 80 && /^https:/.test(img.src))
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
    for (const row of nodes) {
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
    if (log) {
      const rows = MP.readLogRows(log, { contactName, directionOf: (article) => geometryDirection(article, log), attachmentsOf: bubbleAttachments });
      if (rows.length) return rows;
    }
    return area ? visibleRows(area, contactName) : [];
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
    const result = rows.length
      ? { ok: true, listingUrl: listing ? MP.cleanListingUrl(listing.href || listing.getAttribute("href")) : "", messages: MP.buildMessages(threadKey, rows).slice(full ? -500 : -60), checkpoint: pageCheckpoint() }
      : { ok: false, error: `Conversa aberta, mas nenhuma mensagem reconhecida (${area.querySelectorAll(MP.inbox.article).length} article, ${area.querySelectorAll(MP.inbox.messageId).length} data-message-id, ${area.querySelectorAll(MP.inbox.messageRows).length} linhas, ${area.querySelectorAll(MP.inbox.messageText).length} textos na área; seletores a calibrar).`, checkpoint: pageCheckpoint() };
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
    const before = lastOutboundTexts(3, win).join("|");
    if (!(await trusted("key", { key: "Enter" }))) return { ok: false, sentAttempted: false, error: "Depurador desligado: não envio com eventos simulados." };
    const target = MP.normalize(flat);
    const confirmed = await waitFor(() => {
      const after = lastOutboundTexts(3, win);
      return after.join("|") !== before && after.some((item) => item === target || item.includes(target.slice(0, 40)));
    }, 15000, 700);
    if (pageCheckpoint()) return { ok: false, checkpoint: true, sentAttempted: true, error: "O Facebook mostrou verificação/limite depois do envio." };
    await closeChatWindow(win); // não acumula janelas abertas
    return confirmed ? { ok: true, sentAttempted: true } : { ok: false, sentAttempted: true, error: "Não confirmei a mensagem na conversa (confira no Facebook)." };
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "mp-inbox-list") {
      listThreads().then(sendResponse, (error) => sendResponse({ threads: [], steps: [`erro ao listar: ${error.message}`], url: location.href }));
      return true;
    }
    if (message?.type === "mp-inbox-diagnose") {
      (message.stage === "inbox_list" ? diagnoseList() : diagnose(message.stage)).then(sendResponse, (error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message?.type === "mp-inbox-open") {
      openItem(message.threadKey).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-inbox-read") {
      readThread(message.threadKey, message.full === true, message.contactName || "", Number(message.maxMs) || 0).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "mp-inbox-send") {
      sendText(message.text).then(sendResponse);
      return true;
    }
    return false;
  });
})();
