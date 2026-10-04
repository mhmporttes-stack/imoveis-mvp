import "server-only";
import { assertCanAccessResponsibleUser, assertGeneralAdminOrManager } from "./admin-access";
import { getActingAdminEmail } from "./admin-auth";
import { isGeneralAdminAuth, isManagerProfile, listVisibleTeamProfiles } from "./admin-profiles";
import { getSupabaseAdminClient } from "./supabase";
import {
  MANUAL_LIST_NOT_ENABLED_MESSAGE,
  MANUAL_LIST_RESERVED_MESSAGE,
  MANUAL_LIST_SIZE,
  formatListPhone,
  isMissingManualListSchemaError,
  isUuid,
  manualListBrokerScope,
  manualListFileName,
  manualListRpcErrorInfo,
  normalizeRequestKey,
  reservedContactIdsAmong
} from "./prospecting-manual-list-core.mjs";
import { gerarListaProspeccaoPdf } from "./prospecting-manual-list-pdf.mjs";

// "Imprimir lista" da Prospecção (2026-10-04). Esta camada só LÊ/ESCREVE nas tabelas novas
// (prospecting_manual_lists, _items) e chama o RPC create_prospecting_manual_list. NUNCA toca em
// prospecting_contacts, simulation_registrations, funil, status, pontuação nem em qualquer envio.
// Sem a migration 20261004170000 o resto da Prospecção continua funcionando (erro de tabela inexistente =
// "nenhuma reserva").

const PAGE_SIZE = 30;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

export class ManualListError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ManualListError";
    this.status = status;
  }
}

function raise(error) {
  if (isMissingManualListSchemaError(error)) throw new ManualListError(MANUAL_LIST_NOT_ENABLED_MESSAGE, 503);
  throw error;
}

// Ids de contato reservados em QUALQUER lista manual — exclusão central dos seletores em JavaScript.
// Tabela ainda inexistente = ninguém reservado (o código existente não pode quebrar).
export async function listManualReservedContactIds() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("prospecting_manual_list_items").select("contact_id").not("contact_id", "is", null).range(from, from + 999);
    if (error) {
      if (isMissingManualListSchemaError(error)) return new Set();
      throw error;
    }
    for (const row of data || []) ids.add(row.contact_id);
    if (!data || data.length < 1000) break;
  }
  return ids;
}

// Atribuição em massa/individual: nenhum contato reservado pode ir para outro corretor.
export async function assertContactsNotReserved(contactIds) {
  const ids = (Array.isArray(contactIds) ? contactIds : []).filter(Boolean);
  if (!ids.length) return;
  const reserved = reservedContactIdsAmong(ids, await listManualReservedContactIds());
  if (reserved.length) {
    throw new ManualListError(`${MANUAL_LIST_RESERVED_MESSAGE} (${reserved.length} na seleção). Tire-os da seleção e tente de novo.`, 409);
  }
}

function scopeOf(auth) {
  return manualListBrokerScope({
    isGeneralAdmin: isGeneralAdminAuth(auth),
    isManager: isManagerProfile(auth?.profile),
    managedUserIds: auth?.profile?.managedUserIds,
    profileId: auth?.profile?.id
  });
}

function mapList(row, names) {
  return {
    id: row.id,
    numero: Number(row.numero),
    brokerId: row.broker_id || "",
    brokerName: row.broker_name_snapshot || "",
    contactCount: row.contact_count,
    createdAt: row.created_at,
    generatedByName: names.get(row.generated_by_user_id) || row.generated_by_email || ""
  };
}

async function loadAdminNames(ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  const names = new Map();
  if (!unique.length) return names;
  const { data, error } = await db().from("admin_users").select("id, name").in("id", unique);
  if (error) throw error;
  for (const row of data || []) names.set(row.id, row.name);
  return names;
}

// Tela: corretores/associados selecionáveis (escopo da equipe) + histórico paginado.
export async function getManualListsOverview(auth, { brokerId = "", offset = 0 } = {}) {
  assertGeneralAdminOrManager(auth);
  const scope = scopeOf(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  const brokers = profiles
    .map((profile) => ({ id: profile.id, name: profile.name, role: profile.role }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));

  const filterId = isUuid(brokerId) ? brokerId : "";
  if (filterId && !scope.all && !scope.ids.includes(filterId)) return { enabled: true, brokers, lists: [], hasMore: false };

  let query = db()
    .from("prospecting_manual_lists")
    .select("id, numero, broker_id, broker_name_snapshot, contact_count, created_at, generated_by_user_id, generated_by_email")
    .order("created_at", { ascending: false })
    .order("numero", { ascending: false })
    .range(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + PAGE_SIZE);
  if (!scope.all) query = query.in("broker_id", scope.ids.length ? scope.ids : [EMPTY_UUID]);
  if (filterId) query = query.eq("broker_id", filterId);
  const { data, error } = await query;
  if (error) {
    if (isMissingManualListSchemaError(error)) return { enabled: false, message: MANUAL_LIST_NOT_ENABLED_MESSAGE, brokers, lists: [], hasMore: false };
    throw error;
  }
  const rows = data || [];
  const page = rows.slice(0, PAGE_SIZE);
  const names = await loadAdminNames(page.map((row) => row.generated_by_user_id));
  return { enabled: true, brokers, lists: page.map((row) => mapList(row, names)), hasMore: rows.length > PAGE_SIZE };
}

// Gera a lista (reserva atômica no banco). O mesmo requestKey devolve a MESMA lista (clique repetido).
export async function generateManualList(auth, { brokerId, requestKey } = {}) {
  assertGeneralAdminOrManager(auth);
  if (!isUuid(brokerId)) throw new ManualListError("Selecione um corretor ou associado.", 400);
  const key = normalizeRequestKey(requestKey);
  if (!key) throw new ManualListError("Solicitação inválida. Atualize a página e tente de novo.", 400);
  // Gestor só para a própria equipe (mesmo escopo da atribuição em massa); o corretor/associado nunca chega aqui.
  assertCanAccessResponsibleUser(auth, brokerId);

  // Ação ADMINISTRATIVA: registra o administrador REAL, mesmo durante "Alterar conta" (auth-permissoes.md).
  const { data, error } = await db().rpc("create_prospecting_manual_list", {
    p_broker_id: brokerId,
    p_limit: MANUAL_LIST_SIZE,
    p_generated_by_user_id: auth.realProfile?.id || auth.profile?.id || null,
    p_generated_by_email: getActingAdminEmail(auth),
    p_request_key: key,
    p_broker_name: null
  });
  if (error) {
    const info = manualListRpcErrorInfo(error);
    if (info) throw new ManualListError(info.message, info.status);
    throw error;
  }
  return { listId: data.list_id, numero: Number(data.numero), contactCount: data.contact_count, already: Boolean(data.already) };
}

async function loadAccessibleList(auth, id) {
  assertGeneralAdminOrManager(auth);
  if (!isUuid(id)) throw new ManualListError("Lista não encontrada.", 404);
  const { data, error } = await db()
    .from("prospecting_manual_lists")
    .select("id, numero, broker_id, broker_name_snapshot, contact_count, created_at, generated_by_user_id, generated_by_email")
    .eq("id", id)
    .maybeSingle();
  if (error) raise(error);
  if (!data) throw new ManualListError("Lista não encontrada.", 404);
  // Escopo: o gestor só enxerga lista de corretor/associado da própria equipe.
  assertCanAccessResponsibleUser(auth, data.broker_id);
  return data;
}

async function loadItems(listId) {
  const { data, error } = await db().from("prospecting_manual_list_items").select("position, name_snapshot, phone_snapshot").eq("list_id", listId).order("position", { ascending: true });
  if (error) raise(error);
  return data || [];
}

// Visualizar (somente leitura): sempre o snapshot gravado na geração.
export async function getManualList(auth, id) {
  const row = await loadAccessibleList(auth, id);
  const [items, names] = await Promise.all([loadItems(row.id), loadAdminNames([row.generated_by_user_id])]);
  return {
    list: mapList(row, names),
    items: items.map((item) => ({ position: item.position, name: item.name_snapshot, phone: item.phone_snapshot, phoneFormatted: formatListPhone(item.phone_snapshot) }))
  };
}

// PDF A4 da MESMA lista (snapshot). Nunca seleciona contatos novos. 
export async function buildManualListPdf(auth, id) {
  const row = await loadAccessibleList(auth, id);
  const items = await loadItems(row.id);
  const { bytes } = await gerarListaProspeccaoPdf({
    numero: Number(row.numero),
    brokerName: row.broker_name_snapshot,
    createdAt: row.created_at,
    items: items.map((item) => ({ position: item.position, name: item.name_snapshot, phone: item.phone_snapshot }))
  });
  return { bytes, fileName: manualListFileName(row.numero, row.broker_name_snapshot) };
}
