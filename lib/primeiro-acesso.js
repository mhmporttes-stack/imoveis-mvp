import "server-only";
import { isOwnerAdminEmail } from "./admin-auth";
import { getSupabaseAdminClient } from "./supabase";
import { classifyFirstAccessInsert, isFirstAccessEligible, saoPauloDateKey } from "./primeiro-acesso-core.mjs";

// Primeiro acesso do dia do DONO (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-4). A marca do dia é uma
// linha em admin_first_access_days (chave única usuário + data de São Paulo): o INSERT que vence é o primeiro acesso;
// outra aba/aparelho no mesmo dia recebe "já registrado". Quem chama decide abrir o Início e disparar a fala da Alexa.

const TABLE = "admin_first_access_days";

export function firstAccessUserKey(auth) {
  return String(auth?.profile?.id || auth?.user?.id || "");
}

export async function registerFirstAccess(auth, now = new Date()) {
  const day = saoPauloDateKey(now);
  const eligible = isFirstAccessEligible({ ok: auth?.ok, accountSwitchMode: auth?.accountSwitchMode, isOwner: isOwnerAdminEmail(auth?.user?.email) });
  const userKey = firstAccessUserKey(auth);
  if (!eligible || !userKey) return { eligible: false, firstOfDay: false, day };

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const { error } = await supabase.from(TABLE).insert({ user_id: userKey, access_date: day, accessed_at: now.toISOString() });
  const outcome = classifyFirstAccessInsert(error);
  if (outcome === "unavailable") {
    // Ex.: migration ainda não aplicada (42P01/PGRST205). O CRM abre normalmente; o Início/bom dia ficam desligados.
    console.warn(`[primeiro-acesso] não foi possível registrar o acesso do dia (${error?.code || "erro"}).`);
    return { eligible: true, firstOfDay: false, day, unavailable: true };
  }
  return { eligible: true, firstOfDay: outcome === "claimed", day };
}

// Resultado da fala do bom dia na marca do dia (só o motivo — nunca a frase).
export async function recordFirstAccessAlexa(userKey, day, status) {
  try {
    await getSupabaseAdminClient()
      .from(TABLE)
      .update({ alexa_status: String(status || "").slice(0, 60), alexa_at: new Date().toISOString() })
      .eq("user_id", userKey)
      .eq("access_date", day);
  } catch (error) {
    console.warn(`[primeiro-acesso] não foi possível guardar o status da Alexa: ${error?.name || "erro"}.`);
  }
}

// Último primeiro acesso registrado (tela /admin/alexa).
export async function getLastFirstAccess() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { ready: false };
  const { data, error } = await supabase
    .from(TABLE)
    .select("access_date, accessed_at, alexa_status, alexa_at")
    .order("accessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ready: false };
  return {
    ready: true,
    lastDate: data?.access_date || null,
    lastAccessAt: data?.accessed_at || null,
    alexaStatus: data?.alexa_status || "",
    alexaAt: data?.alexa_at || null
  };
}
