import { createClient } from "@supabase/supabase-js";

let client = null;

// service_role: mesmo padrão do Next.js (lib/supabase.js) — acesso total à
// tabela whatsapp_individual_sessions, que nega tudo a anon/authenticated.
export function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
