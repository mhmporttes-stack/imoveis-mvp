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

  // Lista da caixa do Marketplace: uma entrada por conversa (link), com nome, foto, anúncio e prévia.
  async function listThreads() {
    await waitFor(() => document.querySelector(MP.inbox.threadLinks), 15000);
    const byKey = new Map();
    for (const link of document.querySelectorAll(MP.inbox.threadLinks)) {
      const threadKey = MP.parseThreadKey(link.getAttribute("href") || "");
      if (!threadKey || byKey.has(threadKey) || !visible(link)) continue;
      const lines = String(link.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
      const photo = link.querySelector("img, image");
      byKey.set(threadKey, {
        threadKey,
        threadUrl: new URL(link.getAttribute("href"), location.origin).toString(),
        // Na caixa do Marketplace a 1ª linha costuma ser "Nome · Título do anúncio"; a última, a prévia.
        contactName: (lines[0] || "").split(" · ")[0],
        listingTitle: (lines[0] || "").split(" · ").slice(1).join(" · ") || lines[1] || "",
        preview: lines[lines.length - 1] || "",
        // Rótulo de tempo da linha ("2 h", "14:32", "3 d") → hora aproximada da última atividade.
        lastActivityAt: lines.map((line) => MP.parseRelativeTime(line.split(" · ").pop())).find(Boolean) || null,
        unread: /font-weight:\s*(6|7|8|9)00|bold/i.test(link.innerHTML.slice(0, 2000)),
        contactPhotoUrl: photo?.getAttribute("src") || photo?.getAttribute("xlink:href") || ""
      });
    }
    return { threads: [...byKey.values()].slice(0, 40), checkpoint: pageCheckpoint(), url: location.href };
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
    if (!area) return { ok: false, error: "Área de mensagens não encontrada.", checkpoint: pageCheckpoint() };
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
