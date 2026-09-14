import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { normalizeSupabaseUrl } from "@/lib/supabase-url";

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const hasSupabasePublicConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const hasSupabaseAdminConfig = Boolean(supabaseUrl && supabaseServiceRoleKey);

// DIAGNOSTICO TEMPORARIO (investigacao de falha de login em producao) —
// nenhum valor secreto e exposto, apenas presenca/host/tamanho/fingerprint.
// Remover apos identificar a causa.
function fingerprint(value) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : null;
}
export const supabaseDiag = {
  hasUrl: Boolean(supabaseUrl),
  hasAnonKey: Boolean(supabaseAnonKey),
  hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
  urlHost: (() => {
    try { return supabaseUrl ? new URL(supabaseUrl).host : null; } catch { return "invalid-url"; }
  })(),
  anonKeyLen: supabaseAnonKey.length,
  anonKeyFingerprint: fingerprint(supabaseAnonKey),
  serviceRoleKeyLen: supabaseServiceRoleKey.length,
  serviceRoleFingerprint: fingerprint(supabaseServiceRoleKey),
  nodeEnv: process.env.NODE_ENV || null,
  vercelEnv: process.env.VERCEL_ENV || null
};

let publicClient = null;
let adminClient = null;

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

export function getSupabasePublicClient() {
  if (!hasSupabasePublicConfig) return null;
  if (!publicClient) {
    publicClient = createClient(supabaseUrl, supabaseAnonKey, clientOptions);
  }
  return publicClient;
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig) return null;
  if (!adminClient) {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);
  }
  return adminClient;
}
