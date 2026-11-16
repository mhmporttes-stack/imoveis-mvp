// Utilitário client-side para o Gerador de Links: guarda o id da campanha
// (parâmetro "?c=") no localStorage por alguns dias, para que ele sobreviva
// caso o visitante navegue por outras páginas do site antes de preencher o
// formulário de cadastro.

import { resolveCampaignIdForForm } from "./campaign-link-core.mjs";

export const CAMPAIGN_STORAGE_KEY = "mm_campaign_ref";
export const CAMPAIGN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function persistCampaignId(campaignId) {
  const id = String(campaignId || "").trim();
  if (!id || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      CAMPAIGN_STORAGE_KEY,
      JSON.stringify({ id, savedAt: Date.now() })
    );
  } catch {
    // localStorage indisponível (modo privado, navegador antigo, etc.).
  }
}

export function readStoredCampaignId() {
  if (typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw) return "";

    const parsed = JSON.parse(raw);
    const id = String(parsed?.id || "").trim();
    const savedAt = Number(parsed?.savedAt) || 0;
    if (!id || !savedAt) return "";

    if (Date.now() - savedAt > CAMPAIGN_MAX_AGE_MS) {
      window.localStorage.removeItem(CAMPAIGN_STORAGE_KEY);
      return "";
    }

    return id;
  } catch {
    return "";
  }
}

export function clearStoredCampaignId() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    // localStorage indisponível.
  }
}

// Campanha efetiva do formulário (ver lib/campaign-link-core.mjs): ref pessoal na URL vence campanha só guardada
// e apaga o id guardado, para não voltar a desviar o cliente em outro link.
export function resolveCampaignIdFromBrowser({ urlCampaign = "", brokerRef = "" } = {}) {
  const decision = resolveCampaignIdForForm({ urlCampaign, storedCampaign: readStoredCampaignId(), brokerRef });
  if (decision.clearStored) clearStoredCampaignId();
  return decision.campaignId;
}
