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
    categoryCard: [
      "Imóveis para venda ou aluguel",
      "Propriedade à venda ou para alugar",
      "Imóvel à venda ou para alugar",
      "Casa para venda ou aluguel",
      "Property for sale or rent",
      "Home for sale or rent"
    ],
    // kind: select (combobox do Facebook) | text | textarea | autocomplete
    fields: {
      offerType: {
        kind: "select",
        labels: ["Para venda ou aluguel", "Venda ou aluguel", "À venda ou para alugar", "Home for sale or rent", "For sale or rent"],
        options: { sale: ["À venda", "Venda", "Para venda", "For sale"], rent: ["Aluguel", "Para alugar", "For rent", "Rent"] }
      },
      propertyType: {
        kind: "select",
        labels: ["Tipo de imóvel", "Tipo de propriedade", "Tipo de residência", "Property type", "Home type"],
        options: {
          house: ["Casa", "House"],
          apartment: ["Apartamento", "Apartment"],
          townhouse: ["Casa geminada", "Sobrado", "Casa em condomínio", "Townhouse"],
          land: ["Terreno", "Lote", "Land"]
        }
      },
      bedrooms: { kind: "text", labels: ["Número de quartos", "Quartos", "Number of bedrooms", "Bedrooms"] },
      bathrooms: { kind: "text", labels: ["Número de banheiros", "Banheiros", "Number of bathrooms", "Bathrooms"] },
      price: { kind: "text", labels: ["Preço", "Preço por mês", "Price", "Price per month"] },
      location: { kind: "autocomplete", labels: ["Endereço do imóvel", "Endereço da propriedade", "Localização", "Endereço", "Property address", "Location"] },
      description: { kind: "textarea", labels: ["Descrição do imóvel", "Descrição da propriedade", "Descrição", "Property description", "Description"] },
      area: { kind: "text", labels: ["Metros quadrados", "Área em metros quadrados", "Área", "Square meters", "Square feet"] },
      title: { kind: "text", labels: ["Título", "Title"], optional: true }
    },
    photoInput: 'input[type="file"][accept*="image"], input[type="file"]',
    optionRoles: '[role="option"], [role="menuitemradio"], [role="menuitem"], [role="radio"]',
    buttons: {
      next: ["Avançar", "Próximo", "Continuar", "Next", "Continue"],
      publish: ["Publicar", "Publish", "Postar", "Post"]
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
