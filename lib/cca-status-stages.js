import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";

// Lista configurável de sub-status do acompanhamento pós-envio à CCA
// (cca_status_stages) — o dono cresce essa lista sozinho, sem código novo.
// Mesma forma de lib/cca.js: tabela própria, `onlyActive` pula a checagem de
// papel (usado pelo seletor de sub-status no card do cliente, aberto a
// qualquer perfil autenticado que já opera o Chat/Documentação), mudança de
// verdade exige admin/gestor.
//
// `key` é gerado uma vez, a partir do `label`, e NUNCA muda depois — é o que
// lib/cca-status-presentation.mjs usa pra reconhecer o status especial
// "awaiting_cca_return" (o único com rótulo "Aguardando retorno de {CCA}" em
// vez de "{label} — {CCA}").

export function canManageCcaStatusStages() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function listCcaStatusStages(auth, { onlyActive = false } = {}) {
  if (!onlyActive) assertGeneralAdminOrManager(auth);
  let query = db().from("cca_status_stages").select("*").order("sort_order", { ascending: true }).order("label", { ascending: true });
  if (onlyActive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToCcaStatusStage);
}

// Sem checagem de auth — uso interno (lib/client-cca-status.js já validou
// permissão antes de chegar aqui).
export async function getCcaStatusStage(id) {
  if (!id) return null;
  const { data, error } = await db().from("cca_status_stages").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToCcaStatusStage(data) : null;
}

// Usado por openInitialCcaStatusOnSend pra achar o status semeado
// "Aguardando retorno da CCA" sem depender do id (que varia por ambiente).
export async function getCcaStatusStageByKey(key) {
  if (!key) return null;
  const { data, error } = await db().from("cca_status_stages").select("*").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? rowToCcaStatusStage(data) : null;
}

export async function createCcaStatusStage(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const label = String(payload?.label || "").trim();
  if (!label) throw new Error("Informe o nome do status.");

  const key = await buildUniqueKey(label);
  const { data, error } = await db().from("cca_status_stages").insert({
    key,
    label,
    sort_order: Number.isFinite(Number(payload?.sortOrder)) ? Number(payload.sortOrder) : 100,
    active: true,
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToCcaStatusStage(data);
}

export async function updateCcaStatusStage(id, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const updates = {};
  if (payload.label !== undefined) {
    const label = String(payload.label || "").trim();
    if (!label) throw new Error("Informe o nome do status.");
    updates.label = label;
  }
  if (payload.sortOrder !== undefined) updates.sort_order = Number(payload.sortOrder) || 100;
  if (payload.active !== undefined) updates.active = Boolean(payload.active);
  updates.updated_at = new Date().toISOString();

  const { data, error } = await db().from("cca_status_stages").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToCcaStatusStage(data);
}

export async function deleteCcaStatusStage(id, auth) {
  assertGeneralAdminOrManager(auth);
  // Nunca apaga um status já usado no histórico de algum cliente — só desativa.
  const { count, error: countError } = await db().from("client_cca_status_history").select("id", { count: "exact", head: true }).eq("status_id", id);
  if (countError) throw countError;
  if (count) {
    await updateCcaStatusStage(id, { active: false }, auth);
    return { deactivated: true };
  }
  const { error } = await db().from("cca_status_stages").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

async function buildUniqueKey(label) {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "status";

  let key = base;
  let attempt = 1;
  for (;;) {
    const { data, error } = await db().from("cca_status_stages").select("id").eq("key", key).maybeSingle();
    if (error) throw error;
    if (!data) return key;
    attempt += 1;
    key = `${base}_${attempt}`;
  }
}

function rowToCcaStatusStage(row) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
