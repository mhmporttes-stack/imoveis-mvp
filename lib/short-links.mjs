// Links curtos no próprio domínio (2026-10-04). São só ATALHOS: cada rota curta redireciona (307) para a URL longa
// de sempre, que continua valendo e é quem faz atribuição do corretor, roleta, origem, campanha, rastreio e cadastro.
//   /s            → /simulacao                 (simulação do Matheus)
//   /s/{ref}      → /simulacao?ref={ref}       (simulação individual do corretor/gestor/admin)
//   /c/{codigo}   → /simulacao?c={id}          (campanha/patrocinado; código = campaigns.short_code)
//   /v            → /captacao                  (venda seu imóvel)  /v/{ref} → /captacao?ref={ref}
//   /j/{token}    → /minha-jornada/{token}     (Minha Jornada do cliente)
// Qualquer outro parâmetro do link (jornada, utm_*, fbclid…) é repassado como veio.

export function cleanRef(value = "") {
  // mesma regra de normalizeBrokerRef (lib/admin-profiles.js)
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function shortSimulationPath(ref = "") {
  const clean = cleanRef(ref);
  return clean ? `/s/${encodeURIComponent(clean)}` : "/s";
}

export function shortCaptacaoPath(ref = "") {
  const clean = cleanRef(ref);
  return clean ? `/v/${encodeURIComponent(clean)}` : "/v";
}

export function shortCampaignPath(code = "") {
  const clean = String(code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean ? `/c/${clean}` : "";
}

export function shortJourneyPath(token = "") {
  const clean = String(token || "").trim();
  return clean ? `/j/${encodeURIComponent(clean)}` : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value = "") {
  return UUID_PATTERN.test(String(value || "").trim());
}

// decodeURIComponent que nunca lança (percent-encoding malformado vira o texto original).
export function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

// Como o link aparece/é copiado na tela: sem "https://www." (WhatsApp e Instagram linkam do mesmo jeito).
// O link completo continua sendo o que o servidor gera e o que vai nas mensagens automáticas.
export function displayLink(url = "") {
  return String(url || "").replace(/^https?:\/\/(www\.)?/i, "");
}
