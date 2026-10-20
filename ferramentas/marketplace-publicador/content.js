// Roda DENTRO da aba do Facebook (injetado pelo background depois de selectors.js). Preenche e publica UM anúncio.
// Toda referência a texto/rótulo do Facebook vem de selectors.js (objeto MP). Nunca tenta de novo sozinho:
// qualquer passo não encontrado devolve { ok: false, step, error } e o background decide.

(function marketplaceContent() {
  if (globalThis.__mpContentLoaded) return;
  globalThis.__mpContentLoaded = true;
  const MP = globalThis.MP;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const humanPause = () => sleep(between(600, 1800));

  class StepError extends Error {
    constructor(step, message, extra = {}) {
      super(message);
      this.step = step;
      Object.assign(this, extra);
    }
  }

  let currentStep = "início";
  function progress(step) {
    currentStep = step;
    // Também mantém o service worker acordado durante a publicação.
    chrome.runtime.sendMessage({ type: "mp-progress", step }).catch(() => {});
  }

  function pageText() {
    return document.body ? document.body.innerText.slice(0, 20000) : "";
  }

  function assertNoCheckpoint() {
    if (MP.isCheckpoint(location.href, pageText())) throw new StepError(currentStep, "O Facebook mostrou verificação, bloqueio ou limite.", { checkpoint: true });
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  async function waitFor(finder, timeoutMs = 15000, intervalMs = 400) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = finder();
      if (found) return found;
      await sleep(intervalMs);
    }
    return null;
  }

  const CONTROL = 'input:not([type="hidden"]):not([type="file"]), textarea, [role="combobox"], [aria-haspopup="listbox"], [contenteditable="true"]';

  // Acha o campo pelo rótulo: aria-label → <label> com o texto → aria-labelledby → texto próximo.
  function findControl(labels) {
    const controls = [...document.querySelectorAll(CONTROL)].filter(visible);
    for (const exact of [true, false]) {
      const byAria = controls.find((element) => MP.matchesAny(element.getAttribute("aria-label"), labels, exact));
      if (byAria) return byAria;
      for (const label of document.querySelectorAll("label")) {
        if (!visible(label) || !MP.matchesAny(label.innerText, labels, exact)) continue;
        const inside = label.querySelector(CONTROL);
        if (inside) return inside;
        const forId = label.getAttribute("for");
        if (forId && document.getElementById(forId)) return document.getElementById(forId);
      }
      const byLabelledBy = controls.find((element) => {
        const ids = String(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
        return ids.some((id) => MP.matchesAny(document.getElementById(id)?.innerText, labels, exact));
      });
      if (byLabelledBy) return byLabelledBy;
      if (exact) {
        const caption = [...document.querySelectorAll("span, div")].find((element) => element.childElementCount === 0 && visible(element) && MP.matchesAny(element.innerText, labels, true));
        const container = caption?.closest("label, [role='group'], [data-visualcompletion]") || caption?.parentElement?.parentElement;
        const near = container?.querySelector(CONTROL);
        if (near) return near;
      }
    }
    return null;
  }

  function findClickable(texts, exact = true) {
    const candidates = [...document.querySelectorAll('[role="button"], button, a[role="link"], a, [role="option"], [tabindex="0"]')].filter(visible);
    return candidates.find((element) => element.getAttribute("aria-disabled") !== "true" && (MP.matchesAny(element.getAttribute("aria-label"), texts, exact) || MP.matchesAny(element.innerText, texts, exact)));
  }

  async function humanClick(element) {
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(between(250, 700));
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      await sleep(between(15, 60));
    }
    element.click();
    await sleep(between(400, 1000));
  }

  function setNativeValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Digitação em ritmo humano: 1 caractere por vez, com pausas aleatórias e pausas maiores de vez em quando.
  async function humanType(element, text) {
    await humanClick(element);
    element.focus();
    const value = String(text ?? "");
    for (const char of value) {
      const before = element.value ?? element.innerText;
      const inserted = document.execCommand("insertText", false, char);
      if (!inserted || (element.value ?? element.innerText) === before) {
        if ("value" in element) setNativeValue(element, `${element.value}${char}`);
      }
      await sleep(char === " " ? between(80, 220) : between(55, 170));
      if (Math.random() < 0.04) await sleep(between(400, 1100));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await humanPause();
  }

  async function fillText(fieldKey, value) {
    if (value === null || value === undefined || value === "") return;
    const field = MP.fields[fieldKey];
    progress(`campo ${fieldKey}`);
    const control = await waitFor(() => findControl(field.labels), 8000);
    if (!control) {
      if (field.optional) return;
      throw new StepError(currentStep, `Campo "${field.labels[0]}" não encontrado.`);
    }
    await humanType(control, value);
  }

  async function chooseOption(fieldKey, optionKey) {
    const field = MP.fields[fieldKey];
    progress(`campo ${fieldKey}`);
    const control = await waitFor(() => findControl(field.labels), 8000);
    if (!control) throw new StepError(currentStep, `Lista "${field.labels[0]}" não encontrada.`);
    await humanClick(control);
    const texts = field.options[optionKey] || [];
    const option = await waitFor(() => {
      const options = [...document.querySelectorAll(MP.optionRoles)].filter(visible);
      return options.find((element) => MP.matchesAny(element.innerText, texts, true)) || options.find((element) => MP.matchesAny(element.innerText, texts));
    }, 6000);
    if (!option) throw new StepError(currentStep, `Opção "${texts[0]}" não apareceu em "${field.labels[0]}".`);
    await humanClick(option);
  }

  async function fillLocation(listing) {
    const field = MP.fields.location;
    progress("localização");
    const control = await waitFor(() => findControl(field.labels), 8000);
    if (!control) throw new StepError(currentStep, "Campo de localização não encontrado.");
    if ("value" in control && control.value) setNativeValue(control, "");
    await humanType(control, `${listing.city}, ${listing.state}`);
    const option = await waitFor(() => {
      const options = [...document.querySelectorAll('[role="option"], [role="listbox"] li')].filter(visible);
      return options.find((element) => MP.matchesAny(element.innerText, [listing.city])) || null;
    }, 8000);
    if (!option) throw new StepError(currentStep, `O Facebook não sugeriu "${listing.city}" na localização.`);
    await humanClick(option);
  }

  async function uploadPhotos(photos) {
    progress("fotos");
    const input = await waitFor(() => document.querySelector(MP.photoInput), 10000);
    if (!input) throw new StepError(currentStep, "Campo de fotos não encontrado.");
    const transfer = new DataTransfer();
    for (const photo of photos) {
      const bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], photo.name, { type: photo.type }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(between(3000, 5000) + photos.length * 700);
  }

  async function openPropertyCategory() {
    progress("categoria do imóvel");
    if (location.pathname.startsWith("/marketplace/create/rental")) return;
    const card = await waitFor(() => findClickable(MP.categoryCard, false), 10000);
    if (card) {
      await humanClick(card);
      await sleep(between(2000, 3500));
      return;
    }
    location.assign(MP.urls.createProperty);
    throw new StepError(currentStep, "Cartão da categoria não encontrado; a aba foi enviada para o formulário direto.", { navigated: true });
  }

  function descriptionWithNeighborhood(listing) {
    const description = String(listing.description || "");
    if (!listing.neighborhood || MP.normalize(description).includes(MP.normalize(listing.neighborhood))) return description;
    return `Bairro ${listing.neighborhood} — ${listing.city}/${listing.state}\n\n${description}`;
  }

  async function publish(listing, photos) {
    let clickedPublish = false;
    try {
      await sleep(between(2500, 4500));
      assertNoCheckpoint();
      await openPropertyCategory();
      assertNoCheckpoint();
      await uploadPhotos(photos);
      await chooseOption("offerType", listing.offerType);
      await chooseOption("propertyType", listing.propertyType);
      await fillText("title", listing.title);
      await fillText("bedrooms", listing.bedrooms);
      await fillText("bathrooms", listing.bathrooms);
      await fillText("price", String(Math.round(listing.price)));
      await fillLocation(listing);
      await fillText("description", descriptionWithNeighborhood(listing));
      await fillText("area", listing.areaM2 ? String(Math.round(listing.areaM2)) : "");
      assertNoCheckpoint();

      progress("avançar");
      const next = findClickable(MP.buttons.next);
      if (next) {
        await humanClick(next);
        await sleep(between(2000, 4000));
        assertNoCheckpoint();
      }

      progress("publicar");
      const publishButton = await waitFor(() => findClickable(MP.buttons.publish), 10000);
      if (!publishButton) throw new StepError(currentStep, "Botão Publicar não encontrado (algum campo obrigatório pode ter ficado vazio).");
      await humanPause();
      clickedPublish = true;
      await humanClick(publishButton);

      progress("confirmação");
      const startPath = location.pathname;
      await waitFor(() => location.pathname !== startPath || MP.isCheckpoint(location.href, pageText()), 60000, 1000);
      if (MP.isCheckpoint(location.href, pageText())) throw new StepError(currentStep, "Depois de publicar, o Facebook mostrou verificação ou limite.", { checkpoint: true });
      const link = document.querySelector(MP.listingLink);
      const url = MP.cleanListingUrl(location.href) || (link ? MP.cleanListingUrl(link.href) : "");
      return { ok: true, url, clickedPublish, step: currentStep };
    } catch (error) {
      return { ok: false, clickedPublish, step: error.step || currentStep, error: error.message, checkpoint: Boolean(error.checkpoint), navigated: Boolean(error.navigated) };
    }
  }

  // Na página "Seus anúncios": procura o link do anúncio recém-publicado pelo título.
  async function findListingUrl(title) {
    await sleep(between(3000, 5000));
    const link = await waitFor(() => {
      const links = [...document.querySelectorAll(MP.listingLink)];
      return links.find((element) => MP.matchesAny(element.innerText, [title]) || MP.matchesAny(element.getAttribute("aria-label"), [title])) || null;
    }, 20000, 1000);
    return { url: link ? MP.cleanListingUrl(link.href) : "", checkpoint: MP.isCheckpoint(location.href, pageText()) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "mp-publish") {
      publish(message.listing, message.photos).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-find-url") {
      findListingUrl(message.title).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-ping") {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
