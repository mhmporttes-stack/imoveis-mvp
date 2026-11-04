import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getAdminProfileById } from "./admin-profiles";
import { generateSmsShortcutKey, hashSmsShortcutKey, smsShortcutKeyMatches } from "./sms-shortcut-core.mjs";

// Atalho do iPhone do Lote de SMS (dono, 2026-11-04). A chave é do usuário REAL logado; só o hash fica guardado e a chave
// volta UMA vez. Quem usa o Lote (admin geral, gestor, corretor) pode gerar; a rota do Atalho revalida o perfil a cada chamada.
const TABLE = "sms_shortcut_keys";
const MIGRATION_MISSING = "O Atalho do iPhone ainda não está ativo no banco (migration 20261104120000 pendente).";

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

const isMissingTable = (error) => ["42P01", "PGRST205"].includes(error?.code) || /sms_shortcut_keys/.test(String(error?.message || ""));

// Gera (ou troca) a chave pessoal. A anterior deixa de valer.
export async function generateSmsShortcutKeyFor(userId) {
  if (!userId) throw Object.assign(new Error("Usuário inválido."), { status: 400 });
  const key = generateSmsShortcutKey();
  const { error } = await db().from(TABLE).upsert({ user_id: userId, token_hash: hashSmsShortcutKey(key), created_at: new Date().toISOString(), last_used_at: null }, { onConflict: "user_id" });
  if (error) {
    if (isMissingTable(error)) throw Object.assign(new Error(MIGRATION_MISSING), { status: 503 });
    throw error;
  }
  return key;
}

export async function hasSmsShortcutKey(userId) {
  const { data, error } = await db().from(TABLE).select("created_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ready: false, configured: false };
    throw error;
  }
  return { ready: true, configured: Boolean(data), createdAt: data?.created_at || null };
}

// Chave -> { auth } no mesmo formato dos guards (profile ativo com escopo de equipe). Chave errada, usuário inativo ou associado: null.
export async function authFromSmsShortcutKey(key) {
  if (!key) return null;
  const hash = hashSmsShortcutKey(key);
  const { data: record, error } = await db().from(TABLE).select("user_id, token_hash").eq("token_hash", hash).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!record || !smsShortcutKeyMatches(record.token_hash, key)) return null;
  const profile = await getAdminProfileById(record.user_id);
  if (!profile || profile.status !== "active" || profile.role === "associate") return null;
  db().from(TABLE).update({ last_used_at: new Date().toISOString() }).eq("user_id", record.user_id).then(() => {}, () => {});
  return { ok: true, user: { id: profile.authUserId || profile.id, email: profile.email || "" }, profile };
}
