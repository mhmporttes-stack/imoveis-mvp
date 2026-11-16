// Decisão pura (sem window/localStorage) de qual campanha o formulário público envia no cadastro.
// Regra: campanha explícita na URL (?c=) vale sempre; link PESSOAL de corretor (?ref=<corretor>, que não é
// "equipe") vence uma campanha apenas GUARDADA no navegador (localStorage); sem ref pessoal (link geral ou
// ?ref=equipe) a campanha guardada ainda vale. Motivo: o servidor dá prioridade à campanha ativa sobre o ref
// pessoal, então uma campanha antiga guardada desviava o cliente do link pessoal para a roleta.
export function isPersonalBrokerRef(brokerRef = "") {
  const ref = String(brokerRef || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return Boolean(ref) && ref !== "equipe";
}

// Retorna { campaignId, clearStored }: clearStored = true quando o id guardado deve ser apagado.
export function resolveCampaignIdForForm({ urlCampaign = "", storedCampaign = "", brokerRef = "" } = {}) {
  const fromUrl = String(urlCampaign || "").trim();
  if (fromUrl) return { campaignId: fromUrl, clearStored: false };
  const stored = String(storedCampaign || "").trim();
  if (isPersonalBrokerRef(brokerRef)) return { campaignId: "", clearStored: Boolean(stored) };
  return { campaignId: stored, clearStored: false };
}
