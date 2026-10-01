import "server-only";
import { getSupabaseAdminClient } from "../supabase";
import { isOwnerAdminEmail } from "../admin-profiles";

// Auth sintética do dono para os jobs de métricas (nunca vem de uma pessoa
// logada). O CRM exige o dono para a visão de equipe da Meta Diária
// (assertOwnerAdmin); o job usa o mesmo critério (e-mail de dono).
let cache = { at: 0, auth: null };

export async function getOwnerAuth() {
  if (cache.auth && Date.now() - cache.at < 5 * 60 * 1000) return cache.auth;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");
  const { data, error } = await supabase.from("admin_users").select("id, email, role").limit(200);
  if (error) throw error;
  const owner = (data || []).find((row) => isOwnerAdminEmail(row.email));
  if (!owner) throw new Error("Dono não encontrado.");
  const auth = { ok: true, user: { email: owner.email }, profile: { id: owner.id, role: owner.role || "admin", email: owner.email } };
  cache = { at: Date.now(), auth };
  return auth;
}
