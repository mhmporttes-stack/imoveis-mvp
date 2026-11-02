// Decisão "é mídia paga?" + canal pago, em função pura (sem server-only) para
// ser testável e reutilizável. Valores pagos reconhecidos:
// - padrão atual: utm_medium cpc/ppc/paid/paid_social/paid_search (inalterado);
// - formato antigo do Fluxo "Anúncio WhatsApp — formulário direto" (gatilho
//   ad_referral): utm_medium=anuncio/anúncio (case-insensitive, com/sem acento).
// Não amplie para valores sem evidência nos dados (ex.: "social" segue orgânico).
// paid_channel só é preenchido com evidência: "ctwa_formulario" só é enviado
// pelo Fluxo que dispara em anúncio Click-to-WhatsApp → "whatsapp_ad";
// utm_source fb/ig com medium pago → "meta_site"; demais pagos → sem canal.
import { CLICK_ID_KEYS, cleanClickId } from "./ad-click-attribution.mjs";

const PAID_MEDIUM_PATTERN = /^(cpc|ppc|paid|paid_social|paid_search|anuncio)$/i;
const META_SOURCE_PATTERN = /^(fb|ig)$/i;

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Google Ads (campanha "Aplicativos", dono 2026-11-02): decidido AQUI, no servidor, a partir dos parâmetros recebidos —
// utm_source=google com medium pago (cpc/ppc/paid...) OU qualquer identificador de clique do auto-tagging (gclid/gbraid/wbraid,
// que só o Google Ads anexa). Nunca por texto livre. `classifyPaidMedia` não muda (Meta/WhatsApp inalterados).
export const GOOGLE_ADS_TAG = "Google Ads";
const GOOGLE_SOURCE_PATTERN = /^google$/i;

export function isGoogleAdsAttribution(attribution = {}) {
  const source = String(attribution?.utm_source || "").trim();
  const paidMedium = PAID_MEDIUM_PATTERN.test(stripAccents(attribution?.utm_medium));
  if (GOOGLE_SOURCE_PATTERN.test(source) && paidMedium) return true;
  return CLICK_ID_KEYS.some((key) => Boolean(cleanClickId(attribution?.[key])));
}

// utm_campaign "apps-marilia" (padrão do briefing) = "Aplicativos"; outra campanha do Google Ads mostra o nome dela.
export function googleAdsLabel(utmCampaign = "") {
  const campaign = String(utmCampaign || "").trim();
  if (!campaign || /^apps?([-_\s]|$)/i.test(campaign)) return "Google Ads — Aplicativos";
  return `Google Ads — ${campaign}`;
}

export function classifyPaidMedia({ utm_source, utm_medium, utm_campaign } = {}) {
  const paid = PAID_MEDIUM_PATTERN.test(stripAccents(utm_medium));
  if (!paid) return { paid: false, channel: null };
  if (String(utm_campaign || "") === "ctwa_formulario") return { paid: true, channel: "whatsapp_ad" };
  if (META_SOURCE_PATTERN.test(String(utm_source || ""))) return { paid: true, channel: "meta_site" };
  return { paid: true, channel: null };
}

// Evidência CONFIÁVEL de mídia paga numa origem já gravada (client_origins), para
// decidir o Guia de Atendimento de lead (decisão do dono, 2026-10-01): ID do
// anúncio (anúncio de WhatsApp), kind paid_link, marca paid_media gravada no
// cadastro, ou UTM paga reconhecida por classifyPaidMedia. Nunca por texto livre
// (rótulo "PATROCINADO", nome de campanha etc.).
export function hasPaidMediaEvidence(sourceKind = "", metadata = {}) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  if (String(sourceKind || "") === "paid_link") return true;
  if (typeof meta.ad_id === "string" && /^[0-9]{5,30}$/.test(meta.ad_id)) return true;
  if (meta.paid_media === true) return true;
  return classifyPaidMedia(meta).paid;
}

// "direct" (link pessoal/oficial do corretor, ?ref=) tem prioridade sobre
// "campaign" para efeito de kind/label — um link oficial agora TAMBÉM tem uma
// linha em campaigns (kind="official", ver lib/campaigns.js) só para
// reaproveitar 100% do pipeline de clique/contagem histórica, mas ele nunca
// deve ser rotulado/classificado como "campanha" (isso é reservado para links
// personalizados criados no Gerador de Links). campaign_id/campaign_name
// continuam vindo do objeto `campaign`, quando informado, independente do
// kind escolhido — é só isso que liga a conversão ao link no client_origins.
export function buildLeadOrigin({ campaign, direct, team, ref, roulette, attribution = {} }) {
  const metadata = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(key => [key, String(attribution?.[key] || "").replace(/[<>]/g, "").slice(0, 200)]).filter(([, value]) => value));
  if (ref) metadata.broker_ref = ref;
  // Qual jornada o visitante efetivamente escolheu quando o link deixava a
  // decisão em aberto ("Escolher ao acessar", item 22 do Disparo) — quando o
  // link já abre direto um dos dois formulários (destino fixo), o valor
  // também chega aqui, mas nesse caso é redundante com a própria campanha.
  const journeySelected = String(attribution?.journey_selected || "").trim();
  if (journeySelected === "quick_service" || journeySelected === "simulation") metadata.journey_selected = journeySelected;
  // Identificadores de clique do Google (validados; gravados em source_metadata para conferência com o Google Ads).
  for (const key of CLICK_ID_KEYS) {
    const clickId = cleanClickId(attribution?.[key]);
    if (clickId) metadata[key] = clickId;
  }
  const googleAds = isGoogleAdsAttribution(metadata);
  const { paid: paidByMedium, channel: paidChannel } = classifyPaidMedia(metadata);
  const paid = paidByMedium || googleAds;
  // Chaves aditivas (vão para client_origins.source_metadata); não mudam kind/label.
  if (paid) metadata.paid_media = true;
  if (paidChannel) metadata.paid_channel = paidChannel;
  if (googleAds) {
    metadata.paid_channel = "google_ads";
    metadata.google_ads = true;
  }
  return {
    kind: direct ? "broker_link" : campaign ? "campaign" : team ? "roulette_link" : paid ? "paid_link" : metadata.utm_source ? "tracked_link" : "site",
    label: direct ? `Link pessoal — ${ref}` : campaign ? campaign.name : team ? "Link da Roleta" : googleAds ? googleAdsLabel(metadata.utm_campaign) : paid ? `Cadastro patrocinado — ${metadata.utm_campaign || metadata.utm_source || "Campanha"}` : metadata.utm_source ? `Link — ${metadata.utm_campaign || metadata.utm_source}` : "Link Geral do Site",
    campaign_id: campaign?.id || null,
    campaign_name: campaign?.name || "",
    destination: roulette ? "roulette" : "broker",
    metadata
  };
}
