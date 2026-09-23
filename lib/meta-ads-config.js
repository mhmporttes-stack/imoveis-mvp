import "server-only";

// Configuração centralizada da integração de LEITURA com a Meta Marketing
// API (Gestão de Tráfego, Fase 1). Token e ad account SEPARADOS de
// WHATSAPP_ACCESS_TOKEN e META_CONVERSIONS_API_ACCESS_TOKEN — escopos e
// finalidades diferentes, nunca reaproveitar um pelo outro.
//
// Fallback de versão documentado aqui (nunca hardcoded em outro arquivo):
// usar sempre a versão configurada em META_ADS_GRAPH_API_VERSION; o valor
// abaixo só cobre a ausência da env em ambiente de desenvolvimento e deve
// ser revisado contra a versão vigente da Graph API quando a integração for
// ativada de verdade.
const FALLBACK_GRAPH_API_VERSION = "v23.0";

const DEFAULT_SYNC_WINDOW_DAYS = 10;

export function getMetaAdsAccessToken() {
  return process.env.META_ADS_ACCESS_TOKEN || "";
}

export function getMetaAdsGraphApiVersion() {
  return process.env.META_ADS_GRAPH_API_VERSION || FALLBACK_GRAPH_API_VERSION;
}

export function getMetaAdsGraphBaseUrl() {
  return `https://graph.facebook.com/${getMetaAdsGraphApiVersion()}`;
}

// Aceita o valor configurado com ou sem o prefixo "act_" — sempre devolve
// só o id numérico; getMetaAdsAccountPath() monta o prefixo quando preciso.
export function getMetaAdsAdAccountId() {
  return String(process.env.META_ADS_AD_ACCOUNT_ID || "").trim().replace(/^act_/, "");
}

export function getMetaAdsAccountPath() {
  const id = getMetaAdsAdAccountId();
  return id ? `act_${id}` : "";
}

export function hasMetaAdsReadConfig() {
  return Boolean(getMetaAdsAccessToken() && getMetaAdsAdAccountId());
}

// Diagnóstico sem nunca expor o token — usado nas respostas de sync/cron
// para dizer exatamente o que falta configurar, sem inventar resultado.
export function getMetaAdsConfigStatus() {
  const missing = [];
  if (!getMetaAdsAccessToken()) missing.push("META_ADS_ACCESS_TOKEN");
  if (!getMetaAdsAdAccountId()) missing.push("META_ADS_AD_ACCOUNT_ID");
  return { configured: missing.length === 0, missing };
}

export function getMetaAdsBackfillStartDate() {
  return String(process.env.META_ADS_BACKFILL_START_DATE || "").trim();
}

export function getMetaAdsSyncWindowDays() {
  const value = Number(process.env.META_ADS_SYNC_WINDOW_DAYS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_SYNC_WINDOW_DAYS;
}

// Janela/modelo de atribuição usado nas chamadas de insights — documentado
// aqui (nunca implícito) porque é isso que explica por que o mesmo dia pode
// ter o número de leads revisado numa sincronização posterior. Ajustar este
// valor junto com o parâmetro real enviado à API em meta-ads-sync.js.
export const META_ADS_ATTRIBUTION_WINDOW = "7d_click_1d_view";
