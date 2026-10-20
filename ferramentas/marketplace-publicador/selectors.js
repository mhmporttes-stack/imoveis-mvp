// TODOS os "seletores" do Facebook ficam aqui. O Facebook muda a tela com frequência: quando um passo falhar,
// ajuste só este arquivo (textos em pt-BR e em inglês, aria-label, rótulos). Nada de classes CSS geradas
// (mudam a cada deploy do Facebook) — sempre texto visível, aria-label, role e tipo de campo.
// Script clássico (injetado na aba do Facebook antes de content.js) e também importável pelo node --test.

(function defineMarketplaceSelectors(root) {
  const MP = {
    urls: {
      create: "https://www.facebook.com/marketplace/create",
      // Formulário de "Imóveis para venda ou aluguel" (usado se o cartão da categoria não for encontrado).
      createProperty: "https://www.facebook.com/marketplace/create/rental",
      selling: "https://www.facebook.com/marketplace/you/selling"
    },
    // Tela "Escolha o tipo de classificado" (conferida no formulário real do dono, Brasil, 2026-10-20).
    categoryCard: [
      "Imóvel residencial para venda ou locação",
      "Imóveis para venda ou aluguel",
      "Property for sale or rent",
      "Home for sale or rent"
    ],
    // Link do menu lateral do Marketplace (último recurso para chegar à escolha do tipo).
    createLink: ["Criar novo classificado", "Create new listing"],
    // Título do formulário de imóvel — se já está na tela, não precisa escolher o cartão.
    formTitle: ["Novo classificado de imóvel", "New property listing"],
    // kind: select (combobox do Facebook) | text | textarea | autocomplete | toggle
    // O formulário de imóvel NÃO tem campo "Título" (o Facebook monta o título pelos dados).
    fields: {
      // Sem rótulo: o combobox mostra o valor inicial "Imóvel residencial para venda ou locação" (padrão = locação,
      // a prévia mostra "Preço/mês"). Achado pelo texto que ele exibe.
      offerType: {
        kind: "select",
        labels: ["Imóvel residencial para venda ou", "Para venda ou locação", "Home for sale or rent"],
        options: {
          sale: ["Venda", "À venda", "Para venda", "Imóvel à venda", "Imóvel residencial à venda", "For sale"],
          rent: ["Locação", "Aluguel", "Para locação", "Para alugar", "Imóvel para locação", "For rent", "Rent"]
        },
        // Nunca escolher a opção "venda OU locação" (é o próprio valor inicial).
        excludeOptions: [" ou ", " or "]
      },
      propertyType: {
        kind: "select",
        labels: ["Tipo de imóvel", "Property type"],
        options: {
          house: ["Casa", "House"],
          apartment: ["Apartamento", "Apartment"],
          townhouse: ["Sobrado", "Casa geminada", "Casa em condomínio", "Townhouse"],
          land: ["Terreno", "Lote", "Land"]
        }
      },
      bedrooms: { kind: "text", labels: ["Número de quartos", "Number of bedrooms"] },
      bathrooms: { kind: "text", labels: ["Número de banheiros", "Number of bathrooms"] },
      price: { kind: "text", labels: ["Preço", "Price"] },
      // Campo só com ícone de pino (sem rótulo visível): tenta aria-label/placeholder; senão, o input de autocomplete.
      location: {
        kind: "autocomplete",
        labels: ["Localização do imóvel", "Localização", "Endereço", "Location"],
        fallback: 'input[aria-autocomplete="list"], input[role="combobox"]'
      },
      description: { kind: "textarea", labels: ["Descrição do imóvel", "Property description", "Description"] },
      // "Detalhes específicos (Opcional)": se não achar, segue sem eles.
      area: { kind: "text", labels: ["Metros quadrados", "Square meters"], optional: true },
      iptu: { kind: "text", labels: ["Imposto Predial e Territorial Urbano", "IPTU"], optional: true },
      condoFee: { kind: "text", labels: ["Condomínio"], optional: true },
      parkingSpaces: {
        kind: "select",
        labels: ["Vagas de estacionamento", "Parking spaces"],
        optional: true,
        // Valor → textos da opção (0..3 exatos; 4 ou mais).
        optionsFor(count) {
          const n = Number(count);
          if (n >= 4) return ["4+", "4 ou mais", "Mais de 3", "4"];
          if (n === 0) return ["0", "Nenhuma", "Nenhum", "None"];
          return [String(n)];
        }
      },
      // Toggle que SEMPRE fica desligado.
      boost: { kind: "toggle", labels: ["Turbinar classificado após a publicação", "Turbinar classificado", "Boost listing"] }
    },
    photoInput: 'input[type="file"][accept*="image"][multiple], input[type="file"][accept*="image"], input[type="file"]',
    optionRoles: '[role="option"], [role="menuitemradio"], [role="menuitem"], [role="radio"]',
    buttons: {
      next: ["Avançar", "Próximo", "Continuar", "Next", "Continue"],
      publish: ["Publicar", "Publish"],
      // Nunca clicar nestes (rascunho, turbinar, grupos extras).
      forbidden: ["Salvar rascunho", "Save draft", "Turbinar", "Boost"]
    },
    // Textos que indicam verificação, bloqueio ou limite → pausa de 24 h.
    checkpointTexts: [
      "Confirme sua identidade",
      "Confirme que é você",
      "Verificação de segurança",
      "Sua conta está temporariamente",
      "Você atingiu o limite",
      "limite de publicações",
      "Você não pode publicar",
      "temporariamente bloqueado",
      "Confirm your identity",
      "Security check",
      "You've reached your limit",
      "temporarily blocked",
      "You can't post"
    ],
    checkpointUrlParts: ["/checkpoint", "/login", "/two_step_verification"],
    listingLink: 'a[href*="/marketplace/item/"]',
    // "Anunciar nos seus grupos" (dono, 2026-10-20): até 20 grupos; marca só os da lista do CRM.
    groups: {
      headings: ["Anunciar nos seus grupos", "Anunciar em grupos", "List in groups", "List in more places"],
      checkbox: '[role="checkbox"], input[type="checkbox"]',
      max: 20
    },
    // --- Chat do Marketplace (MKT-2) — A CALIBRAR com prints da caixa real do dono ---
    // Só a caixa de entrada do MARKETPLACE é lida: nunca a lista geral do Messenger (conversas pessoais).
    inbox: {
      url: "https://www.facebook.com/marketplace/inbox/",
      // Links das conversas listadas na caixa do Marketplace.
      threadLinks: 'a[href*="/marketplace/t/"], a[href*="/messages/t/"], a[href*="/t/"][role="link"]',
      // Itens de lista (com ou sem link): cada um é "Nome · Título do anúncio" + prévia + hora (prints do dono, 2026-10-20).
      listItems: '[role="row"], [role="listitem"], [role="gridcell"], a[role="link"], [role="link"], [role="button"]',
      // Caminho real visto pelo dono: ícone do Messenger no topo → painel "Conversas" → item fixo "Marketplace".
      messengerButtonLabels: ["Messenger", "Mensagens", "Messages", "Chats"],
      marketplaceEntryTexts: ["Marketplace"],
      // Aviso de criptografia de ponta a ponta sem o histórico (pede o PIN do Messenger).
      pinTexts: ["Insira seu PIN", "histórico de conversa está faltando", "restaurar o histórico", "Enter your PIN", "chat history is missing", "restore your chat history"],
      // Área das mensagens dentro da conversa (página ou janela de chat) e cada linha/bolha.
      messageArea: '[role="main"] [role="grid"], [role="main"] [aria-label*="Mensagens"], [role="main"] [aria-label*="Messages"], [role="dialog"] [role="grid"], [role="dialog"] [aria-label*="Mensagens"], [role="complementary"] [role="grid"], [role="main"]',
      messageRows: '[role="row"], [data-testid="message-container"]',
      messageText: 'div[dir="auto"]',
      // Campo de escrever e botão enviar.
      composer: '[role="textbox"][contenteditable="true"]',
      composerLabels: ["Mensagem", "Escreva uma mensagem", "Aa", "Message", "Write a message"],
      sendLabels: ["Pressione Enter para enviar", "Enviar", "Press enter to send", "Send"],
      // Textos de sistema da conversa que não são mensagem do cliente.
      systemTexts: ["Enviado", "Sent", "Entregue", "Delivered", "Digite uma mensagem"],
      // Começo de linha de sistema ("Visto por João", "Você enviou uma foto").
      systemPrefixes: ["Visto por", "Seen by", "Você enviou", "You sent"]
    }
  };

  // Comparação sem acento, sem caixa e com espaços normalizados.
  MP.normalize = function normalize(text) {
    return String(text || "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/[\u00A0\u202F\u2007]/g, " ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  // exact: o texto inteiro é igual a uma das opções; senão, basta conter.
  MP.matchesAny = function matchesAny(text, candidates, exact = false) {
    const value = MP.normalize(text);
    if (!value) return false;
    return candidates.some((candidate) => {
      const target = MP.normalize(candidate);
      return exact ? value === target : value.includes(target);
    });
  };

  MP.isCheckpoint = function isCheckpoint(url, pageText) {
    const path = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return "";
      }
    })();
    if (MP.checkpointUrlParts.some((part) => path.startsWith(part))) return true;
    return MP.matchesAny(pageText, MP.checkpointTexts);
  };

  // Sugestão de localização a escolher (2026-10-20: a extensão chegou a escolher "Rua Marília, Vera Cruz - SP").
  // SÓ a CIDADE: texto principal (1ª linha) exatamente "Marília" / "Marília, SP" / "Marília, São Paulo" (sem rua,
  // avenida, bairro…) e o estado (SP/São Paulo) no principal ou no secundário. Preferência pela que diz "Cidade".
  // Nenhuma serve → -1 (nunca escolhe "a primeira que aparecer").
  const ADDRESS_PREFIX = /^(rua|r\.|av\.?|avenida|alameda|al\.|travessa|tv\.|estrada|rodovia|rod\.|praca|pca\.|bairro|jardim|jd\.?|vila|parque|residencial|condominio|chacara|sitio|fazenda|loteamento|conjunto|largo|viela)\b/;
  MP.isCityOption = function isCityOption(text, city = "Marília", state = "SP") {
    const lines = String(text || "").split("\n").map((line) => MP.normalize(line)).filter(Boolean);
    const main = lines[0] || "";
    const cityKey = MP.normalize(city);
    const stateKeys = [MP.normalize(state), "sao paulo"];
    if (ADDRESS_PREFIX.test(main)) return false;
    const mainOk = main === cityKey || stateKeys.some((key) => main === `${cityKey}, ${key}` || main === `${cityKey} - ${key}` || main === `${cityKey}/${key}`);
    if (!mainOk) return false;
    const rest = lines.join(" | ");
    return stateKeys.some((key) => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`).test(rest));
  };

  MP.pickLocationIndex = function pickLocationIndex(texts, city = "Marília", state = "SP") {
    const cityOptions = texts.map((text, index) => ({ index, ok: MP.isCityOption(text, city, state), cidade: /(^|[^a-z])(cidade|city)([^a-z]|$)/.test(MP.normalize(text)) }));
    const best = cityOptions.find((item) => item.ok && item.cidade) || cityOptions.find((item) => item.ok);
    return best ? best.index : -1;
  };

  // Valor FINAL do campo depois de escolher: só "Marília, SP" ou "Marília, São Paulo" (", Brasil" opcional).
  MP.isConfirmedCity = function isConfirmedCity(value, city = "Marília", state = "SP") {
    const text = MP.normalize(value).replace(/,\s*brasil$/, "");
    const cityKey = MP.normalize(city);
    return [MP.normalize(state), "sao paulo"].some((key) => text === `${cityKey}, ${key}` || text === `${cityKey} - ${key}`);
  };

  // Diagnóstico de falha na localização: textos das 5 primeiras opções e um trecho do HTML da 1ª (sem atributos de
  // dados; nomes de lugar não são dado pessoal).
  MP.describeOptions = function describeOptions(options) {
    const list = [...(options || [])];
    const texts = list.slice(0, 5).map((option, index) => `${index + 1}) ${String(option.innerText || option.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)}`);
    const html = list[0] ? String(list[0].outerHTML || "").replace(/\s(class|style|data-[\w-]+|id|href|src)="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 300) : "";
    return `${list.length} sugestões. Primeiras: ${texts.join(" | ") || "nenhuma"}.${html ? ` HTML da 1ª: ${html}` : ""}`;
  };

  // Mesmo saneamento do CRM (lib/marketplace-core.mjs sanitizeNeighborhood) para anúncios gravados antes dele.
  MP.cleanNeighborhood = function cleanNeighborhood(value, city = "Marília", state = "SP") {
    const drop = [city, state, `${city} ${state}`, `${city}/${state}`, `${city}-${state}`].map(MP.normalize);
    return String(value || "")
      .split(/\s*[·•|—–,/]\s*|\s+-\s+/)
      .map((part) => part.trim())
      .filter((part) => part && !drop.includes(MP.normalize(part)))
      .join(" ");
  };

  MP.cleanListingUrl = function cleanListingUrl(href, base = "https://www.facebook.com") {
    try {
      const url = new URL(href, base);
      const match = url.pathname.match(/\/marketplace\/item\/(\d+)/);
      return match ? `https://www.facebook.com/marketplace/item/${match[1]}/` : "";
    } catch {
      return "";
    }
  };

  // id estável da conversa a partir do link (/marketplace/t/123, /messages/t/123, /t/123).
  MP.parseThreadKey = function parseThreadKey(href) {
    try {
      const url = new URL(href, "https://www.facebook.com");
      const match = url.pathname.match(/\/(?:marketplace\/t|messages\/t|t)\/([A-Za-z0-9_.:-]{1,120})/);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  };

  // O Messenger não expõe id da mensagem: id = hash de (conversa, direção, texto, ordem entre textos iguais).
  MP.messageExternalId = function messageExternalId(threadKey, direction, body, ordinal = 0) {
    const input = `${threadKey}|${direction}|${MP.normalize(body)}|${ordinal}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
      h2 = Math.imul(h2 + code, 2246822519) >>> 0;
    }
    return `h:${h1.toString(16)}${h2.toString(16)}`;
  };

  // Lado da bolha pela geometria: mensagem nossa fica à direita da área de mensagens.
  MP.directionFromGeometry = function directionFromGeometry(bubble, area) {
    const bubbleCenter = (bubble.left + bubble.right) / 2;
    const areaCenter = (area.left + area.right) / 2;
    return bubbleCenter > areaCenter ? "outbound" : "inbound";
  };

  // Mensagens lidas da conversa → lista com id estável (ordinal entre repetições do mesmo texto/direção).
  MP.buildMessages = function buildMessages(threadKey, rows) {
    const seen = new Map();
    return rows
      .filter((row) => (row.body || row.attachments?.length) && !MP.matchesAny(row.body, MP.inbox.systemTexts, true)
        && !MP.inbox.systemPrefixes.some((prefix) => MP.normalize(row.body).startsWith(MP.normalize(prefix))))
      .map((row) => {
        const key = `${row.direction}|${MP.normalize(row.body)}`;
        const ordinal = seen.get(key) || 0;
        seen.set(key, ordinal + 1);
        return { externalId: MP.messageExternalId(threadKey, row.direction, row.body || (row.attachments || []).map((a) => a.url).join(" "), ordinal), direction: row.direction, body: row.body || "", attachments: row.attachments || [], at: null };
      });
  };

  // Hora da última atividade a partir do rótulo da caixa de entrada ("agora", "5 min", "2 h", "3 d", "1 sem", "14:32",
  // "ontem"). Devolve ISO ou null (desconhecido). `now` para teste.
  MP.parseRelativeTime = function parseRelativeTime(label, now = new Date()) {
    const text = MP.normalize(label);
    if (!text) return null;
    const ms = { min: 60000, h: 3600000, d: 86400000, sem: 604800000 };
    if (/(^|\s)(agora|now|agora mesmo)(\s|$)/.test(text)) return now.toISOString();
    let match = text.match(/(^|[^\d])(\d{1,2})\s*(min|m)\b/);
    if (match) return new Date(now.getTime() - Number(match[2]) * ms.min).toISOString();
    match = text.match(/(^|[^\d])(\d{1,2})\s*(h|hr|hrs|horas?)\b/);
    if (match) return new Date(now.getTime() - Number(match[2]) * ms.h).toISOString();
    match = text.match(/(^|[^\d])(\d{1,3})\s*(d|dias?)\b/);
    if (match) return new Date(now.getTime() - Number(match[2]) * ms.d).toISOString();
    match = text.match(/(^|[^\d])(\d{1,2})\s*(sem|semanas?|w)\b/);
    if (match) return new Date(now.getTime() - Number(match[2]) * ms.sem).toISOString();
    if (/(^|\s)(ontem|yesterday)(\s|$)/.test(text)) return new Date(now.getTime() - ms.d).toISOString();
    match = text.match(/(^|\s)(\d{1,2}):(\d{2})(\s|$)/);
    if (match) {
      // Hora de hoje (fuso de São Paulo, -03:00).
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const at = new Date(`${day}T${match[2].padStart(2, "0")}:${match[3]}:00-03:00`);
      return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() + 60000 ? at.toISOString() : null;
    }
    return null;
  };

  // Junta "janelas" de mensagens lidas enquanto rola a conversa (o Messenger só mantém parte na tela): acrescenta a
  // janela nova ao que já foi coletado, sem repetir a parte que se sobrepõe. Chave = direção + texto.
  MP.mergeRowWindows = function mergeRowWindows(collected = [], windowRows = []) {
    const key = (row) => `${row.direction}|${MP.normalize(row.body)}|${(row.attachments || []).map((a) => a.url).join(",")}`;
    const tail = collected.map(key);
    const head = windowRows.map(key);
    let overlap = 0;
    for (let size = Math.min(tail.length, head.length); size > 0; size -= 1) {
      let same = true;
      for (let i = 0; i < size; i += 1) {
        if (tail[tail.length - size + i] !== head[i]) { same = false; break; }
      }
      if (same) { overlap = size; break; }
    }
    return [...collected, ...windowRows.slice(overlap)];
  };

  // Item da caixa do Marketplace em linhas de texto → dados. 1ª linha "Nome · Título do anúncio"; prévia "Você: …"
  // (nossa) ou "Nome: …" (do cliente); hora relativa ("6 min", "1h", "15h") em linha própria ou no fim da prévia.
  // null = não é um item de conversa do Marketplace (ex.: conversa pessoal sem " · ").
  MP.parseInboxItem = function parseInboxItem(lines = []) {
    const clean = lines.map((line) => String(line || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const first = clean[0] || "";
    const sep = first.indexOf(" · ");
    if (sep <= 0) return null;
    const contactName = first.slice(0, sep).trim();
    const listingTitle = first.slice(sep + 3).trim();
    let timeLabel = "";
    let preview = "";
    for (const line of clean.slice(1)) {
      const parts = line.split(" · ").map((part) => part.trim()).filter(Boolean);
      const last = parts[parts.length - 1] || "";
      if (MP.parseRelativeTime(last) && last.length <= 12) {
        timeLabel = last;
        if (parts.length > 1 && !preview) preview = parts.slice(0, -1).join(" · ");
      } else if (!preview && !/^\d+\s+nova/i.test(line)) {
        preview = line;
      }
    }
    const outbound = /^(você|voce|you)\s*:/i.test(preview);
    return { contactName, listingTitle, preview, previewDirection: outbound ? "outbound" : "inbound", timeLabel };
  };

  // Chave da conversa quando o item não tem link: estável por nome + anúncio.
  MP.itemKey = function itemKey(contactName, listingTitle) {
    return MP.messageExternalId("item", "k", `${contactName}|${listingTitle}`).replace(/^h:/, "n");
  };

  // Nome de grupo comparável: sem acento, caixa, pontuação e espaços repetidos.
  MP.normalizeGroupName = function normalizeGroupName(name) {
    return MP.normalize(name).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  };

  // Nº de membros como o Facebook mostra na linha do grupo ("12 mil membros", "1,2 mil membros", "3.456 membros",
  // "15K members"). Devolve o trecho de texto (para o dono acompanhar) ou "".
  MP.parseMembers = function parseMembers(text) {
    const match = String(text || "").replace(/\u00a0/g, " ").match(/(\d[\d.,]*\s*(?:mil|mi|k|m)?\s*(?:membros?|members?))/i);
    return match ? match[1].replace(/\s+/g, " ").trim() : "";
  };

  // Quais grupos da tela marcar: só nome IGUAL (normalizado) a um da lista do CRM; até 20.
  MP.matchGroups = function matchGroups(available = [], wanted = [], max = 20) {
    const wantedKeys = new Map(wanted.map((name) => [MP.normalizeGroupName(name), name]).filter(([key]) => key));
    const select = [];
    const found = new Set();
    available.forEach((name, index) => {
      const key = MP.normalizeGroupName(name);
      if (wantedKeys.has(key) && !found.has(key) && select.length < max) {
        found.add(key);
        select.push({ index, name: wantedKeys.get(key) });
      }
    });
    const missing = [...wantedKeys.entries()].filter(([key]) => !found.has(key)).map(([, name]) => name);
    return { select, missing };
  };

  root.MP = MP;
})(typeof globalThis !== "undefined" ? globalThis : self);
