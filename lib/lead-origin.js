export function buildLeadOrigin({ campaign, direct, team, ref, roulette, attribution = {} }) {
  const metadata = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(key => [key, String(attribution?.[key] || "").replace(/[<>]/g, "").slice(0, 200)]).filter(([, value]) => value));
  if (ref) metadata.broker_ref = ref;
  const paid = /^(cpc|ppc|paid|paid_social|paid_search)$/i.test(metadata.utm_medium || "");
  return {
    kind: campaign ? "campaign" : direct ? "broker_link" : team ? "roulette_link" : paid ? "paid_link" : metadata.utm_source ? "tracked_link" : "site",
    label: campaign ? campaign.name : direct ? `Link pessoal — ${ref}` : team ? "Link da Roleta" : paid ? `Cadastro patrocinado — ${metadata.utm_campaign || metadata.utm_source || "Campanha"}` : metadata.utm_source ? `Link — ${metadata.utm_campaign || metadata.utm_source}` : "Link Geral do Site",
    campaign_id: campaign?.id || null,
    campaign_name: campaign?.name || "",
    destination: roulette ? "roulette" : "broker",
    metadata
  };
}
