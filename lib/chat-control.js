import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// CHAT DESATIVADO (2026-10-05, após os bloqueios do Benck e do Eduardo): chave global em crm_settings
// (id "whatsapp_chat_control" → { disabled: true }). Com ela ligada: NINGUÉM envia mensagem/reação/edição/exclusão pelo
// Chat (backend: lib/whatsapp-chat.js) e corretor/associado não abrem o Chat nem suas APIs (lib/admin-auth.js); o
// administrador e o gestor continuam VENDO as conversas (as mensagens seguem sendo gravadas). Os corretores usam o
// WhatsApp do próprio celular. Quem reativa é o dono (disabled:false).
const SETTING_ID = "whatsapp_chat_control";
const CACHE_MS = 5000;
let cache = { at: 0, value: false };

export const CHAT_DISABLED_CODE = "CHAT_DISABLED";
export const CHAT_DISABLED_MESSAGE = "O Chat está temporariamente desativado. Envie as mensagens pelo WhatsApp do seu celular.";

export async function isChatDisabled() {
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = false;
  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase.from("crm_settings").select("setting_value").eq("id", SETTING_ID).maybeSingle();
    value = data?.setting_value?.disabled === true;
  } catch {
    value = cache.value; // falha de leitura não liga nem desliga: mantém o último estado conhecido
  }
  cache = { at: Date.now(), value };
  return value;
}

// Corretor e associado (nem administrador geral nem gestor).
export function isChatRestrictedProfile(profile) {
  return profile?.role === "broker" || profile?.role === "associate";
}
