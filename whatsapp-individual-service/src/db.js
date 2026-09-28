import { getSupabase } from "./supabase.js";

// Toda leitura/escrita de whatsapp_individual_sessions passa por aqui — a
// coluna session_creds_encrypted só é lida/escrita pelas duas funções de
// credenciais (nunca pelas de status), pra não vazar credencial por engano
// num log de status.

export async function readEncryptedCreds(userId) {
  const { data, error } = await getSupabase()
    .from("whatsapp_individual_sessions")
    .select("session_creds_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.session_creds_encrypted || null;
}

export async function writeEncryptedCreds(userId, encrypted) {
  const { error } = await getSupabase()
    .from("whatsapp_individual_sessions")
    .upsert({ user_id: userId, session_creds_encrypted: encrypted, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function clearSessionCreds(userId) {
  const { error } = await getSupabase()
    .from("whatsapp_individual_sessions")
    .upsert({ user_id: userId, session_creds_encrypted: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function updateSessionStatus(userId, patch = {}) {
  const { error } = await getSupabase()
    .from("whatsapp_individual_sessions")
    .upsert({ user_id: userId, updated_at: new Date().toISOString(), ...patch }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function readSessionRow(userId) {
  const { data, error } = await getSupabase()
    .from("whatsapp_individual_sessions")
    .select("user_id, status, phone_number, last_connected_at, last_error, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
