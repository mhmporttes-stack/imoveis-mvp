import "server-only";
import { cache } from "react";
import { getSupabaseAdminClient } from "./supabase";
import { getOpenRestriction } from "./whatsapp-restriction";
import { isGeneralAdminAuth } from "./admin-profiles";
import { isPrintedListMode, printedListModeAppliesTo } from "./whatsapp-manual-disconnect-core.mjs";

// Leitura do banco para o MODO LISTA IMPRESSA (PRO-15, dono 2026-10-15). Regras puras em
// lib/whatsapp-manual-disconnect-core.mjs. Só LEITURA: nada aqui desconecta, apaga conversa ou mexe em fila.

export const PRINTED_LIST_SESSION_COLUMNS = "user_id, slot, status, last_error, last_connected_at, last_disconnect_code, last_disconnect_at";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Memoizado por requisição (layout + menu + página pedem o mesmo dado na mesma navegação).
const loadPrintedListMode = cache(async (userId, role, isGeneralAdmin) => {
  if (!userId || !printedListModeAppliesTo({ role, isGeneralAdmin })) return false;
  const [{ data: rows, error }, openRestriction] = await Promise.all([
    db().from("whatsapp_individual_sessions").select(PRINTED_LIST_SESSION_COLUMNS).eq("user_id", userId),
    getOpenRestriction(userId)
  ]);
  if (error) throw error;
  return isPrintedListMode({ role, isGeneralAdmin, rows: rows || [], openRestriction });
});

// Perfil EFETIVO (vale também em "Alterar conta", como PRO-11). -> boolean
export async function isPrintedListModeAuth(auth) {
  const profile = auth?.profile;
  return loadPrintedListMode(profile?.id || "", profile?.role || "", isGeneralAdminAuth(auth));
}

// Só para ESCONDER o Chat no menu (layout/AdminSectionNav). A barreira de verdade é o guard do servidor
// (lib/admin-auth.js); se a leitura falhar, o menu fica como estava e o erro vai para o log.
export async function readChatHiddenForNav(auth) {
  try {
    return await isPrintedListModeAuth(auth);
  } catch (error) {
    console.error("Falha ao ler o modo lista impressa para o menu:", error?.message || error);
    return false;
  }
}
