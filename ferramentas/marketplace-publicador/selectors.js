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
    listingLink: 'a[href*="/marketplace/item/"]'
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

  // Sugestão de localização a escolher (formulário real, 2026-10-20: a lista mistura ruas, CEPs, outras cidades e
  // várias "Marília, SP · Cidade"; o texto pode vir com espaço não separável e em spans aninhados).
  // 1º: contém "marilia" + ("sp" ou "sao paulo") + "cidade"; 2º: contém "marilia" + ("sp"/"sao paulo") e NÃO é
  // endereço (sem número/CEP); 3º: 1ª que começa com "marilia". -1 = nenhuma.
  MP.pickLocationIndex = function pickLocationIndex(texts, city = "Marília", state = "SP") {
    const cityKey = MP.normalize(city);
    const stateKeys = [MP.normalize(state), "sao paulo"];
    const items = texts.map((text) => MP.normalize(text));
    const hasCity = (text) => new RegExp(`(^|[^a-z])${cityKey}([^a-z]|$)`).test(text);
    const hasState = (text) => stateKeys.some((key) => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`).test(text));
    const firstLine = (index) => MP.normalize(String(texts[index] || "").split("\n")[0]);
    const isAddress = (index) => /\d/.test(firstLine(index));
    let index = items.findIndex((text, i) => hasCity(text) && hasState(text) && /(^|[^a-z])(cidade|city)([^a-z]|$)/.test(text) && !isAddress(i));
    if (index < 0) index = items.findIndex((text, i) => hasCity(text) && hasState(text) && !isAddress(i));
    if (index < 0) index = items.findIndex((text) => text.startsWith(cityKey) && hasCity(text));
    return index;
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

  root.MP = MP;
})(typeof globalThis !== "undefined" ? globalThis : self);
