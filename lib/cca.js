import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { toBrazilianE164 } from "./phone-utils";

// CCA = correspondente bancária. Tabela própria, NUNCA um role em
// admin_users — mantém CCA fora de ranking/meta diária/roleta/funil/equipe
// comercial sem precisar excluir esse role manualmente de ~10 lugares
// diferentes que hoje fazem `role in ('admin','manager','broker','associate')`
// (roleta de leads, Gerador de Links etc.).

export function canManageCca() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function listCca(auth, { onlyActive = false } = {}) {
  assertGeneralAdminOrManager(auth);
  let query = db().from("cca").select("*").order("name", { ascending: true });
  if (onlyActive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToCca);
}

// Sem checagem de auth — uso interno de outras camadas (ex.:
// lib/client-documents.js já validou permissão de gestor/admin antes de
// chegar aqui, ao montar o envio pra CCA).
export async function getCca(id) {
  if (!id) return null;
  const { data, error } = await db().from("cca").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToCca(data) : null;
}

export async function createCca(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const name = String(payload?.name || "").trim();
  const whatsapp = toBrazilianE164(payload?.whatsapp);
  if (!name) throw new Error("Informe o nome da correspondente.");
  if (!whatsapp) throw new Error("Informe um WhatsApp válido.");

  const { data, error } = await db().from("cca").insert({
    name,
    company_name: cleanOptional(payload?.companyName, 160),
    whatsapp,
    email: cleanOptional(payload?.email, 160),
    notes: cleanOptional(payload?.notes, 1000),
    active: true,
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToCca(data);
}

export async function updateCca(id, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const updates = {};
  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Informe o nome da correspondente.");
    updates.name = name;
  }
  if (payload.whatsapp !== undefined) {
    const whatsapp = toBrazilianE164(payload.whatsapp);
    if (!whatsapp) throw new Error("Informe um WhatsApp válido.");
    updates.whatsapp = whatsapp;
  }
  if (payload.companyName !== undefined) updates.company_name = cleanOptional(payload.companyName, 160);
  if (payload.email !== undefined) updates.email = cleanOptional(payload.email, 160);
  if (payload.notes !== undefined) updates.notes = cleanOptional(payload.notes, 1000);
  if (payload.active !== undefined) updates.active = Boolean(payload.active);
  updates.updated_at = new Date().toISOString();

  const { data, error } = await db().from("cca").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToCca(data);
}

export async function deleteCca(id, auth) {
  assertGeneralAdminOrManager(auth);
  // Nunca apaga se já tiver envios registrados (perderia o histórico de
  // client_document_submissions) — nesse caso só desativa.
  const { count, error: countError } = await db().from("client_document_submissions").select("id", { count: "exact", head: true }).eq("cca_id", id);
  if (countError) throw countError;
  if (count) {
    await updateCca(id, { active: false }, auth);
    return { deactivated: true };
  }
  const { error } = await db().from("cca").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

function cleanOptional(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function rowToCca(row) {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name || "",
    whatsapp: row.whatsapp,
    email: row.email || "",
    notes: row.notes || "",
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
