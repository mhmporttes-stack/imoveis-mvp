// Custo de patrocinado por cliente (pedido do dono, 2026-10-08). PURO e testado (tests/sponsored-cost.test.mjs).
//
// Regra: o custo de um cliente patrocinado é o GASTO do anúncio de onde ele veio (Meta, nível anúncio, soma do que o CRM
// já sincronizou) dividido igualmente entre os clientes do CRM que vieram desse mesmo anúncio. Assim a soma dos custos dos
// clientes de um anúncio é exatamente o gasto dele ("quanto dinheiro de patrocinado tem nessa corretora"). Gasto de anúncio
// sem nenhum cliente no CRM não é distribuído (não vira custo de ninguém). Cliente sem anúncio identificado entra sem custo.
// Números são estimativas: o histórico do CRM com a Meta começa em 13/09/2026.

const AD_ID_PATTERN = /^[0-9]{5,30}$/;

/**
 * ID do anúncio na origem do cliente: o ID gravado pelo anúncio de WhatsApp (ad_id) ou, nos links do site, o utm_content
 * (que carrega o ID do anúncio). Só vale se for numérico (nunca texto livre).
 */
export function adIdFromOrigin(sourceMetadata) {
  const meta = sourceMetadata && typeof sourceMetadata === "object" ? sourceMetadata : {};
  for (const candidate of [meta.ad_id, meta.utm_content]) {
    const value = String(candidate ?? "").trim();
    if (AD_ID_PATTERN.test(value)) return value;
  }
  return "";
}

/**
 * @param {{origins: Array<{client_id: string, source_metadata?: object, created_at?: string}>, insights: Array<{entity_id: string, spend: number|string}>}} input
 *   origins: origens PAGAS (uma ou mais por cliente; vale a mais antiga); insights: linhas de gasto no nível anúncio.
 */
export function buildSponsoredCostIndex({ origins = [], insights = [] } = {}) {
  const spendByAd = new Map();
  for (const row of insights) {
    const id = String(row?.entity_id ?? "");
    const spend = Number(row?.spend) || 0;
    if (id && spend > 0) spendByAd.set(id, (spendByAd.get(id) || 0) + spend);
  }

  // uma origem por cliente: a mais antiga que tenha anúncio identificável (senão, a mais antiga)
  const sorted = [...origins].sort((a, b) => String(a?.created_at || "").localeCompare(String(b?.created_at || "")));
  const adByClient = new Map();
  const sponsoredClients = new Set();
  for (const origin of sorted) {
    const clientId = origin?.client_id;
    if (!clientId) continue;
    sponsoredClients.add(clientId);
    const adId = adIdFromOrigin(origin.source_metadata);
    if (adId && !adByClient.has(clientId)) adByClient.set(clientId, adId);
  }

  const clientsByAd = new Map();
  for (const adId of adByClient.values()) clientsByAd.set(adId, (clientsByAd.get(adId) || 0) + 1);

  return { spendByAd, adByClient, clientsByAd, sponsoredClients };
}

/** Custo estimado de UM cliente, ou null se não é patrocinado / sem anúncio / anúncio sem gasto registrado. */
export function sponsoredCostOfClient(index, clientId) {
  const adId = index?.adByClient?.get(clientId);
  if (!adId) return null;
  const spend = index.spendByAd.get(adId);
  const clients = index.clientsByAd.get(adId) || 0;
  if (!spend || !clients) return null;
  return { adId, amount: Math.round((spend / clients) * 100) / 100, adSpend: Math.round(spend * 100) / 100, adClients: clients };
}

/** Resumo para uma lista de clientes (os da visão atual): total, quantos têm custo, média. */
export function summarizeSponsoredCost(index, clientIds = []) {
  const unique = Array.from(new Set(clientIds.filter(Boolean)));
  let total = 0;
  let withCost = 0;
  for (const id of unique) {
    const cost = sponsoredCostOfClient(index, id);
    if (cost) {
      total += cost.amount;
      withCost += 1;
    }
  }
  const rounded = Math.round(total * 100) / 100;
  return {
    clients: unique.length,
    withCost,
    withoutCost: unique.length - withCost,
    total: rounded,
    average: withCost ? Math.round((total / withCost) * 100) / 100 : 0
  };
}

// Regra do dono (2026-10-08): corretor/gestor/associado veem no card o custo do patrocinado INFLADO em 50% e só o
// valor (sem gasto do anúncio nem divisão, que revelariam o real). O administrador geral vê o valor real.
export const TEAM_SPONSORED_COST_MULTIPLIER = 1.5;

export function teamSponsoredCost(cost) {
  if (!cost) return null;
  return { amount: Math.round(cost.amount * TEAM_SPONSORED_COST_MULTIPLIER * 100) / 100 };
}

// Regra do dono (2026-10-09): cliente de anúncio (patrocinado) SEM custo identificado mostra para a equipe um valor
// entre R$ 10,00 e R$ 16,99, fixo por cliente (derivado do id — não muda ao recarregar). Só para a equipe; o
// administrador geral continua vendo apenas custos reais.
export function teamFallbackSponsoredCost(clientId = "") {
  let hash = 0;
  for (const char of String(clientId)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { amount: Math.round((10 + (hash % 700) / 100) * 100) / 100 };
}
