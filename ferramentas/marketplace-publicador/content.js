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
      const byAria = controls.find((element) => MP.matchesAny(element.getAttribute("aria-label"), labels, exact) || MP.matchesAny(element.getAttribute("placeholder"), labels, exact));
      if (byAria) return byAria;
      // Combobox sem rótulo (ex.: venda/locação): achado pelo texto que ele mostra.
      const byShownText = controls.find((element) => element.matches('[role="combobox"], [aria-haspopup="listbox"]') && MP.matchesAny(element.innerText, labels, exact));
      if (byShownText) return byShownText;
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

  function matchesClickable(element, texts, exact) {
    return MP.matchesAny(element.getAttribute("aria-label"), texts, exact) || MP.matchesAny(element.innerText, texts, exact);
  }

  // includeDisabled: para esperar o "Avançar" habilitar. Nunca devolve "Salvar rascunho"/"Turbinar".
  function findClickable(texts, exact = true, { includeDisabled = false } = {}) {
    const candidates = [...document.querySelectorAll('[role="button"], button, a[role="link"], a, [role="option"], [tabindex="0"]')].filter(visible);
    return candidates.find(
      (element) =>
        (includeDisabled || (element.getAttribute("aria-disabled") !== "true" && !element.disabled)) &&
        matchesClickable(element, texts, exact) &&
        !matchesClickable(element, MP.buttons.forbidden, false)
    );
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
    if (optionKey === null || optionKey === undefined || optionKey === "") return;
    progress(`campo ${fieldKey}`);
    const control = await waitFor(() => findControl(field.labels), 8000);
    if (!control) {
      if (field.optional) return;
      throw new StepError(currentStep, `Lista "${field.labels[0]}" não encontrada.`);
    }
    await humanClick(control);
    const texts = field.optionsFor ? field.optionsFor(optionKey) : field.options[optionKey] || [];
    const allowed = (element) => !(field.excludeOptions || []).some((part) => ` ${MP.normalize(element.innerText)} `.includes(part.toLowerCase()));
    const option = await waitFor(() => {
      const options = [...document.querySelectorAll(MP.optionRoles)].filter((element) => visible(element) && allowed(element));
      return options.find((element) => MP.matchesAny(element.innerText, texts, true)) || options.find((element) => MP.matchesAny(element.innerText, texts));
    }, 6000);
    if (!option) {
      if (field.optional) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      throw new StepError(currentStep, `Opção "${texts[0]}" não apareceu em "${field.labels[0]}".`);
    }
    await humanClick(option);
  }

  function locationSuggestion(city) {
    const options = [...document.querySelectorAll('[role="option"], [role="listbox"] li')].filter(visible);
    return options.find((element) => MP.matchesAny(element.innerText, [city])) || options[0] || null;
  }

  // Digita "Bairro, Marília" e escolhe a 1ª sugestão; sem sugestão, tenta só a cidade.
  async function fillLocation(listing) {
    const field = MP.fields.location;
    progress("localização");
    const control = await waitFor(() => findControl(field.labels) || [...document.querySelectorAll(field.fallback)].find(visible) || null, 8000);
    if (!control) throw new StepError(currentStep, "Campo de localização (ícone de pino) não encontrado.");
    const attempts = listing.neighborhood ? [`${listing.neighborhood}, ${listing.city}`, listing.city] : [listing.city];
    for (const text of attempts) {
      if ("value" in control && control.value) setNativeValue(control, "");
      await humanType(control, text);
      const option = await waitFor(() => locationSuggestion(listing.city), 8000);
      if (option) {
        await humanClick(option);
        return;
      }
    }
    throw new StepError(currentStep, `O Facebook não sugeriu "${listing.city}" na localização.`);
  }

  // "Turbinar classificado após a publicação" fica SEMPRE desligado.
  async function ensureBoostOff() {
    progress("turbinar desligado");
    const labels = MP.fields.boost.labels;
    const caption = [...document.querySelectorAll("span, div")].find((element) => element.childElementCount === 0 && visible(element) && MP.matchesAny(element.innerText, labels));
    let container = caption;
    let toggle = null;
    for (let i = 0; i < 6 && container && !toggle; i += 1) {
      container = container.parentElement;
      toggle = container?.querySelector('[role="switch"], input[type="checkbox"]') || null;
    }
    if (!toggle) return; // sem toggle na tela: nada a desligar
    const on = toggle.getAttribute("aria-checked") === "true" || toggle.checked === true;
    if (on) await humanClick(toggle);
    if (toggle.getAttribute("aria-checked") === "true" || toggle.checked === true) throw new StepError(currentStep, "Não consegui desligar o \"Turbinar classificado\".");
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

  function isPropertyForm() {
    return MP.matchesAny(pageText().slice(0, 3000), MP.formTitle);
  }

  // Abre "Novo classificado de imóvel": se já está nele, segue; se está em "Escolha o tipo de classificado", clica no
  // cartão "Imóvel residencial para venda ou locação"; senão, vai para a tela de escolha (uma vez).
  async function openPropertyCategory() {
    progress("categoria do imóvel");
    if (await waitFor(() => isPropertyForm(), 6000)) return;
    const card = await waitFor(() => findClickable(MP.categoryCard, false), 8000);
    if (card) {
      await humanClick(card);
      if (await waitFor(() => isPropertyForm(), 10000)) return;
      throw new StepError(currentStep, "Cliquei em \"Imóvel residencial para venda ou locação\" mas o formulário não abriu.");
    }
    if (location.pathname.replace(/\/$/, "") !== "/marketplace/create") {
      location.assign(MP.urls.create);
      throw new StepError(currentStep, "Formulário de imóvel não abriu direto; a aba foi para a escolha do tipo de classificado.", { navigated: true });
    }
    throw new StepError(currentStep, "Cartão \"Imóvel residencial para venda ou locação\" não encontrado.");
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
      await fillText("bedrooms", listing.bedrooms);
      await fillText("bathrooms", listing.bathrooms);
      await fillText("price", String(Math.round(listing.price)));
      await fillLocation(listing);
      await fillText("description", descriptionWithNeighborhood(listing));
      await fillText("area", listing.areaM2 ? String(Math.round(listing.areaM2)) : "");
      await fillText("iptu", listing.iptu ? String(Math.round(listing.iptu)) : "");
      await fillText("condoFee", listing.condoFee ? String(Math.round(listing.condoFee)) : "");
      await chooseOption("parkingSpaces", listing.parkingSpaces);
      await ensureBoostOff();
      assertNoCheckpoint();

      // "Avançar" fica desabilitado até os obrigatórios estarem certos. Pode haver mais de uma etapa (ex.: grupos):
      // só avança, nunca marca grupos extras.
      let publishButton = null;
      for (let stage = 1; stage <= 3 && !publishButton; stage += 1) {
        progress(`avançar (etapa ${stage})`);
        publishButton = findClickable(MP.buttons.publish);
        if (publishButton) break;
        const nextAny = await waitFor(() => findClickable(MP.buttons.next, true, { includeDisabled: true }), 8000);
        if (!nextAny) break;
        const next = await waitFor(() => findClickable(MP.buttons.next), 15000);
        if (!next) throw new StepError(currentStep, "\"Avançar\" continuou desabilitado — algum campo obrigatório ficou vazio ou inválido (confira quartos, banheiros, preço e localização).");
        await humanClick(next);
        await sleep(between(2500, 4500));
        assertNoCheckpoint();
        await ensureBoostOff();
      }

      progress("publicar");
      publishButton = publishButton || (await waitFor(() => findClickable(MP.buttons.publish), 10000));
      if (!publishButton) throw new StepError(currentStep, "Botão Publicar não encontrado.");
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

  // Na página "Seus classificados": o título é montado pelo Facebook (não é o do CRM), então procura o classificado
  // pelo preço; sem isso, não chuta — devolve vazio e o CRM registra "link não capturado".
  async function findListingUrl(price) {
    await sleep(between(3000, 5000));
    const digits = Number(price || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    const link = await waitFor(() => {
      const links = [...document.querySelectorAll(MP.listingLink)];
      return links.find((element) => digits !== "0" && String(element.innerText || "").includes(digits)) || null;
    }, 20000, 1000);
    return { url: link ? MP.cleanListingUrl(link.href) : "", checkpoint: MP.isCheckpoint(location.href, pageText()) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "mp-publish") {
      publish(message.listing, message.photos).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-find-url") {
      findListingUrl(message.price).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-ping") {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
