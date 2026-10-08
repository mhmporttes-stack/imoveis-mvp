import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// CONTROLE DO CHAT (chave global em crm_settings, id "whatsapp_chat_control"):
//  - { disabled: true }              → Chat DESLIGADO por inteiro (2026-10-05): ninguém envia pelo Chat e corretor/associado
//                                      nem abre a tela (admin/gestor só leem).
//  - { individualSendDisabled: true }→ Chat HÍBRIDO (2026-10-08): o Chat funciona e o número OFICIAL (Meta) envia
//                                      normalmente; o envio pelo WhatsApp PESSOAL (sessão vinculada) do corretor fica
//                                      desativado — ele responde pelo celular. Para liberar de novo: false.
const SETTING_ID = "whatsapp_chat_control";
const CACHE_MS = 5000;
let cache = { at: 0, value: { disabled: false, individualSendDisabled: false } };

export const CHAT_DISABLED_CODE = "CHAT_DISABLED";
export const CHAT_DISABLED_MESSAGE = "O Chat está temporariamente desativado. Envie as mensagens pelo WhatsApp do seu celular.";
export const CHAT_INDIVIDUAL_DISABLED_CODE = "CHAT_INDIVIDUAL_DISABLED";
export const CHAT_INDIVIDUAL_DISABLED_MESSAGE = "O envio pelo seu WhatsApp pessoal está desativado por enquanto. Responda pelo celular (o número oficial segue funcionando no Chat).";

async function readControl() {
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = cache.value; // falha de leitura não liga nem desliga: mantém o último estado conhecido
  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase.from("crm_settings").select("setting_value").eq("id", SETTING_ID).maybeSingle();
    value = { disabled: data?.setting_value?.disabled === true, individualSendDisabled: data?.setting_value?.individualSendDisabled === true };
  } catch {
    // mantém
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function isChatDisabled() {
  return (await readControl()).disabled;
}

// Envio/reação/edição/exclusão pela sessão PESSOAL do corretor desativados (Chat desligado também conta).
export async function isIndividualChatSendDisabled() {
  const control = await readControl();
  return control.disabled || control.individualSendDisabled;
}

// Corretor e associado (nem administrador geral nem gestor).
export function isChatRestrictedProfile(profile) {
  return profile?.role === "broker" || profile?.role === "associate";
}
