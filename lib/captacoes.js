import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { createProperty, getProperty } from "./properties";
import {
  captacaoAdminUpdateSchema,
  captacaoInputSchema,
  cleanText,
  formatCaptacaoMoney,
  formatCaptacaoStatus,
  formatCaptacaoType
} from "./captacoes-schema";
import {
  applyResponsibleUserScope,
  assertCanAccessResponsibleUser,
  assertGeneralAdmin,
  isAdminPermissionError
} from "./admin-access";
import {
  canUseProfileDatabaseScope,
  formatBrokerSchemaError,
  isBrokerSchemaError,
  resolveAdminProfileByRef
} from "./admin-profiles";

export function canManageCaptacoes() {
  return hasSupabaseAdminConfig;
}

export async function listCaptacoes(auth = null) {
  const supabase = getCaptacoesClient();
  let query = supabase
    .from("captacoes")
    .select("*")
    .order("created_at", { ascending: false });

  query = applyResponsibleUserScope(query, auth);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToCaptacao);
}

export async function getCaptacao(id, auth = null) {
  const supabase = getCaptacoesClient();
  const { data, error } = await supabase
    .from("captacoes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const captacao = rowToCaptacao(data);
  if (auth) assertCanAccessResponsibleUser(auth, captacao.responsibleUserId);
  return captacao;
}

export async function createCaptacao(payload) {
  const responsibleUserId = await resolveCaptacaoResponsibleUserId(payload);
  const parsed = captacaoInputSchema.parse(payload);
  const supabase = getCaptacoesClient();
  const { data, error } = await supabase
    .from("captacoes")
    .insert(captacaoToRecord({ ...parsed, responsibleUserId }))
    .select("*")
    .single();

  if (error) throw error;
  return rowToCaptacao(data);
}

export async function updateCaptacao(id, payload = {}, auth = null) {
  await getCaptacao(id, auth);

  const parsed = captacaoAdminUpdateSchema.parse(payload);
  const record = partialCaptacaoToRecord(parsed);

  if (payload.responsibleUserId !== undefined) {
    assertGeneralAdmin(auth);
    record.responsible_user_id = payload.responsibleUserId || null;
  }

  if (!Object.keys(record).length) return getCaptacao(id, auth);

  const supabase = getCaptacoesClient();
  const { data, error } = await supabase
    .from("captacoes")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToCaptacao(data);
}

export async function deleteCaptacao(id, auth = null) {
  await getCaptacao(id, auth);
  const supabase = getCaptacoesClient();
  const { error } = await supabase.from("captacoes").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export async function createPropertyDraftFromCaptacao(id, auth = null) {
  const captacao = await getCaptacao(id, auth);
  if (!captacao) throw new Error("Captacao nao encontrada.");

  if (captacao.propertyId) {
    const property = await getProperty(captacao.propertyId);
    if (property) return { captacao, property, alreadyExists: true };
  }

  const property = await createProperty(captacaoToPropertyDraft(captacao), auth);
  const supabase = getCaptacoesClient();

  await supabase
    .from("properties")
    .update({ captacao_id: id })
    .eq("id", property.id);

  const { data, error } = await supabase
    .from("captacoes")
    .update({
      property_id: property.id,
      status: captacao.status === "publicada" ? "publicada" : "aprovada_publicacao"
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return { captacao: rowToCaptacao(data), property, alreadyExists: false };
}

export function rowToCaptacao(row = {}) {
  return {
    id: row.id,
    ownerName: row.owner_name || "",
    ownerPhone: row.owner_phone || "",
    ownerEmail: row.owner_email || "",
    propertyType: row.property_type || "",
    propertyTypeOther: row.property_type_other || "",
    street: row.street || "",
    number: row.number || "",
    neighborhood: row.neighborhood || "",
    city: row.city || "",
    state: row.state || "",
    intendedPrice: row.intended_price === null || row.intended_price === undefined ? null : Number(row.intended_price),
    requestsEvaluation: row.requests_evaluation === true,
    saleTimeline: row.sale_timeline || "",
    exchangeAcceptance: row.exchange_acceptance || "",
    currentSituation: row.current_situation || "",
    saleReason: row.sale_reason || "",
    notes: row.notes || "",
    details: normalizeObject(row.details_json),
    photos: normalizeArray(row.photos_json),
    status: row.status || "nova",
    propertyId: row.property_id || "",
    responsibleUserId: row.responsible_user_id || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function formatCaptacaoError(error) {
  if (isAdminPermissionError(error)) return error.message || "Acesso negado.";
  if (isBrokerSchemaError(error)) return formatBrokerSchemaError(error);

  const message = String(error?.message || error || "");
  const normalized = message.toLowerCase();

  if (normalized.includes("captacoes") && (normalized.includes("does not exist") || normalized.includes("schema cache") || normalized.includes("relation"))) {
    return "A tabela public.captacoes ainda nao existe no Supabase. Execute a migration supabase/migrations/20260807_captacoes.sql no SQL Editor.";
  }

  if (normalized.includes("invalid api key") || normalized.includes("jwt")) {
    return "Confira a chave SUPABASE_SERVICE_ROLE_KEY na Vercel e faca um novo redeploy.";
  }

  return message || "Nao foi possivel processar a captacao.";
}

function getCaptacoesClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo nao configurado.");
  return supabase;
}

function captacaoToRecord(data) {
  const record = {
    owner_name: data.ownerName,
    owner_phone: data.ownerPhone,
    owner_email: data.ownerEmail || "",
    property_type: data.propertyType,
    property_type_other: data.propertyTypeOther || "",
    street: data.street || "",
    number: data.number || "",
    neighborhood: data.neighborhood || "",
    city: data.city || "Marilia",
    state: data.state || "SP",
    intended_price: data.intendedPrice,
    requests_evaluation: data.requestsEvaluation === true,
    sale_timeline: data.saleTimeline || "",
    exchange_acceptance: data.exchangeAcceptance || "",
    current_situation: data.currentSituation || "",
    sale_reason: data.saleReason || "",
    notes: data.notes || "",
    details_json: data.details || {},
    photos_json: data.photos || [],
    status: data.status || "nova"
  };

  if (data.responsibleUserId !== undefined) {
    record.responsible_user_id = data.responsibleUserId || null;
  }

  return record;
}

function partialCaptacaoToRecord(data) {
  const record = {};
  const full = captacaoToRecord(data);
  const map = {
    ownerName: "owner_name",
    ownerPhone: "owner_phone",
    ownerEmail: "owner_email",
    propertyType: "property_type",
    propertyTypeOther: "property_type_other",
    street: "street",
    number: "number",
    neighborhood: "neighborhood",
    city: "city",
    state: "state",
    intendedPrice: "intended_price",
    requestsEvaluation: "requests_evaluation",
    saleTimeline: "sale_timeline",
    exchangeAcceptance: "exchange_acceptance",
    currentSituation: "current_situation",
    saleReason: "sale_reason",
    notes: "notes",
    details: "details_json",
    photos: "photos_json",
    status: "status",
    responsibleUserId: "responsible_user_id"
  };

  Object.entries(map).forEach(([key, column]) => {
    if (data[key] !== undefined) record[column] = full[column];
  });

  return record;
}

function captacaoToPropertyDraft(captacao) {
  const typeLabel = formatCaptacaoType(captacao.propertyType, captacao.propertyTypeOther);
  const location = [captacao.neighborhood, captacao.city, captacao.state].filter(Boolean).join(", ");
  const details = captacao.details || {};
  const features = buildDraftFeatures(captacao);
  const price = captacao.requestsEvaluation ? "" : formatCaptacaoMoney(captacao.intendedPrice);

  return {
    name: `${typeLabel} em ${captacao.neighborhood || captacao.city || "Marilia"}`,
    builder: "Captacao direta",
    location,
    region: captacao.neighborhood || captacao.city || "Regiao a confirmar",
    status: "Captacao",
    type: mapCaptacaoTypeToPropertyType(captacao.propertyType),
    price,
    terms: "Dados importados de uma captacao. Revise todas as informacoes antes de publicar.",
    discounts: "",
    installmentEntry: "",
    delivery: "",
    area: cleanText(details.area || details.totalArea || details.builtArea),
    bedrooms: details.bedrooms ? `${details.bedrooms} quartos` : "",
    features,
    photos: captacao.photos || [],
    pdfName: "",
    pdfData: "",
    builderUrl: "",
    whatsapp: "",
    instagram: "",
    internalNotes: buildDraftInternalNotes(captacao),
    salesText: "Imovel cadastrado a partir de captacao direta. Edite a descricao comercial antes de publicar.",
    isPublished: false,
    isFeatured: false,
    displayOrder: 0,
    createdByUserId: captacao.responsibleUserId || ""
  };
}

function buildDraftFeatures(captacao) {
  const details = captacao.details || {};
  const features = [];
  if (details.bedrooms) features.push(`${details.bedrooms} quartos`);
  if (details.suites) features.push(`${details.suites} suites`);
  if (details.bathrooms) features.push(`${details.bathrooms} banheiros`);
  if (details.parkingSpots) features.push(`${details.parkingSpots} vagas`);
  if (details.area) features.push(`${details.area} m2`);
  if (details.totalArea) features.push(`${details.totalArea} m2 totais`);
  if (details.hasPool) features.push("Piscina");
  if (details.hasBarbecue) features.push("Churrasqueira");
  if (details.hasElevator) features.push("Elevador");
  if (details.hasLeisure) features.push("Lazer completo");
  return features.slice(0, 8);
}

function buildDraftInternalNotes(captacao) {
  const lines = [
    `Captacao: ${captacao.id}`,
    `Status da captacao: ${formatCaptacaoStatus(captacao.status)}`,
    `Proprietario: ${captacao.ownerName}`,
    `WhatsApp do proprietario: ${captacao.ownerPhone}`,
    captacao.ownerEmail ? `E-mail do proprietario: ${captacao.ownerEmail}` : "",
    `Endereco: ${[captacao.street, captacao.number, captacao.neighborhood, captacao.city, captacao.state].filter(Boolean).join(", ")}`,
    captacao.requestsEvaluation ? "Valor: proprietario solicitou avaliacao." : `Valor pretendido: ${formatCaptacaoMoney(captacao.intendedPrice)}`,
    captacao.notes ? `Observacoes: ${captacao.notes}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function mapCaptacaoTypeToPropertyType(type) {
  const map = {
    casa: "casa",
    apartamento: "apartamento",
    terreno: "terreno",
    chacara: "chacara"
  };
  return map[type] || "apartamento";
}

async function resolveCaptacaoResponsibleUserId(payload = {}) {
  if (payload.responsibleUserId !== undefined) return payload.responsibleUserId || null;

  const ref = payload.brokerRef || payload.ref || payload.responsibleRef || "";
  if (!ref) return null;

  const profile = await resolveAdminProfileByRef(ref, "captacao");
  return canUseProfileDatabaseScope(profile) ? profile.id : null;
}

function normalizeObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
