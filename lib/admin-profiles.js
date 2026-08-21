import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { getAdminDisplayName } from "@/lib/admin-users";

export const ADMIN_ROLE = {
  ADMIN: "admin",
  BROKER: "broker"
};

export const ADMIN_USER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive"
};

const FALLBACK_PRIMARY_ADMIN_EMAIL = "mhmporttes@gmail.com";
const OWNER_ADMIN_EMAILS = new Set(["mhmporttes@gmail.com", "mhmporttes@icloud.com"]);
const FALLBACK_BROKER_EMAILS = new Set(["forbencke@gmail.com"]);
const BROKER_SCHEMA_MIGRATION = "supabase/migrations/20260821_broker_users_access.sql";

export class AdminPermissionError extends Error {
  constructor(message = "Acesso negado.") {
    super(message);
    this.name = "AdminPermissionError";
    this.status = 403;
  }
}

export function normalizeAdminEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function normalizeBrokerRef(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

export function isGeneralAdminProfile(profile) {
  return profile?.role === ADMIN_ROLE.ADMIN || OWNER_ADMIN_EMAILS.has(normalizeAdminEmail(profile?.email));
}

export function isBrokerProfile(profile) {
  return profile?.role === ADMIN_ROLE.BROKER && !isGeneralAdminProfile(profile);
}

export function isActiveAdminProfile(profile) {
  return profile?.status === ADMIN_USER_STATUS.ACTIVE || isGeneralAdminProfile(profile);
}

export function canUseProfileDatabaseScope(profile) {
  return Boolean(profile?.id && !profile.isFallback);
}

export function isBrokerSchemaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("admin_users") ||
    message.includes("responsible_user_id") ||
    message.includes("created_by_user_id") ||
    message.includes("schema cache")
  );
}

export function formatBrokerSchemaError(error) {
  if (isBrokerSchemaError(error)) {
    return `A estrutura de corretores ainda não existe no Supabase. Execute a migration ${BROKER_SCHEMA_MIGRATION} no SQL Editor do Supabase.`;
  }

  return error?.message || "Não foi possível carregar os corretores.";
}

export async function getAdminProfileForAuthUser(user) {
  const email = normalizeAdminEmail(user?.email);
  if (!email) return null;

  const profile = await findAdminProfileByAuthOrEmail(user?.id || "", email);
  if (profile) {
    if (user?.id && !profile.authUserId) {
      await attachAuthUserId(profile.id, user.id);
      return { ...profile, authUserId: user.id };
    }

    return profile;
  }

  return getFallbackAdminProfile(email, user?.id || "");
}

export async function resolveAdminProfileByRef(ref, type = "simulation") {
  const cleanRef = normalizeBrokerRef(ref);
  if (!cleanRef) return null;

  if (!hasSupabaseAdminConfig) return resolveFallbackProfileByRef(cleanRef);

  const supabase = getSupabaseAdminClient();
  const column = type === "captacao" ? "captacao_ref" : "simulation_ref";
  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .eq(column, cleanRef)
    .eq("status", ADMIN_USER_STATUS.ACTIVE)
    .maybeSingle();

  if (error) {
    if (isBrokerSchemaError(error)) return resolveFallbackProfileByRef(cleanRef);
    throw error;
  }

  return data ? rowToAdminProfile(data) : resolveFallbackProfileByRef(cleanRef);
}

export async function listAdminProfiles() {
  if (!hasSupabaseAdminConfig) return [];

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToAdminProfile);
}

export async function getAdminProfileById(id) {
  if (!id || !hasSupabaseAdminConfig) return null;

  const { data, error } = await getSupabaseAdminClient()
    .from("admin_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToAdminProfile(data) : null;
}

export async function createAdminProfile(payload = {}) {
  if (!hasSupabaseAdminConfig) {
    throw new Error("Supabase administrativo não configurado.");
  }

  const supabase = getSupabaseAdminClient();
  const cleanEmail = normalizeAdminEmail(payload.email);
  const password = String(payload.password || "").trim();
  const name = String(payload.name || "").trim().replace(/\s+/g, " ");

  if (!name) throw new Error("Informe o nome do usuário.");
  if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Informe um e-mail válido.");
  if (!payload.id && password.length < 6) throw new Error("Informe uma senha inicial com pelo menos 6 caracteres.");

  const existing = await findAdminProfileByAuthOrEmail("", cleanEmail);
  if (existing) throw new Error("Já existe um usuário cadastrado com este e-mail.");

  const authUser = await createOrFindAuthUser({ email: cleanEmail, password, name });
  const record = adminProfileToRecord({
    name,
    email: cleanEmail,
    phone: payload.phone || "",
    role: payload.role === ADMIN_ROLE.ADMIN ? ADMIN_ROLE.ADMIN : ADMIN_ROLE.BROKER,
    status: payload.status === ADMIN_USER_STATUS.INACTIVE ? ADMIN_USER_STATUS.INACTIVE : ADMIN_USER_STATUS.ACTIVE,
    authUserId: authUser?.id || null,
    simulationRef: normalizeBrokerRef(payload.simulationRef) || buildUniqueRef(name || cleanEmail, "sim"),
    captacaoRef: normalizeBrokerRef(payload.captacaoRef) || buildUniqueRef(name || cleanEmail, "cap")
  });

  const { data, error } = await supabase
    .from("admin_users")
    .insert(record)
    .select("*")
    .single();

  if (error) throw error;
  return rowToAdminProfile(data);
}

export async function updateAdminProfile(id, payload = {}) {
  if (!id || !hasSupabaseAdminConfig) throw new Error("Usuário inválido.");

  const updates = {};
  if ("name" in payload) updates.name = String(payload.name || "").trim().replace(/\s+/g, " ");
  if ("phone" in payload) updates.phone = String(payload.phone || "").trim();
  if ("status" in payload) {
    updates.status = payload.status === ADMIN_USER_STATUS.INACTIVE ? ADMIN_USER_STATUS.INACTIVE : ADMIN_USER_STATUS.ACTIVE;
    updates.disabled_at = updates.status === ADMIN_USER_STATUS.INACTIVE ? new Date().toISOString() : null;
  }
  if ("role" in payload) updates.role = payload.role === ADMIN_ROLE.ADMIN ? ADMIN_ROLE.ADMIN : ADMIN_ROLE.BROKER;
  if ("simulationRef" in payload) updates.simulation_ref = normalizeBrokerRef(payload.simulationRef);
  if ("captacaoRef" in payload) updates.captacao_ref = normalizeBrokerRef(payload.captacaoRef);

  if (!Object.keys(updates).length) return getAdminProfileById(id);

  const { data, error } = await getSupabaseAdminClient()
    .from("admin_users")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToAdminProfile(data);
}

export function getSiteBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "https://www.matheusmachadoimoveis.com.br";
  return raw.startsWith("http") ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

export function buildBrokerSimulationLink(profile) {
  const ref = normalizeBrokerRef(profile?.simulationRef);
  return ref ? `${getSiteBaseUrl()}/simulacao?ref=${encodeURIComponent(ref)}` : `${getSiteBaseUrl()}/simulacao`;
}

export function buildBrokerCaptacaoLink(profile) {
  const ref = normalizeBrokerRef(profile?.captacaoRef);
  return ref ? `${getSiteBaseUrl()}/captacao?ref=${encodeURIComponent(ref)}` : `${getSiteBaseUrl()}/captacao`;
}

function rowToAdminProfile(row = {}) {
  const email = normalizeAdminEmail(row.email);
  const isOwner = OWNER_ADMIN_EMAILS.has(email);

  return {
    id: row.id || "",
    authUserId: row.auth_user_id || "",
    name: row.name || getAdminDisplayName(row.email),
    email,
    phone: row.phone || "",
    role: row.role === ADMIN_ROLE.ADMIN || isOwner ? ADMIN_ROLE.ADMIN : ADMIN_ROLE.BROKER,
    status: row.status === ADMIN_USER_STATUS.INACTIVE && !isOwner ? ADMIN_USER_STATUS.INACTIVE : ADMIN_USER_STATUS.ACTIVE,
    simulationRef: row.simulation_ref || "",
    captacaoRef: row.captacao_ref || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    disabledAt: row.disabled_at || "",
    isFallback: false
  };
}

function adminProfileToRecord(profile) {
  return {
    auth_user_id: profile.authUserId || null,
    name: profile.name,
    email: normalizeAdminEmail(profile.email),
    phone: profile.phone || "",
    role: profile.role,
    status: profile.status,
    simulation_ref: normalizeBrokerRef(profile.simulationRef) || buildUniqueRef(profile.email, "sim"),
    captacao_ref: normalizeBrokerRef(profile.captacaoRef) || buildUniqueRef(profile.email, "cap")
  };
}

async function findAdminProfileByAuthOrEmail(authUserId, email) {
  if (!hasSupabaseAdminConfig) return null;

  const supabase = getSupabaseAdminClient();
  if (authUserId) {
    const { data, error } = await supabase
      .from("admin_users")
      .select("*")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error && !isBrokerSchemaError(error)) throw error;
    if (data) return rowToAdminProfile(data);
    if (error && isBrokerSchemaError(error)) return null;
  }

  if (!email) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    if (isBrokerSchemaError(error)) return null;
    throw error;
  }

  return data ? rowToAdminProfile(data) : null;
}

async function attachAuthUserId(profileId, authUserId) {
  if (!profileId || !authUserId || !hasSupabaseAdminConfig) return;

  try {
    await getSupabaseAdminClient()
      .from("admin_users")
      .update({ auth_user_id: authUserId })
      .eq("id", profileId);
  } catch {
    // O vínculo será tentado novamente no próximo login.
  }
}

async function createOrFindAuthUser({ email, password, name }) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });

  if (!error) return data?.user || null;

  const message = String(error.message || "").toLowerCase();
  if (!message.includes("already") && !message.includes("registered") && !message.includes("exists")) {
    throw error;
  }

  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw users.error;
  return users.data?.users?.find((user) => normalizeAdminEmail(user.email) === email) || null;
}

function getFallbackAdminProfile(email, authUserId = "") {
  if (email === FALLBACK_PRIMARY_ADMIN_EMAIL) {
    return fallbackProfile({
      id: "fallback-admin-matheus",
      authUserId,
      name: "Matheus",
      email,
      role: ADMIN_ROLE.ADMIN,
      simulationRef: "matheus",
      captacaoRef: "matheus-captacao"
    });
  }

  if (FALLBACK_BROKER_EMAILS.has(email)) {
    return fallbackProfile({
      id: "fallback-broker-benck",
      authUserId,
      name: "Benck",
      email,
      role: ADMIN_ROLE.BROKER,
      simulationRef: "benck",
      captacaoRef: "benck-captacao"
    });
  }

  return null;
}

function resolveFallbackProfileByRef(ref) {
  if (["matheus", "matheus-captacao"].includes(ref)) return getFallbackAdminProfile(FALLBACK_PRIMARY_ADMIN_EMAIL);
  if (["benck", "benck-captacao"].includes(ref)) return getFallbackAdminProfile("forbencke@gmail.com");
  return null;
}

function fallbackProfile(profile) {
  return {
    ...profile,
    phone: "",
    status: ADMIN_USER_STATUS.ACTIVE,
    createdAt: "",
    updatedAt: "",
    disabledAt: "",
    isFallback: true
  };
}

function buildUniqueRef(seed, prefix) {
  const base = normalizeBrokerRef(String(seed || "").split("@")[0]).slice(0, 18) || prefix;
  return `${base}-${randomUUID().slice(0, 8)}`;
}
