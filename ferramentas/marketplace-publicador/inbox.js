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

  // Lê os itens "Nome · Anúncio" dentro de `root` (a página da caixa ou o painel "← Marketplace"). Só itens nesse
  // formato entram: conversas pessoais (sem " · anúncio") nunca são lidas.
  function collectItems(root) {
    const byKey = new Map();
    for (const element of root.querySelectorAll(MP.inbox.listItems)) {
      if (!visible(element)) continue;
      const parsed = MP.parseInboxItem(itemLines(element));
      if (!parsed) continue;
      const link = element.matches?.("a") ? element : element.querySelector?.("a[href]");
      const href = link?.getAttribute("href") || "";
      const threadKey = MP.parseThreadKey(href) || MP.itemKey(parsed.contactName, parsed.listingTitle);
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
    return [...document.querySelectorAll('[role="dialog"], [role="complementary"]')].find((element) => visible(element) && MP.matchesAny(itemLines(element)[0], MP.inbox.marketplaceEntryTexts)) || null;
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
  async function listThreads() {
    const steps = [];
    // A página inteira só é lida quando é a caixa do Marketplace (nunca o feed nem o Messenger geral).
    const onInbox = location.pathname.startsWith("/marketplace/inbox");
    if (onInbox) await waitFor(() => collectItems(document).length || null, 12000, 800);
    let threads = onInbox ? collectItems(document) : [];
    steps.push(`página ${location.pathname}: ${threads.length} item(ns)`);
    if (!threads.length) {
      const root = await openMarketplaceFromMessenger(steps);
      if (root) {
        await waitFor(() => collectItems(root).length || null, 10000, 800);
        threads = collectItems(root);
        steps.push(`painel Marketplace: ${threads.length} item(ns)`);
      }
    }
    return { threads: threads.slice(0, 40), checkpoint: pageCheckpoint(), url: location.href, steps };
  }

  // Abre a conversa clicando no item (quando não há link): a janela de chat abre na mesma página.
  async function openItem(threadKey) {
    const root = document;
    for (const element of root.querySelectorAll(MP.inbox.listItems)) {
      if (!visible(element)) continue;
      const parsed = MP.parseInboxItem(itemLines(element));
      if (parsed && MP.itemKey(parsed.contactName, parsed.listingTitle) === threadKey) {
        await clickElement(element);
        await sleep(between(1500, 2500));
        return { ok: true };
      }
    }
    return { ok: false, error: "Item da conversa não encontrado na lista." };
  }

  function bubbleAttachments(row) {
    return [...row.querySelectorAll("img")]
      .filter((img) => (img.naturalWidth || img.width || 0) >= 80 && /^https:/.test(img.src))
      .map((img) => ({ type: "image", url: img.src, name: "" }))
      .slice(0, 5);
  }

  function visibleRows(area) {
    const areaRect = area.getBoundingClientRect();
    const rows = [];
    for (const row of area.querySelectorAll(MP.inbox.messageRows)) {
      const textNode = [...row.querySelectorAll(MP.inbox.messageText)].find((node) => node.innerText?.trim());
      const body = textNode ? textNode.innerText.trim() : "";
      const attachments = bubbleAttachments(row);
      if (!body && !attachments.length) continue;
      const bubble = (textNode || row).getBoundingClientRect();
      rows.push({ direction: MP.directionFromGeometry(bubble, areaRect), body, attachments });
    }
    return rows;
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
  async function readThread(threadKey, full = false) {
    const area = await waitFor(() => document.querySelector(MP.inbox.messageArea), 15000);
    const bodyText = document.body ? document.body.innerText.slice(0, 20000) : "";
    if (MP.matchesAny(bodyText, MP.inbox.pinTexts) && (!area || !visibleRows(area).length)) {
      return { ok: false, error: "Restaure o histórico com o PIN do Messenger (a conversa está criptografada e sem mensagens).", checkpoint: pageCheckpoint() };
    }
    if (!area) return { ok: false, error: `Área de mensagens não encontrada (${location.pathname}; diálogos: ${document.querySelectorAll('[role="dialog"]').length}).`, checkpoint: pageCheckpoint() };
    await sleep(between(1200, 2200));
    let rows = visibleRows(area);
    if (full) {
      const box = scroller(area);
      // Sobe até parar de carregar (máx. 60 voltas).
      for (let i = 0, lastHeight = -1, still = 0; i < 60 && still < 3; i += 1) {
        box.scrollTop = 0;
        await sleep(between(900, 1500));
        still = box.scrollHeight === lastHeight ? still + 1 : 0;
        lastHeight = box.scrollHeight;
      }
      // Desce juntando as janelas.
      rows = visibleRows(area);
      for (let i = 0; i < 200 && box.scrollTop + box.clientHeight < box.scrollHeight - 5; i += 1) {
        box.scrollTop += Math.max(200, box.clientHeight * 0.8);
        await sleep(between(250, 450));
        rows = MP.mergeRowWindows(rows, visibleRows(area));
      }
      rows = MP.mergeRowWindows(rows, visibleRows(area));
    }
    const listing = document.querySelector(MP.listingLink);
    if (!rows.length) return { ok: false, error: `Conversa aberta, mas nenhuma mensagem reconhecida (${area.querySelectorAll(MP.inbox.messageRows).length} linhas na área; seletores a calibrar).`, checkpoint: pageCheckpoint() };
    return {
      ok: true,
      listingUrl: listing ? MP.cleanListingUrl(listing.href) : "",
      messages: full ? MP.buildMessages(threadKey, rows).slice(-500) : MP.buildMessages(threadKey, rows).slice(-60),
      checkpoint: pageCheckpoint()
    };
  }

  async function trusted(action, payload = {}) {
    try {
      return Boolean((await chrome.runtime.sendMessage({ type: "mp-trusted", action, ...payload }))?.ok);
    } catch {
      return false;
    }
  }

  function lastOutboundTexts(count = 3) {
    const area = document.querySelector(MP.inbox.messageArea);
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
    const composer = await waitFor(() => [...document.querySelectorAll(MP.inbox.composer)].find((element) => visible(element) && (MP.matchesAny(element.getAttribute("aria-label"), MP.inbox.composerLabels) || MP.matchesAny(element.getAttribute("aria-placeholder"), MP.inbox.composerLabels) || true)), 15000);
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
    const before = lastOutboundTexts().join("|");
    if (!(await trusted("key", { key: "Enter" }))) return { ok: false, sentAttempted: false, error: "Depurador desligado: não envio com eventos simulados." };
    const target = MP.normalize(flat);
    const confirmed = await waitFor(() => {
      const after = lastOutboundTexts();
      return after.join("|") !== before && after.some((item) => item === target || item.includes(target.slice(0, 40)));
    }, 15000, 700);
    if (pageCheckpoint()) return { ok: false, checkpoint: true, sentAttempted: true, error: "O Facebook mostrou verificação/limite depois do envio." };
    return confirmed ? { ok: true, sentAttempted: true } : { ok: false, sentAttempted: true, error: "Não confirmei a mensagem na conversa (confira no Facebook)." };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "mp-inbox-list") {
      listThreads().then(sendResponse);
      return true;
    }
    if (message?.type === "mp-inbox-open") {
      openItem(message.threadKey).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-inbox-read") {
      readThread(message.threadKey, message.full === true).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-inbox-send") {
      sendText(message.text).then(sendResponse);
      return true;
    }
    return false;
  });
})();
