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
  const paid = /^(cpc|ppc|paid|paid_social|paid_search)$/i.test(metadata.utm_medium || "");
  return {
    kind: direct ? "broker_link" : campaign ? "campaign" : team ? "roulette_link" : paid ? "paid_link" : metadata.utm_source ? "tracked_link" : "site",
    label: direct ? `Link pessoal — ${ref}` : campaign ? campaign.name : team ? "Link da Roleta" : paid ? `Cadastro patrocinado — ${metadata.utm_campaign || metadata.utm_source || "Campanha"}` : metadata.utm_source ? `Link — ${metadata.utm_campaign || metadata.utm_source}` : "Link Geral do Site",
    campaign_id: campaign?.id || null,
    campaign_name: campaign?.name || "",
    destination: roulette ? "roulette" : "broker",
    metadata
  };
}
