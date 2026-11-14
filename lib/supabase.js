import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout.mjs";
import { normalizeSupabaseUrl } from "@/lib/supabase-url";

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const hasSupabasePublicConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const hasSupabaseAdminConfig = Boolean(supabaseUrl && supabaseServiceRoleKey);

let publicClient = null;
let adminClient = null;

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: { fetch: (input, init) => fetchWithTimeout(input, init) }
};

export function getSupabasePublicClient() {
  if (!hasSupabasePublicConfig) return null;
  if (!publicClient) {
    publicClient = createClient(supabaseUrl, supabaseAnonKey, clientOptions);
  }
  return publicClient;
}

// Cliente NOVO a cada chamada, só para fluxos de credencial/sessão de usuário (renovar sessão, validar token).
// Nunca use getSupabasePublicClient() para isso: ele é um só por processo e o auth-js reaproveita uma renovação
// já em andamento mesmo com outro refresh token (P-23: um login recebia a sessão de outro). Sem storage
// (persistSession=false = memória da própria instância) e sem timer: nada é compartilhado entre chamadas.
export function createIsolatedSupabaseAuthClient() {
  if (!hasSupabasePublicConfig) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchWithTimeout(input, init) }
  });
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig) return null;
  if (!adminClient) {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);
  }
  return adminClient;
}
