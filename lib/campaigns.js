import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getAdminProfileById, getSiteBaseUrl } from "./admin-profiles";

export const CAMPAIGN_DESTINATION = {
  ROULETTE: "roulette",
  BROKER: "broker"
};

export const CAMPAIGN_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive"
};

export function canManageCampaigns() {
  return hasSupabaseAdminConfig;
}

export async function listCampaigns() {
  const supabase = getCampaignsClient();
  const [{ data: campaigns, error }, counts] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    countClientsByCampaign()
  ]);

  if (error) throw error;

  const brokerIds = [...new Set((campaigns || []).map((row) => row.broker_id).filter(Boolean))];
  const brokerNames = await getBrokerNamesByIds(brokerIds);

  return (campaigns || []).map((row) => rowToCampaign(row, {
    brokerName: brokerNames[row.broker_id] || "",
    clientCount: counts[row.id] || 0
  }));
}

export async function getCampaign(id) {
  if (!id) return null;
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const brokerNames = data.broker_id ? await getBrokerNamesByIds([data.broker_id]) : {};
  return rowToCampaign(data, { brokerName: brokerNames[data.broker_id] || "" });
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

export async function recordClientOrigin({ clientId, campaignId, campaignNameSnapshot }) {
  if (!clientId || !campaignId) return null;
  const supabase = getCampaignsClient();
  const { error } = await supabase.from("client_origins").insert({
    client_id: clientId,
    campaign_id: campaignId,
    campaign_name_snapshot: campaignNameSnapshot || ""
  });
  if (error) throw error;
  return true;
}

export function buildCampaignLink(campaign) {
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
    status
  };
}

export function rowToCampaign(row = {}, extra = {}) {
  return {
    id: row.id,
    name: row.name || "",
    destinationType: row.destination_type || CAMPAIGN_DESTINATION.ROULETTE,
    brokerId: row.broker_id || "",
    brokerName: extra.brokerName || "",
    status: row.status || CAMPAIGN_STATUS.ACTIVE,
    slug: row.slug || "",
    clientCount: extra.clientCount || 0,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

async function countClientsByCampaign() {
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("client_origins").select("campaign_id").not("campaign_id", "is", null);
  if (error) throw error;
  return (data || []).reduce((result, row) => {
    if (!row.campaign_id) return result;
    result[row.campaign_id] = (result[row.campaign_id] || 0) + 1;
    return result;
  }, {});
}

async function getBrokerNamesByIds(ids = []) {
  if (!ids.length) return {};
  const supabase = getCampaignsClient();
  const { data, error } = await supabase.from("admin_users").select("id, name").in("id", ids);
  if (error) throw error;
  return (data || []).reduce((result, row) => {
    result[row.id] = row.name || "";
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
