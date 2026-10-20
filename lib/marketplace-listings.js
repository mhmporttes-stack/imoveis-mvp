import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { CANONICAL_SITE_URL } from "./site-url.mjs";
import {
  MARKETPLACE_SETTINGS_ID,
  MARKETPLACE_TOKEN_PREFIX,
  MarketplaceInputError,
  canEdit,
  claimPatch,
  contentChanged,
  evaluateQueueGate,
  isEligibleForClaim,
  isStaleClaim,
  normalizeListingInput,
  planAdminAction,
  planResult,
  staleClaimPatch,
  toExtensionPayload
} from "./marketplace-core.mjs";

// Publicador do Facebook Marketplace (MKT-1). Fila em marketplace_listings (migration
// 20261020120000_marketplace_listings.sql); chave da extensão só em hash em crm_settings 'marketplace_publisher'.
// Tela e rotas /api/admin/marketplace/** só para o admin geral; /api/marketplace/queue/** só com a chave.

const TABLE = "marketplace_listings";

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function isMissingTable(error) {
  return error && (error.code === "42P01" || error.code === "PGRST205" || /marketplace_listings/.test(String(error.message || "")) && /not exist|could not find/i.test(String(error.message || "")));
}

function raise(error) {
  if (isMissingTable(error)) throw new Error("A tabela do Marketplace ainda não existe (migration 20261020120000 não aplicada).");
  throw error;
}

export function getAllowedPhotoHosts() {
  const hosts = new Set([new URL(CANONICAL_SITE_URL).hostname, "matheusmachadoimoveis.com.br"]);
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) hosts.add(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.toLowerCase());
  } catch {
    // URL inválida: só o domínio da marca é aceito.
  }
  return [...hosts];
}

export async function listMarketplaceListings() {
  const { data, error } = await db().from(TABLE).select("*").order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error)) return { ready: false, listings: [] };
    throw error;
  }
  return { ready: true, listings: data || [] };
}

async function getListing(id) {
  const { data, error } = await db().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) raise(error);
  if (!data) throw new MarketplaceInputError("Anúncio não encontrado.");
  return data;
}

export async function createMarketplaceListing(input, auth) {
  const record = normalizeListingInput(input, { allowedHosts: getAllowedPhotoHosts() });
  const { data, error } = await db()
    .from(TABLE)
    .insert({ ...record, status: "pending", created_by: auth?.profile?.id || null })
    .select("*")
    .single();
  if (error) raise(error);
  return data;
}

export async function updateMarketplaceListing(id, input) {
  const current = await getListing(id);
  if (!canEdit(current)) throw new MarketplaceInputError("Só dá para editar anúncio aguardando ou que falhou.");
  const record = normalizeListingInput(input, { allowedHosts: getAllowedPhotoHosts() });
  // Mudou o conteúdo → a aprovação anterior não vale mais (o "sim" é para o que o dono viu).
  const patch = contentChanged(current, record) ? { ...record, approved_by: null, approved_at: null } : record;
  const { data, error } = await db()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("*")
    .maybeSingle();
  if (error) raise(error);
  if (!data) throw new MarketplaceInputError("O anúncio mudou de situação. Recarregue a tela.");
  return data;
}

export async function applyMarketplaceAction(id, action, auth) {
  const current = await getListing(id);
  const patch = planAdminAction(current, action, { userId: auth?.profile?.id || null });
  const { data, error } = await db()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", current.status)
    .select("*")
    .maybeSingle();
  if (error) raise(error);
  if (!data) throw new MarketplaceInputError("O anúncio mudou de situação. Recarregue a tela.");
  return data;
}

// --- Chave da extensão --------------------------------------------------------
function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

// "Visto por último" mora em outra linha: gravar junto da chave arriscaria regravar o hash antigo se o dono gerasse
// uma chave nova no meio de uma consulta da extensão.
const SEEN_SETTINGS_ID = `${MARKETPLACE_SETTINGS_ID}_seen`;

async function readSetting(id) {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.setting_value || {};
}

async function writeSetting(id, value, userId = null) {
  const { error } = await db()
    .from("crm_settings")
    .upsert({ id, setting_value: value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

export async function getPublisherStatus() {
  const [settings, seen] = await Promise.all([readSetting(MARKETPLACE_SETTINGS_ID), readSetting(SEEN_SETTINGS_ID)]);
  return { tokenConfigured: Boolean(settings.token_hash), tokenCreatedAt: settings.token_created_at || null, lastSeenAt: seen.last_seen_at || null };
}

// Gera a chave pessoal (invalida a anterior). Só o hash fica guardado; a chave aparece UMA vez.
export async function generatePublisherToken(auth) {
  const token = `${MARKETPLACE_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  await writeSetting(MARKETPLACE_SETTINGS_ID, { token_hash: hashToken(token), token_created_at: new Date().toISOString() }, auth?.profile?.id || null);
  return token;
}

export async function verifyPublisherToken(token) {
  if (!token) return false;
  const settings = await readSetting(MARKETPLACE_SETTINGS_ID);
  const stored = String(settings.token_hash || "");
  const supplied = hashToken(token);
  const ok = stored.length === supplied.length && stored.length > 0 && timingSafeEqual(Buffer.from(stored), Buffer.from(supplied));
  if (ok) {
    // Só informativo na tela ("extensão vista por último"); falha aqui não pode barrar a fila.
    await writeSetting(SEEN_SETTINGS_ID, { last_seen_at: new Date().toISOString() }).catch((error) => console.warn("[marketplace] não gravou last_seen:", error?.message || error));
  }
  return ok;
}

// --- Fila (extensão) ----------------------------------------------------------
async function expireStaleClaims(now) {
  const { data, error } = await db().from(TABLE).select("id, status, claimed_at").eq("status", "claimed");
  if (error) raise(error);
  const stale = (data || []).filter((row) => isStaleClaim(row, now));
  for (const row of stale) {
    await db().from(TABLE).update(staleClaimPatch(now)).eq("id", row.id).eq("status", "claimed");
  }
  return (data || []).length - stale.length; // claims ainda ativos
}

export async function claimNextMarketplaceListing(now = new Date()) {
  const activeClaims = await expireStaleClaims(now);
  const dayStart = zonedPlainDateToUtcIso(getTodayInSaoPaulo());
  const [published, lastClaim] = await Promise.all([
    db().from(TABLE).select("id", { count: "exact", head: true }).eq("status", "published").gte("published_at", dayStart),
    db().from(TABLE).select("claimed_at").not("claimed_at", "is", null).order("claimed_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (published.error) raise(published.error);
  if (lastClaim.error) raise(lastClaim.error);

  const gate = evaluateQueueGate({ now, publishedToday: published.count || 0, lastClaimAt: lastClaim.data?.claimed_at || null, hasActiveClaim: activeClaims > 0 });
  if (!gate.allowed) return { listing: null, reason: gate.reason };

  const { data: candidates, error } = await db()
    .from(TABLE)
    .select("*")
    .eq("status", "pending")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: true })
    .limit(5);
  if (error) raise(error);

  for (const candidate of (candidates || []).filter(isEligibleForClaim)) {
    // Pegada atômica: só marca se continuar "pending" e aprovado (outra chamada pode ter pegado antes).
    const { data, error: claimError } = await db()
      .from(TABLE)
      .update(claimPatch(candidate, now))
      .eq("id", candidate.id)
      .eq("status", "pending")
      .eq("attempts", candidate.attempts)
      .not("approved_at", "is", null)
      .select("*")
      .maybeSingle();
    if (claimError) raise(claimError);
    if (data) return { listing: toExtensionPayload(data), reason: null };
  }
  return { listing: null, reason: "fila_vazia" };
}

export async function reportMarketplaceResult(id, body, now = new Date()) {
  const current = await getListing(id);
  const patch = planResult(current, body, now);
  const { data, error } = await db().from(TABLE).update(patch).eq("id", id).eq("status", "claimed").select("id, status").maybeSingle();
  if (error) raise(error);
  if (!data) throw new MarketplaceInputError("Este anúncio não está em publicação.");
  return data;
}
