import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
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

