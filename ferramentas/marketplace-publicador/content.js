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

  // Entrada confiável pelo background (chrome.debugger). Devolve false se o depurador não estiver ligado.
  async function trusted(action, payload = {}) {
    try {
      const result = await chrome.runtime.sendMessage({ type: "mp-trusted", action, ...payload });
      return Boolean(result?.ok);
    } catch {
      return false;
    }
  }

  async function trustedClick(element) {
    element.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(between(250, 500));
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height / 2, 18);
    return trusted("click", { x, y });
  }

  // Clique: real (depurador) quando disponível; senão, eventos sintéticos de sempre.
  async function humanClick(element) {
    if (await trustedClick(element)) {
      await sleep(between(400, 1000));
      return;
    }
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

  function locationOptions() {
    const byRole = [...document.querySelectorAll('[role="option"]')].filter(visible);
    if (byRole.length) return byRole;
    return [...document.querySelectorAll('[role="listbox"] > *, [role="listbox"] li')].filter(visible);
  }

  function clearInput(control) {
    control.focus();
    if (typeof control.select === "function") control.select();
    document.execCommand("delete");
    if ("value" in control && control.value) setNativeValue(control, "");
  }

  function locationChosen(control, city) {
    const value = MP.normalize(control.value ?? control.innerText);
    return value.includes(MP.normalize(city)) && !locationOptions().length;
  }

  function pressKey(control, key) {
    for (const type of ["keydown", "keyup"]) control.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
  }

  async function key(control, name, options = {}) {
    if (!(await trusted("key", { key: name, ...options }))) pressKey(control, name);
  }

  // Digita só a cidade ("Marília") com teclas reais, escolhe "Marília, SP · Cidade" com clique real e confirma que a
  // lista fechou com a cidade no campo. Último recurso: ↓ até a opção + Enter (reais). Falhou → erro com as 5
  // primeiras opções e um trecho do HTML da 1ª.
  async function fillLocation(listing) {
    const field = MP.fields.location;
    progress("localização");
    const control = await waitFor(() => findControl(field.labels) || [...document.querySelectorAll(field.fallback)].find(visible) || null, 8000);
    if (!control) throw new StepError(currentStep, "Campo de localização (ícone de pino) não encontrado.");
    await humanClick(control);
    control.focus();
    await key(control, "a", { ctrl: true });
    await key(control, "Backspace");
    if ("value" in control && control.value) clearInput(control);
    for (const char of String(listing.city)) {
      if (!(await trusted("text", { text: char }))) document.execCommand("insertText", false, char);
      await sleep(between(90, 220));
    }
    const options = await waitFor(() => (locationOptions().length ? locationOptions() : null), 10000);
    if (!options) throw new StepError(currentStep, `O Facebook não mostrou sugestões para "${listing.city}".`);
    await sleep(between(1000, 1600)); // a lista termina de carregar
    let current = locationOptions();
    const index = MP.pickLocationIndex(current.map((element) => element.innerText || element.textContent || ""), listing.city, listing.state);

    if (index >= 0) {
      await humanClick(current[index]);
      await sleep(between(600, 1000));
      if (locationChosen(control, listing.city)) return;
    }
    current = locationOptions();
    if (current.length) {
      control.focus();
      const target = Math.max(0, MP.pickLocationIndex(current.map((element) => element.innerText || element.textContent || ""), listing.city, listing.state));
      for (let i = 0; i <= target; i += 1) {
        await key(control, "ArrowDown");
        await sleep(between(150, 300));
      }
      await key(control, "Enter");
      await sleep(between(800, 1400));
      if (locationChosen(control, listing.city)) return;
    }
    throw new StepError(currentStep, `Não consegui escolher "${listing.city}, ${listing.state}" (campo ficou "${control.value ?? ""}"; opção escolhida: ${index + 1}). ${MP.describeOptions(locationOptions().length ? locationOptions() : current)}`);
  }

  // Campos obrigatórios que ficaram vazios (para explicar o "Avançar" desabilitado).
  function emptyRequiredFields() {
    const names = { bedrooms: "Número de quartos", bathrooms: "Número de banheiros", price: "Preço", description: "Descrição do imóvel", propertyType: "Tipo de imóvel" };
    const empty = Object.entries(names).filter(([key]) => {
      const control = findControl(MP.fields[key].labels);
      if (!control) return true;
      const value = control.value ?? control.innerText;
      return !String(value || "").trim() || MP.matchesAny(value, MP.fields[key].labels, true);
    }).map(([, label]) => label);
    const location = findControl(MP.fields.location.labels) || [...document.querySelectorAll(MP.fields.location.fallback)].find(visible);
    if (!location || !String(location.value || "").trim()) empty.push("Localização");
    if (!document.querySelector('img[src^="blob:"], img[src*="scontent"]')) empty.push("Fotos (nenhuma miniatura visível)");
    return empty;
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

  // A navegação até o formulário é feita pelo background (aba dedicada + chrome.tabs.update + reinjeção). Aqui só
  // se confere a página e se clica no que ele pedir.
  async function probe(waitForFormMs = 0) {
    if (waitForFormMs) await waitFor(() => isPropertyForm(), waitForFormMs, 500);
    return {
      url: location.href,
      isForm: isPropertyForm(),
      hasCard: Boolean(findClickable(MP.categoryCard, false)),
      hasCreateLink: Boolean(findClickable(MP.createLink, false)),
      checkpoint: MP.isCheckpoint(location.href, pageText())
    };
  }

  async function clickTarget(target) {
    const texts = target === "card" ? MP.categoryCard : MP.createLink;
    const element = await waitFor(() => findClickable(texts, false), 10000);
    if (!element) return { clicked: false, url: location.href };
    await humanClick(element);
    return { clicked: true, url: location.href };
  }

  function descriptionWithNeighborhood(listing) {
    const description = String(listing.description || "");
    const neighborhood = MP.cleanNeighborhood(listing.neighborhood, listing.city, listing.state);
    if (!neighborhood || MP.normalize(description).includes(MP.normalize(neighborhood))) return description;
    return `Bairro ${neighborhood} — ${listing.city}/${listing.state}\n\n${description}`;
  }


  async function publish(listing, photos) {
    let clickedPublish = false;
    try {
      await sleep(between(2500, 4500));
      assertNoCheckpoint();
      progress("formulário de imóvel");
      if (!isPropertyForm()) throw new StepError(currentStep, `A aba não está no formulário "Novo classificado de imóvel" (${location.href}).`);
      await uploadPhotos(photos);
      await chooseOption("offerType", listing.offerType);
      await chooseOption("propertyType", listing.propertyType);
      await fillText("bedrooms", listing.bedrooms);
      await fillText("bathrooms", listing.bathrooms || 1); // obrigatório no Facebook
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
        if (!next) {
          const empty = emptyRequiredFields();
          throw new StepError(currentStep, `"Avançar" continuou desabilitado. ${empty.length ? `Campos vazios: ${empty.join(", ")}.` : "Nenhum campo obrigatório parece vazio — confira a tela."}`);
        }
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
      progress("clicou publicar");
      await humanClick(publishButton);

      progress("confirmação");
      const startPath = location.pathname;
      await waitFor(() => location.pathname !== startPath || MP.isCheckpoint(location.href, pageText()), 60000, 1000);
      if (MP.isCheckpoint(location.href, pageText())) throw new StepError(currentStep, "Depois de publicar, o Facebook mostrou verificação ou limite.", { checkpoint: true });
      const link = document.querySelector(MP.listingLink);
      const url = MP.cleanListingUrl(location.href) || (link ? MP.cleanListingUrl(link.href) : "");
      return { ok: true, url, clickedPublish, step: currentStep };
    } catch (error) {
      return { ok: false, clickedPublish, step: error.step || currentStep, error: error.message, checkpoint: Boolean(error.checkpoint) };
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
    if (message?.type === "mp-probe") {
      probe(message.waitForFormMs || 0).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-click") {
      clickTarget(message.target).then(sendResponse);
      return true;
    }
    if (message?.type === "mp-ping") {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
