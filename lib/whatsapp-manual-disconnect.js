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

// Memória curta entre requisições (desempenho, 2026-11-03): o guard do Chat e o card-state perguntavam isto a CADA chamada
// do Chat (≈7 mil consultas/hora só aqui). Só vale poucos segundos: "lista impressa LIGADA" (corretor desconectado) dura 5 s,
// para o Chat voltar logo depois de reconectar; "desligada" dura 15 s. Erro nunca é guardado (falha continua visível).
const PRINTED_LIST_TTL_OFF_MS = 15 * 1000;
const PRINTED_LIST_TTL_ON_MS = 5 * 1000;
const printedListCache = new Map(); // chave -> { at, value } | { promise }

async function readPrintedListMode(userId, role, isGeneralAdmin) {
  const [{ data: rows, error }, openRestriction] = await Promise.all([
    db().from("whatsapp_individual_sessions").select(PRINTED_LIST_SESSION_COLUMNS).eq("user_id", userId),
    getOpenRestriction(userId)
  ]);
  if (error) throw error;
  return isPrintedListMode({ role, isGeneralAdmin, rows: rows || [], openRestriction });
}

// Memoizado por requisição (layout + menu + página pedem o mesmo dado na mesma navegação) e, por cima, por poucos segundos.
const loadPrintedListMode = cache(async (userId, role, isGeneralAdmin) => {
  if (!userId || !printedListModeAppliesTo({ role, isGeneralAdmin })) return false;
  const key = `${userId}|${role}|${isGeneralAdmin ? 1 : 0}`;
  const hit = printedListCache.get(key);
  const now = Date.now();
  if (hit?.promise) return hit.promise;
  if (hit && now - hit.at < (hit.value ? PRINTED_LIST_TTL_ON_MS : PRINTED_LIST_TTL_OFF_MS)) return hit.value;
  const promise = readPrintedListMode(userId, role, isGeneralAdmin).then(
    (value) => { printedListCache.set(key, { at: Date.now(), value }); return value; },
    (error) => { printedListCache.set(key, null); throw error; }
  );
  printedListCache.set(key, { promise });
  return promise;
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
