import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { buildBrokerSimulationLink, getAdminProfileById, getSiteBaseUrl } from "./admin-profiles";
import { CLIENT_STATUS_VALUES, clientStatusLabel, getClientFunnelStage } from "./client-status";
import { resolveOverviewRange } from "./performance-overview";

export const CAMPAIGN_DESTINATION = {
  ROULETTE: "roulette",
  BROKER: "broker"
};

export const CAMPAIGN_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive"
};

// "official": link de identidade do corretor/gestor/admin — criado e mantido
// automaticamente pelo ciclo de vida do usuário (lib/admin-profiles.js),
// nunca pela tela do Gerador de Links. "custom": campanha criada manualmente
// (o que já existia antes desta correção). Reaproveitam a MESMA tabela e o
// MESMO pipeline de clique/origem — só o "kind" separa a exibição/edição.
export const CAMPAIGN_KIND = {
  OFFICIAL: "official",
  CUSTOM: "custom"
};

// Cargos que têm carteira própria de clientes e por isso ganham link oficial
// automático — associado não (a carteira dele é a do corretor vinculado).
const OFFICIAL_LINK_ROLES = new Set(["admin", "broker", "manager"]);

export function canManageCampaigns() {
  return hasSupabaseAdminConfig;
}

// Lista campanhas (oficiais + personalizadas) já com métricas: cliques,
// cadastros históricos (imutáveis a exclusão/arquivamento/transferência —
// ver client_origins no banco) e a distribuição ATUAL de status dos clientes
// ainda existentes. Tudo em um número fixo de consultas (nunca uma por
// cliente): 1 para as campanhas, 1 para nomes de corretor, N em paralelo
// (uma por campanha, só COUNT) para cliques, e 1 paginada para toda a base
// de client_origins relevante ao período/filtro.
export async function listCampaigns({ period, startDate, endDate, type = "all", search = "" } = {}) {
  const supabase = getCampaignsClient();
  const range = period ? resolveOverviewRange({ period, startDate, endDate }) : null;

  let query = supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  if (type === CAMPAIGN_KIND.OFFICIAL || type === CAMPAIGN_KIND.CUSTOM) query = query.eq("kind", type);
  const { data: campaignRows, error } = await query;
  if (error) throw error;

  let campaigns = campaignRows || [];
  const trimmedSearch = String(search || "").trim().toLowerCase();

  const brokerIds = [...new Set(campaigns.map((row) => row.broker_id).filter(Boolean))];
  const brokerInfo = await getBrokerInfoByIds(brokerIds);

  if (trimmedSearch) {
    campaigns = campaigns.filter((row) =>
      (row.name || "").toLowerCase().includes(trimmedSearch) ||
      (brokerInfo[row.broker_id]?.name || "").toLowerCase().includes(trimmedSearch)
    );
  }

  const campaignIds = campaigns.map((row) => row.id);
  const [viewCounts, originsByCampaign, duplicateCounts] = await Promise.all([
    countViewsByCampaign(campaignIds, range),
    loadOriginsByCampaign(campaignIds, range),
    countDuplicateSubmissionsByCampaign(campaignIds, range)
  ]);

  const rows = campaigns.map((row) => {
    const origins = originsByCampaign.get(row.id) || [];
    const funnel = summarizeFunnel(origins);
    return rowToCampaign(row, {
      brokerName: brokerInfo[row.broker_id]?.name || "",
      brokerSimulationRef: brokerInfo[row.broker_id]?.simulationRef || "",
      clientCount: origins.length,
      duplicateCount: duplicateCounts[row.id] || 0,
      viewCount: viewCounts[row.id] || 0,
      funnel
    });
  });

  const summary = rows.reduce((total, row) => ({
    views: total.views + row.viewCount,
    clients: total.clients + row.clientCount,
    submissions: total.submissions + row.submissionCount,
    simulation: total.simulation + (row.funnel.simulation || 0),
    sale: total.sale + (row.funnel.sale || 0)
  }), { views: 0, clients: 0, submissions: 0, simulation: 0, sale: 0 });

  return {
    range,
    campaigns: rows,
    summary: {
      ...summary,
      conversion: summary.views ? summary.submissions / summary.views : null
    }
  };
}

// Registra UMA abertura do link (visitante anônimo, sem dado pessoal nenhum)
// — best-effort de propósito: nunca deve travar/quebrar a experiência do
// visitante nem revelar se um id de campanha existe. Um campaignId inválido
// simplesmente falha a foreign key e é ignorado.
export async function recordCampaignLinkView(campaignId) {
  const id = String(campaignId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await getSupabaseAdminClient().from("campaign_link_views").insert({ campaign_id: id });
  if (error) console.warn("Falha ao registrar abertura de link de campanha:", error.message || error);
}

// Usada pelo link pessoal (?ref=) do corretor/gestor/admin — mesma rota de
// rastreio de clique da campanha, só que resolvendo o "ref" para o link
// oficial daquele usuário antes de contar a abertura.
export async function recordOfficialLinkViewByRef(ref) {
  const { resolveAdminProfileByRef } = await import("./admin-profiles");
  const profile = await resolveAdminProfileByRef(ref, "simulation");
  if (!profile?.id) return;
  const campaign = await getOfficialCampaignForBroker(profile.id);
  if (campaign) await recordCampaignLinkView(campaign.id);
}

// Mesmas métricas (cliques, cadastros históricos, funil) de listCampaigns,
// só que para UM link — usada pelo cabeçalho da página de detalhe. Precisa
// ser exatamente a mesma conta, senão o card da lista e o detalhamento
// divergem (bug real encontrado em produção: getCampaign nunca calculava
// nada, sempre voltava 0/0 aqui mesmo com o card da lista mostrando o
// número certo).
export async function getCampaign(id) {
  if (!id) return null;
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [brokerInfo, viewCounts, originsByCampaign, duplicateCounts] = await Promise.all([
    data.broker_id ? getBrokerInfoByIds([data.broker_id]) : Promise.resolve({}),
    countViewsByCampaign([data.id]),
    loadOriginsByCampaign([data.id], null),
    countDuplicateSubmissionsByCampaign([data.id])
  ]);

  const origins = originsByCampaign.get(data.id) || [];
  return rowToCampaign(data, {
    brokerName: brokerInfo[data.broker_id]?.name || "",
    brokerSimulationRef: brokerInfo[data.broker_id]?.simulationRef || "",
    clientCount: origins.length,
    duplicateCount: duplicateCounts[data.id] || 0,
    viewCount: viewCounts[data.id] || 0,
    funnel: summarizeFunnel(origins)
  });
}

export async function createCampaign(payload = {}) {
  const record = await buildCampaignRecord(payload);
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("campaigns").insert(record).select("*").single();
  if (error) throw error;
  return getCampaign(data.id);
}

export async function updateCampaign(id, updates = {}) {
  const supabase = getCampaignsClient();
  const { data: current, error: readError } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) return null;
  if (current.kind === CAMPAIGN_KIND.OFFICIAL) {
    throw new Error("Links oficiais são gerenciados automaticamente pelo cadastro do usuário e não podem ser editados aqui.");
  }

  const merged = {
    name: updates.name !== undefined ? updates.name : current.name,
    destinationType: updates.destinationType !== undefined ? updates.destinationType : current.destination_type,
    brokerId: updates.brokerId !== undefined ? updates.brokerId : current.broker_id,
    status: updates.status !== undefined ? updates.status : current.status
  };

  const record = await buildCampaignRecord(merged);

  const { data, error } = await supabase.from("campaigns").update(record).eq("id", id).select("*").single();
  if (error) throw error;
  return getCampaign(data.id);
}

export async function setCampaignStatus(id, status) {
  return updateCampaign(id, { status });
}

export async function deleteCampaign(id) {
  const supabase = getCampaignsClient();
  const { data: current, error: readError } = await supabase.from("campaigns").select("kind").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (current?.kind === CAMPAIGN_KIND.OFFICIAL) {
    throw new Error("Links oficiais não podem ser excluídos — desative o usuário para encerrar o link mantendo o histórico.");
  }
  // client_origins.campaign_id e "on delete set null" (com o nome da campanha
  // ja salvo em campaign_name_snapshot), entao excluir a campanha nao apaga
  // nem desvincula os cadastros que ja vieram por esse link — so encerra o
  // link em si.
  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) throw error;
  return true;
}

// Cria (se ainda não existir) o link oficial de um usuário elegível — chamada
// no cadastro do usuário (lib/admin-profiles.js) e, uma vez, no backfill da
// migration para quem já existia antes desta correção. Idempotente: se já
// existe (unique index campaigns_official_broker_unique), não faz nada.
export async function ensureOfficialCampaignForBroker(brokerId, { name = "", status = CAMPAIGN_STATUS.ACTIVE, role = "" } = {}) {
  if (!brokerId || !OFFICIAL_LINK_ROLES.has(role)) return null;
  const existing = await getOfficialCampaignForBroker(brokerId);
  if (existing) return existing;

  const supabase = getCampaignsClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ broker_id: brokerId, name: name || "Link oficial", destination_type: CAMPAIGN_DESTINATION.BROKER, status, kind: CAMPAIGN_KIND.OFFICIAL })
    .select("*")
    .single();
  if (error) {
    // Corrida concorrente (ex.: dois cliques em "salvar" no cadastro do
    // mesmo usuário): o índice único parcial (campaigns_official_broker_unique)
    // barra a segunda inserção — a primeira já criou o link oficial.
    if (error.code === "23505") return getOfficialCampaignForBroker(brokerId);
    throw error;
  }
  return rowToCampaign(data);
}

export async function getOfficialCampaignForBroker(brokerId) {
  if (!brokerId) return null;
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("campaigns").select("*").eq("broker_id", brokerId).eq("kind", CAMPAIGN_KIND.OFFICIAL).maybeSingle();
  if (error) throw error;
  return data ? rowToCampaign(data) : null;
}

// Mantém o link oficial coerente com o status da conta — nunca apaga nada,
// só marca Inativo (histórico de cliques/cadastros continua disponível).
export async function setOfficialCampaignStatusForBroker(brokerId, status) {
  if (!brokerId) return;
  const supabase = getCampaignsClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ status: status === CAMPAIGN_STATUS.INACTIVE ? CAMPAIGN_STATUS.INACTIVE : CAMPAIGN_STATUS.ACTIVE })
    .eq("broker_id", brokerId)
    .eq("kind", CAMPAIGN_KIND.OFFICIAL);
  if (error) console.warn("Falha ao sincronizar status do link oficial:", error.message || error);
}

// Sincroniza o NOME do link oficial com o nome atual do usuário (o usuário
// nunca edita o link diretamente — ver updateCampaign acima).
export async function renameOfficialCampaignForBroker(brokerId, name) {
  if (!brokerId || !name) return;
  const supabase = getCampaignsClient();
  const { error } = await supabase.from("campaigns").update({ name }).eq("broker_id", brokerId).eq("kind", CAMPAIGN_KIND.OFFICIAL);
  if (error) console.warn("Falha ao sincronizar nome do link oficial:", error.message || error);
}

export async function listCampaignClients(campaignId) {
  const supabase = getCampaignsClient();
  const { data, error } = await supabase
    .from("client_origins")
    .select("id, created_at, client:simulation_registrations(id, full_name, phone, status, created_at)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => row.client)
    .map((row) => ({
      originId: row.id,
      registeredViaLinkAt: row.created_at,
      id: row.client.id,
      fullName: row.client.full_name || "",
      phone: row.client.phone || "",
      status: row.client.status || "",
      createdAt: row.client.created_at || ""
    }));
}

// Distribuição ATUAL de status dos clientes ainda existentes daquele link —
// nomes/etapas exatamente os já usados em todo o resto do CRM
// (clientStatusLabel, lib/client-status.js), nunca uma lista própria. Clientes
// excluídos (client_id nulo em client_origins) não entram aqui — mas
// continuam contando no total histórico de cadastros (getCampaign* acima),
// que é a métrica principal e nunca some.
export async function getCampaignStatusBreakdown(campaignId) {
  const rows = await fetchAllRows((from, to) =>
    getCampaignsClient()
      .from("client_origins")
      .select("client:simulation_registrations(status)")
      .eq("campaign_id", campaignId)
      .not("client_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const counts = new Map();
  for (const row of rows) {
    const status = row.client?.status;
    if (!status) continue;
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return CLIENT_STATUS_VALUES.filter((status) => counts.has(status)).map((status) => ({
    status,
    label: clientStatusLabel(status),
    count: counts.get(status)
  }));
}

// Link oficial: é o MESMO link pessoal que o corretor/gestor/admin já usa
// hoje (?ref=<simulationRef>, buildBrokerSimulationLink — nunca alterado).
// Link personalizado: mantém a URL ?c=<id> de sempre. Nunca inventa uma
// segunda URL para um link que já existe e já foi divulgado.
export function buildCampaignLink(campaign) {
  if (campaign.kind === CAMPAIGN_KIND.OFFICIAL && campaign.brokerSimulationRef) {
    return buildBrokerSimulationLink({ simulationRef: campaign.brokerSimulationRef });
  }
  return `${getSiteBaseUrl()}/simulacao?c=${encodeURIComponent(campaign.id)}`;
}

export function formatCampaignError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (
    (error?.code === "42P01" || error?.code === "PGRST205" || normalized.includes("does not exist")) &&
    (normalized.includes("campaigns") || normalized.includes("client_origins"))
  ) {
    return "As tabelas de campanhas ainda não existem no Supabase. Execute a migration supabase/migrations/20260910_campaigns_gerador_de_links.sql no SQL Editor do Supabase.";
  }

  if (error?.code === "23514" || normalized.includes("violates check constraint")) {
    return "Confira o nome, o destino e o corretor selecionado antes de salvar.";
  }

  if (error?.code === "23503" || normalized.includes("violates foreign key constraint")) {
    return "O corretor selecionado não foi encontrado.";
  }

  return message || "Não foi possível concluir a operação com a campanha.";
}

async function buildCampaignRecord(payload = {}) {
  const name = String(payload.name || "").trim();
  if (!name || name.length < 2) {
    throw new Error("Informe o nome da campanha.");
  }

  const destinationType = payload.destinationType === CAMPAIGN_DESTINATION.BROKER
    ? CAMPAIGN_DESTINATION.BROKER
    : CAMPAIGN_DESTINATION.ROULETTE;

  const status = payload.status === CAMPAIGN_STATUS.INACTIVE ? CAMPAIGN_STATUS.INACTIVE : CAMPAIGN_STATUS.ACTIVE;

  let brokerId = null;
  if (destinationType === CAMPAIGN_DESTINATION.BROKER) {
    brokerId = String(payload.brokerId || "").trim();
    if (!brokerId) {
      throw new Error("Selecione o corretor responsável por esta campanha.");
    }
    const broker = await getAdminProfileById(brokerId);
    if (!broker || !["admin", "broker"].includes(broker.role)) {
      throw new Error("O corretor selecionado é inválido.");
    }
  }

  return {
    name,
    destination_type: destinationType,
    broker_id: brokerId,
    status,
    kind: CAMPAIGN_KIND.CUSTOM
  };
}

export function rowToCampaign(row = {}, extra = {}) {
  return {
    id: row.id,
    name: row.name || "",
    destinationType: row.destination_type || CAMPAIGN_DESTINATION.ROULETTE,
    brokerId: row.broker_id || "",
    brokerName: extra.brokerName || "",
    brokerSimulationRef: extra.brokerSimulationRef || "",
    status: row.status || CAMPAIGN_STATUS.ACTIVE,
    kind: row.kind || CAMPAIGN_KIND.CUSTOM,
    slug: row.slug || "",
    // Destino do link (item 15 do "Disparo") — 'choice' (padrão) preserva a
    // tela atual de escolha entre Atendimento Rápido/Simulação; só campanhas
    // criadas pelo Disparo (ou futuramente pelo Gerador de Links) configuram
    // um valor diferente para pular direto a um dos dois formulários.
    linkJourney: row.link_journey || "choice",
    // clientCount = clientes únicos (1 por pessoa, no primeiro envio).
    // submissionCount = TODOS os envios do formulário por este link, incluindo
    // reenvios da mesma pessoa — é o número comparável ao "leads" da Meta.
    clientCount: extra.clientCount || 0,
    duplicateCount: extra.duplicateCount || 0,
    submissionCount: (extra.clientCount || 0) + (extra.duplicateCount || 0),
    viewCount: extra.viewCount || 0,
    funnel: extra.funnel || { simulation: 0, sale: 0 },
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

// PostgREST devolve no máximo 1000 linhas por padrão sem `.range()` —
// paginação explícita para qualquer consulta que possa crescer além disso
// (client_origins tende a crescer mais rápido que campanhas/corretores).
async function fetchAllRows(buildQuery) {
  const PAGE_SIZE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// Uma linha de client_origins por conversão, para TODAS as campanhas
// relevantes de uma vez (nunca uma consulta por campanha) — a contagem
// histórica de cada link é simplesmente o tamanho do grupo (imutável a
// exclusão/arquivamento/transferência, porque client_origins nunca perde a
// linha, só o client_id quando o cliente é excluído). O funil ATUAL usa só
// as linhas com cliente ainda existente.
async function loadOriginsByCampaign(campaignIds, range) {
  const byCampaign = new Map();
  if (!campaignIds.length) return byCampaign;

  const rows = await fetchAllRows((from, to) => {
    let query = getCampaignsClient()
      .from("client_origins")
      .select("campaign_id, client_id, created_at, client:simulation_registrations(status)")
      .in("campaign_id", campaignIds)
      .order("id", { ascending: true })
      .range(from, to);
    if (range?.startIso) query = query.gte("created_at", range.startIso);
    if (range?.endIso) query = query.lt("created_at", range.endIso);
    return query;
  });

  for (const row of rows) {
    if (!byCampaign.has(row.campaign_id)) byCampaign.set(row.campaign_id, []);
    byCampaign.get(row.campaign_id).push(row);
  }
  return byCampaign;
}

// Contagem NÃO-cumulativa por macroetapa do funil comercial (mesma fonte de
// verdade de lib/client-status.js, getClientFunnelStage — nunca uma lista
// própria) — usada só no resumo do topo (Simulações/Vendas). O detalhamento
// por link (getCampaignStatusBreakdown) usa o status bruto, mais granular.
function summarizeFunnel(origins) {
  const funnel = { simulation: 0, sale: 0 };
  for (const row of origins) {
    if (!row.client_id || !row.client?.status) continue;
    const stage = getClientFunnelStage(row.client.status);
    if (stage === "simulation") funnel.simulation += 1;
    else if (stage === "sale") funnel.sale += 1;
  }
  return funnel;
}

// Reenvio do formulário pela mesma pessoa (cadastro já existia): não cria
// cliente novo, mas conta como cadastro do link — ver migration
// 20260923190000. Best-effort: nunca derruba o cadastro do visitante.
export async function recordCampaignDuplicateSubmission({ campaignId, clientId = null, journeyType = "" } = {}) {
  const id = String(campaignId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  try {
    const { error } = await getSupabaseAdminClient()
      .from("campaign_link_duplicate_submissions")
      .insert({ campaign_id: id, client_id: clientId || null, journey_type: journeyType || null });
    if (error) console.warn("Falha ao registrar reenvio de cadastro do link:", error.message || error);
  } catch (error) {
    console.warn("Falha ao registrar reenvio de cadastro do link:", error?.message || error);
  }
}

async function countDuplicateSubmissionsByCampaign(campaignIds = [], range = null) {
  if (!campaignIds.length) return {};
  const supabase = getCampaignsClient();
  const counts = await Promise.all(
    campaignIds.map((id) => {
      let query = supabase.from("campaign_link_duplicate_submissions").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      if (range?.startIso) query = query.gte("created_at", range.startIso);
      if (range?.endIso) query = query.lt("created_at", range.endIso);
      return query;
    })
  );
  return campaignIds.reduce((result, id, index) => {
    const { count, error } = counts[index];
    // Tabela ainda não criada (migration pendente): não derruba a tela do Gerador de Links.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
    result[id] = error ? 0 : count || 0;
    return result;
  }, {});
}

async function countViewsByCampaign(campaignIds = [], range = null) {
  if (!campaignIds.length) return {};
  const supabase = getCampaignsClient();
  const counts = await Promise.all(
    campaignIds.map((id) => {
      let query = supabase.from("campaign_link_views").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      if (range?.startIso) query = query.gte("created_at", range.startIso);
      if (range?.endIso) query = query.lt("created_at", range.endIso);
      return query;
    })
  );
  return campaignIds.reduce((result, id, index) => {
    const { count, error } = counts[index];
    if (error) throw error;
    result[id] = count || 0;
    return result;
  }, {});
}

// Nome + simulation_ref (necessário pra montar o link REAL de um link
// oficial — ver buildCampaignLink — nunca uma URL nova ?c=, que quebraria a
// expectativa de "é o mesmo link que a pessoa já divulgou").
async function getBrokerInfoByIds(ids = []) {
  if (!ids.length) return {};
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("admin_users").select("id, name, simulation_ref").in("id", ids);
  if (error) throw error;
  return (data || []).reduce((result, row) => {
    result[row.id] = { name: row.name || "", simulationRef: row.simulation_ref || "" };
    return result;
  }, {});
}

function getCampaignsClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo não configurado para gerenciar campanhas.");
  }
  return supabase;
}
