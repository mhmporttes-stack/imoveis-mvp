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
      composer: '[role="textbox"][contenteditable="true"], [role="textbox"][data-lexical-editor]',
      composerLabels: ["Mensagem", "Escreva uma mensagem", "Aa", "Message", "Write a message"],
      sendLabels: ["Pressione Enter para enviar", "Enviar", "Press enter to send", "Send"],
      // Janela de chat flutuante (print do dono): container com o campo "Aa" + cabeçalho "Nome · Anúncio".
      chatWindow: '[role="dialog"], [role="complementary"], [role="region"], [aria-label]',
      closeLabels: ["Fechar bate-papo", "Fechar chat", "Fechar", "Close chat", "Close"],
      // Estrutura REAL da conversa aberta (diagnóstico do dono, 2026-10-20): div[role=log] virtualizado; cada mensagem é
      // div[role=article] com o balão div[data-message-id] e um botão-irmão [role=button][tabindex=-1] cujo aria-label é
      // o texto. Nossa: tem div[role=status] (entregue/visto) ou h2 "Você enviou"; do cliente: link /marketplace/profile/.
      log: '[role="log"]',
      // 1.9.5: campo de anexo da janela de conversa (arquivo de resposta do CRM).
      fileInput: 'input[type="file"]',
      article: '[role="article"]',
      messageId: "[data-message-id]",
      messageTextButton: '[role="button"][tabindex="-1"][aria-label]',
      timeSeparator: "[data-release-focus-from]",
      outboundMarkers: '[role="status"]',
      inboundMarkers: 'a[href*="/marketplace/profile/"]',
      outboundHeadings: ["Você enviou", "You sent"],
      chatHeaderButtons: "[data-prevent_chattab_focus]",
      // Itens da lista da caixa: clicáveis dentro do conteúdo principal (role=main) com miniatura.
      clickables: 'a[href], [role="button"], [role="row"], [role="link"], [role="gridcell"], [role="listitem"]',
      // Textos de sistema/faixa do anúncio que não são mensagem do cliente (interface mista pt/en).
      systemTexts: ["Enviado", "Sent", "Entregue", "Delivered", "Digite uma mensagem", "Marketplace", "Mark as pending", "Marcar como pendente", "More options", "Mais opções", "Aa"],
      // Começo de linha de sistema ("Visto por João", "Você enviou uma foto").
      systemPrefixes: ["Visto por", "Seen by", "Você enviou", "You sent"],
      // 1.9.1: avisos do Facebook dentro da conversa (caso Debora, 2026-10-22) — nunca mensagem do cliente. A mesma lista
      // existe no servidor (SYSTEM_MESSAGE_RE, lib/marketplace-chat-core.mjs) para versões antigas e o já gravado.
      systemPatterns: [
        /\biniciou esta conversa\b/i, /\bstarted this (conversation|chat)\b/i,
        /\bmarcou (.+ )?como (vendido|pendente|disponivel|disponível)\b/i, /\bmarked (.+ )?as (sold|pending|available)\b/i,
        /\best[aá] aguardando (a )?sua resposta\b/i, /\bis waiting for (your|a) (reply|response)\b/i,
        /^(voc[eê]|voce) (agora )?pode (enviar|mandar) mensage(m|ns)\b/i, /^you can (now )?send messages\b/i, /^you can now (message|reply)\b/i,
        /^envie uma resposta r[aá]pida\b/i, /^toque em uma resposta para envi[aá]-la/i, /^send a quick reply\b/i, /^tap a reply to send\b/i
      ],
      // Painel de respostas rápidas (título; o bloco inteiro, com as sugestões, é ignorado).
      quickReplyTitles: ["Envie uma resposta rápida", "Send a quick reply", "Toque em uma resposta para enviá-la ao comprador", "Tap a reply to send it to the buyer"],
      // 1.9.7 (casos Debora/Andreza, 18 conversas de 22 a 24/10/2026): a sugestão de resposta ao VENDEDOR vem num bloco
      // com data-message-id próprio, logo depois da pergunta do comprador — o filtro "só data-message-id" da 1.9.1 deixava
      // passar. Comprador nunca escreve isso. A mesma lista existe no servidor (isQuickReplySuggestion, marketplace-chat-core).
      quickReplySuggestions: [/^sim,? voce tem interesse\??$/, /^yes,? are you interested\??$/]
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

  // 1.9.6 (dono, 2026-10-24): conversa que o Facebook não deixa mais responder (cliente bloqueou, conta indisponível,
  // conversa encerrada). Só é consultado quando o campo de mensagem NÃO aparece — o texto das mensagens do cliente não
  // vira "bloqueada" sozinho. Textos em pt-BR e inglês; A CONFIRMAR com print real da tela (ajuste só aqui).
  MP.closedConversationTexts = [
    /voce nao pode (responder|enviar mensagens?)/,
    /nao e possivel (responder|enviar mensagens?)/,
    /(esta pessoa|essa pessoa|esta conta|essa conta) nao esta disponivel/,
    /conversa (foi )?(encerrada|bloqueada)/,
    /you can'?t (reply|message|send messages)/,
    /(this person|this account) (is|isn'?t) (unavailable|available)/,
    /this conversation (has been|was) (closed|blocked)/
  ];
  MP.isConversationClosed = function isConversationClosed(text) {
    const value = MP.normalize(text);
    return Boolean(value) && MP.closedConversationTexts.some((pattern) => pattern.test(value));
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
      if (match) return match[1];
      // /marketplace/inbox/?thread_id=… e parecidos.
      for (const name of ["thread_id", "threadId", "thread", "conversation_id", "tid"]) {
        const value = url.searchParams.get(name);
        if (value && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)) return value;
      }
      return "";
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
      .filter((row) => (row.body || row.attachments?.length) && !MP.matchesAny(row.body, MP.inbox.systemTexts, true) && !MP.isSystemMessage(row.body)
        && !(row.direction === "inbound" && MP.isQuickReplySuggestion(row.body))
        && !MP.inbox.systemPrefixes.some((prefix) => MP.normalize(row.body).startsWith(MP.normalize(prefix))))
      .map((row) => {
        const key = `${row.direction}|${MP.normalize(row.body)}`;
        const ordinal = seen.get(key) || 0;
        seen.set(key, ordinal + 1);
        // id do próprio Facebook (data-message-id) quando existe; senão, hash estável.
        const externalId = row.externalId || MP.messageExternalId(threadKey, row.direction, row.body || (row.attachments || []).map((a) => a.url).join(" "), ordinal);
        return { externalId, direction: row.direction, body: row.body || "", attachments: row.attachments || [], at: row.at || null };
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
    // 1.8.11: anos ("1 a") e datas ("12/10", "12 de out") — para a regra da 1ª carga pular conversas antigas.
    match = text.match(/(^|[^\d])(\d{1,2})\s*(a|ano|anos|y|yr)\b/);
    if (match) return new Date(now.getTime() - Number(match[2]) * 365 * ms.d).toISOString();
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const monthsEn = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let day = 0;
    let month = -1;
    let year = 0;
    match = text.match(/(^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(\s|$)/);
    if (match) [day, month, year] = [Number(match[2]), Number(match[3]) - 1, Number(match[4] || 0)];
    match = !match && text.match(/(^|\s)(\d{1,2})\s*(?:de\s*)?([a-z]{3})[a-z.]*(?:\s*(?:de\s*)?(\d{4}))?/);
    if (match) [day, month, year] = [Number(match[2]), Math.max(months.indexOf(match[3]), monthsEn.indexOf(match[3])), Number(match[4] || 0)];
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      let fullYear = year ? (year < 100 ? 2000 + year : year) : Number(today.slice(0, 4));
      let at = new Date(`${fullYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00-03:00`);
      if (!year && at.getTime() > now.getTime() + ms.d) at = new Date(`${fullYear - 1}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00-03:00`);
      if (Number.isFinite(at.getTime())) return at.toISOString();
    }
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
    const key = (row) => (row.externalId ? `id|${row.externalId}` : `${row.direction}|${MP.normalize(row.body)}|${(row.attachments || []).map((a) => a.url).join(",")}`);
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

  // Separador de hora centralizado ("12:23", "Hoje 12:23", "Ontem 08:10", "seg 14:00") → ISO (São Paulo) ou null.
  MP.parseClockSeparator = function parseClockSeparator(text, now = new Date()) {
    const value = MP.normalize(text);
    const match = value.match(/^(?:(hoje|today|ontem|yesterday)\s+)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const dayMs = /ontem|yesterday/.test(match[1] || "") ? 86400000 : 0;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - dayMs));
    const at = new Date(`${day}T${match[2].padStart(2, "0")}:${match[3]}:00-03:00`);
    return Number.isFinite(at.getTime()) ? at.toISOString() : null;
  };

  // --- Diagnóstico de estrutura (só metadados; nunca nome/mensagem real) ---------------------------------------------
  // Palavras da interface que podem ficar (ajudam a calibrar e não são dado pessoal).
  MP.UI_WORDS = ["Marketplace", "Venda", "Compra", "Vendendo", "Comprando", "Tudo", "Não lidas", "Grupos", "Conversas", "Chats", "Mensagens", "Messenger", "Aa", "Mark as pending", "Marcar como pendente", "More options", "Mais opções", "Seus classificados", "Caixa de entrada", "Inbox", "Selling", "Buying", "Ver tudo", "See all", "Configurações", "Settings"];

  // Texto próprio de um nó → marcador. " · " → NOME · ANUNCIO; "Você:" → Você: TEXTO; hora/tempo relativo e palavras
  // da interface ficam; o resto vira TXT(tamanho).
  MP.skeletonText = function skeletonText(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "";
    if (value.includes(" · ")) return "NOME · ANUNCIO";
    if (value === "·") return "·";
    if (/^(você|voce|you)\s*:/i.test(value)) return "Você: TEXTO";
    if (value.length <= 12 && (MP.parseRelativeTime(value) || /^\d{1,2}:\d{2}$/.test(value))) return value;
    if (MP.UI_WORDS.some((word) => MP.normalize(word) === MP.normalize(value))) return value;
    return `TXT(${value.length})`;
  };

  // Caminho do link sem domínio, sem parâmetros e com números longos trocados por :id.
  MP.skeletonPath = function skeletonPath(href) {
    try {
      const url = new URL(href, "https://www.facebook.com");
      return url.pathname.replace(/\d{4,}/g, ":id").slice(0, 120);
    } catch {
      return "";
    }
  };

  // --- Leitura pela estrutura REAL (1.8.6; diagnóstico do dono de 2026-10-20) ---------------------------------------
  // As funções abaixo só usam a interface básica do DOM (childNodes, getAttribute, querySelectorAll, closest, contains)
  // para poderem ser testadas com uma árvore falsa (tests/fake-dom.js).

  // Textos das folhas (nós de texto) em ordem, sem espaços extras. Nome e anúncio ficam em spans separados.
  MP.textLeaves = function textLeaves(element) {
    const out = [];
    const walk = (node, depth) => {
      if (depth > 40) return;
      for (const child of node?.childNodes || []) {
        if (child.nodeType === 3) {
          const text = String(child.textContent || "").replace(/\s+/g, " ").trim();
          if (text) out.push(text);
        } else if (child.nodeType === 1 && !/^(script|style|svg)$/i.test(child.tagName || "")) walk(child, depth + 1);
      }
    };
    walk(element, 0);
    return out;
  };

  const DOT_LEAF = /(^|\s)·(\s|$)/;
  // Item da caixa a partir das folhas: "Nome" "·" "Anúncio" (ou "Nome · Anúncio" num nó só, ou "Nome ·" + "Anúncio")
  // + prévia ("Você:" "texto") + hora. Sem " · " → null (conversa pessoal nunca entra).
  MP.parseInboxLeaves = function parseInboxLeaves(leaves = []) {
    const texts = leaves.map((text) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const index = texts.findIndex((text) => DOT_LEAF.test(text));
    if (index < 0) return null;
    const leaf = texts[index];
    let contactName = "";
    let listingTitle = "";
    let restStart = index + 1;
    if (leaf === "·") {
      contactName = texts[index - 1] || "";
      listingTitle = texts[index + 1] || "";
      restStart = index + 2;
    } else {
      const match = leaf.match(/^(.*?)\s*·\s*(.*)$/);
      contactName = (match[1] || "").trim() || texts[index - 1] || "";
      listingTitle = (match[2] || "").trim();
      if (!listingTitle) {
        listingTitle = texts[index + 1] || "";
        restStart = index + 2;
      }
    }
    if (!contactName || !listingTitle) return null;
    const rest = texts.slice(restStart).flatMap((text) => text.split(/\s*·\s*/)).map((text) => text.trim()).filter((text) => text && text !== "·");
    const isTime = (text) => text.length <= 12 && Boolean(MP.parseRelativeTime(text));
    const timeLabel = [...rest].reverse().find(isTime) || "";
    const preview = rest.filter((text) => text !== timeLabel && !/^\d+\s+nova/i.test(text)).join(" ").replace(/\s+:/g, ":").trim();
    return { contactName, listingTitle, preview, previewDirection: /^(você|voce|you)\s*:/i.test(preview) ? "outbound" : "inbound", timeLabel };
  };

  // Partes da conversa aberta que nunca são item da lista (o cabeçalho da janela de chat também tem "Nome · Anúncio"
  // e miniatura).
  const CHAT_PARTS = '[role="log"], [role="textbox"], [data-lexical-editor], [data-prevent_chattab_focus]';
  // Painéis de conversa: o menor ancestral de cada [role=log] que também tem o campo de escrever.
  MP.chatPanes = function chatPanes(root) {
    const panes = [];
    for (const log of root?.querySelectorAll?.('[role="log"]') || []) {
      let node = log.parentElement;
      for (let level = 0; node && level < 25; level += 1, node = node.parentElement) {
        if (node.querySelector?.('[role="textbox"]')) break;
      }
      let pane = node || log;
      // Janela flutuante: inclui o cabeçalho (botões minimizar/fechar) se estiver logo acima.
      for (let up = pane, level = 0; up && level < 6; level += 1, up = up.parentElement) {
        if (up.querySelector?.(MP.inbox.chatHeaderButtons)) {
          if (up.querySelectorAll('[role="log"]').length <= 1) pane = up;
          break;
        }
      }
      panes.push(pane);
    }
    return panes;
  };

  // Itens da lista da caixa do Marketplace dentro de `root` (role=main da página ou o painel "← Marketplace"):
  // clicável (a[href] ou role=button|row|link|gridcell|listitem) com miniatura e " · " nas folhas. Fora da janela de
  // chat; contêiner com 2+ itens não conta; do mesmo item fica o clicável mais externo (o que tem o link).
  MP.findListItems = function findListItems(root, { visible = () => true } = {}) {
    if (!root?.querySelectorAll) return [];
    const panes = MP.chatPanes(root.ownerDocument || root);
    const matches = [];
    for (const element of root.querySelectorAll(MP.inbox.clickables)) {
      if (!visible(element)) continue;
      const images = element.querySelectorAll("img, image").length;
      if (!images || images > 4) continue;
      if (element.querySelector(CHAT_PARTS) || element.matches?.(CHAT_PARTS)) continue;
      if (panes.some((pane) => pane.contains?.(element))) continue;
      const leaves = MP.textLeaves(element);
      if (leaves.length > 16) continue;
      const parsed = MP.parseInboxLeaves(leaves);
      if (parsed) matches.push({ element, parsed });
    }
    const isContainer = (item) => {
      const inner = matches.filter((other) => other !== item && item.element.contains(other.element));
      return inner.some((a) => inner.some((b) => a !== b && !a.element.contains(b.element) && !b.element.contains(a.element)));
    };
    const items = matches.filter((item) => !isContainer(item));
    return items
      .filter((item) => !items.some((other) => other !== item && other.element.contains(item.element)))
      .map(({ element, parsed }) => {
        const links = [element, ...element.querySelectorAll("a[href]")].filter((node) => node.getAttribute?.("href"));
        const outer = element.closest?.("a[href]");
        if (outer) links.push(outer);
        const link = links.find((node) => MP.parseThreadKey(node.getAttribute("href"))) || null;
        const href = link ? link.getAttribute("href") : "";
        return { element, parsed, href, threadKey: MP.parseThreadKey(href) || MP.itemKey(parsed.contactName, parsed.listingTitle) };
      });
  };

  // Botões para fechar janelas de chat abertas: rótulo "Fechar bate-papo"/"Close chat"…; sem rótulo conhecido, o
  // último botão [data-prevent_chattab_focus] de cada cabeçalho (o outro é minimizar).
  MP.chatCloseButtons = function chatCloseButtons(root) {
    const headerButtons = [...(root?.querySelectorAll?.(MP.inbox.chatHeaderButtons) || [])];
    const chatLabels = ["Fechar bate-papo", "Fechar chat", "Close chat"];
    const labeled = [...(root?.querySelectorAll?.('[role="button"][aria-label]') || [])]
      .filter((button) => MP.matchesAny(button.getAttribute("aria-label"), chatLabels, true)
        || (headerButtons.includes(button) && MP.matchesAny(button.getAttribute("aria-label"), MP.inbox.closeLabels, true)));
    if (labeled.length) return labeled;
    const byHeader = new Map();
    for (const button of headerButtons) byHeader.set(button.parentElement?.parentElement || button.parentElement, button);
    return [...byHeader.values()];
  };

  // Direção de uma mensagem pelo conteúdo: link do perfil do cliente → inbound; role=status (entregue/visto) ou h2
  // "Você enviou" → outbound; h2 com outro texto (nome do cliente) → inbound; nada disso → null.
  MP.articleDirection = function articleDirection(article) {
    if (article.querySelector(MP.inbox.inboundMarkers)) return "inbound";
    const headings = [...article.querySelectorAll('h2, [role="heading"]')].map((node) => String(node.textContent || "").trim()).filter(Boolean);
    const outboundHeading = headings.some((text) => MP.inbox.outboundHeadings.some((prefix) => MP.normalize(text).startsWith(MP.normalize(prefix))));
    if (outboundHeading || article.querySelector(MP.inbox.outboundMarkers)) return "outbound";
    return headings.length ? "inbound" : null;
  };

  // Texto de uma mensagem: botão-irmão [role=button][tabindex=-1] cujo aria-label é o texto (de preferência o que tem
  // o mesmo texto dentro); sem ele, os div[dir=auto] do balão fora dos títulos.
  // 1.9.7: `exclude` = painéis de resposta rápida; texto dentro deles ou de um chip (botão focável, tabindex ≠ -1, dentro do
  // balão) nunca é o texto da mensagem.
  MP.articleText = function articleText(article, { exclude = [] } = {}) {
    const outside = (node) => !exclude.some((panel) => panel !== article && panel.contains?.(node)) && !MP.insideChip(node, article);
    const buttons = [...article.querySelectorAll(MP.inbox.messageTextButton)].filter(outside);
    const same = buttons.find((button) => {
      const label = MP.normalize(button.getAttribute("aria-label"));
      return label && label === MP.normalize(button.textContent);
    });
    if (same) return String(same.getAttribute("aria-label")).trim();
    const bubble = article.matches?.(MP.inbox.messageId) ? article : article.querySelector(MP.inbox.messageId);
    const texts = [...(bubble || article).querySelectorAll(MP.inbox.messageText)]
      .filter((node) => outside(node) && !node.closest?.('h2, [role="heading"], [role="status"]') && !node.querySelector?.(MP.inbox.messageText))
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
    const label = buttons.map((button) => String(button.getAttribute("aria-label") || "").trim()).find((text) => text && !MP.matchesAny(text, MP.inbox.systemTexts, true));
    return label || "";
  };

  // Chip de resposta rápida: botão focável (tabindex ≠ -1) entre o nó e o balão. O botão-irmão do texto da mensagem
  // (tabindex=-1) não é chip.
  MP.insideChip = function insideChip(node, article) {
    for (let current = node; current && current !== article; current = current.parentElement) {
      if (current.getAttribute?.("role") === "button" && current.getAttribute?.("tabindex") !== "-1") return true;
    }
    return false;
  };

  // Mensagens do div[role=log]: cada div[role=article] (balão com data-message-id) e os separadores de hora (linhas
  // [data-release-focus-from] sem data-message-id) em ordem. external_id = "fb:" + data-message-id quando existe.
  // directionOf/attachmentsOf: geometria e imagens (só no navegador). Sem nenhum sinal, herda a direção anterior.
  MP.readLogRows = function readLogRows(log, { contactName = "", directionOf = null, attachmentsOf = () => [], now = new Date() } = {}) {
    const rows = [];
    const done = new Set();
    const nameKey = MP.normalize(contactName);
    let currentAt = null;
    let lastDirection = null;
    const units = log?.querySelectorAll?.(`${MP.inbox.article}, ${MP.inbox.messageId}, ${MP.inbox.timeSeparator}`) || [];
    const panels = MP.quickReplyPanels(log);
    for (const unit of units) {
      if (panels.some((panel) => panel.contains?.(unit))) continue;
      const article = unit.closest?.(MP.inbox.article) || (unit.matches?.(MP.inbox.messageId) ? unit : null);
      if (!article) {
        if (unit.closest?.(MP.inbox.messageId) || unit.querySelector?.(MP.inbox.messageId)) continue;
        const text = MP.textLeaves(unit).join(" ");
        if (text) currentAt = MP.parseClockSeparator(text, now);
        continue;
      }
      if (done.has(article)) continue;
      done.add(article);
      const idNode = article.matches?.(MP.inbox.messageId) ? article : article.querySelector(MP.inbox.messageId);
      const fbId = String(idNode?.getAttribute?.("data-message-id") || "").trim();
      // 1.9.1: só é mensagem o que tem data-message-id (aviso do sistema, chip e botão do painel não têm).
      if (!fbId) continue;
      // 1.9.7: balão que está DENTRO de um painel de resposta rápida não é mensagem; balão que CONTÉM o painel só vale pelo
      // texto fora dele (a sugestão com data-message-id próprio fica sem texto e sai).
      if (panels.some((panel) => panel !== article && panel.contains?.(article))) continue;
      const body = MP.articleText(article, { exclude: panels });
      const attachments = attachmentsOf(article) || [];
      if (!body && !attachments.length) continue;
      if (nameKey && MP.normalize(body) === nameKey) continue;
      const direction = MP.articleDirection(article) || (directionOf && directionOf(article)) || lastDirection || "inbound";
      lastDirection = direction;
      rows.push({ externalId: fbId ? `fb:${fbId}`.slice(0, 200) : "", direction, body, attachments, at: currentAt });
    }
    return rows;
  };

  // Painel "Envie uma resposta rápida" (título + botões de sugestão): o menor bloco acima do título que tem botões.
  MP.quickReplyPanels = function quickReplyPanels(root) {
    const panels = [];
    const titles = (MP.inbox.quickReplyTitles || []).map((title) => MP.normalize(title));
    for (const node of root?.querySelectorAll?.("span, div, h2, h3, [role=\"heading\"]") || []) {
      const own = [...(node.childNodes || [])].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(" ");
      const text = MP.normalize(own);
      if (!text || !titles.some((title) => text.startsWith(title))) continue;
      let panel = node;
      for (let level = 0; panel.parentElement && level < 6 && !panel.querySelector?.('[role="button"]'); level += 1) panel = panel.parentElement;
      if (panel.querySelector?.('[role="button"]') && !panel.querySelector?.(MP.inbox.messageId)) panels.push(panel);
    }
    return panels;
  };

  MP.isQuickReplySuggestion = function isQuickReplySuggestion(text) {
    const value = MP.normalize(text).replace(/[.!]+$/, "").trim();
    return Boolean(value) && (MP.inbox.quickReplySuggestions || []).some((pattern) => pattern.test(value));
  };

  MP.isSystemMessage = function isSystemMessage(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return Boolean(value) && (MP.inbox.systemPatterns || []).some((pattern) => pattern.test(value));
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
