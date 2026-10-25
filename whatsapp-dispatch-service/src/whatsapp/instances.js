import { digitsOf } from "../utils/phone.js";

// Cloud API — cadastro e conexão de um número.
// "Registrar" aqui = guardar os identificadores (phone_number_id, waba_id) já criados no WhatsApp Manager e conferir
// de verdade pela Graph API. O registro do número na plataforma (verificação por SMS/voz, PIN) é feito pela Meta,
// fora deste serviço.
// GET /{phone-number-id}?fields=... — https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
//   status "CONNECTED" é o único estado em que o número envia/recebe pela API.

export const CLOUD_PHONE_FIELDS = "display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status";

export function validateCloudRegistration(instance) {
  const cfg = instance.provider_config || {};
  const problems = [];
  if (!/^\d{5,30}$/.test(String(cfg.phone_number_id || ""))) problems.push("provider_config.phone_number_id ausente ou inválido");
  if (cfg.waba_id != null && !/^\d{5,30}$/.test(String(cfg.waba_id))) problems.push("provider_config.waba_id inválido");
  return problems;
}

export async function checkCloudConnection(graph, token, instance) {
  const id = instance.provider_config?.phone_number_id;
  const data = await graph.request("GET", `/${id}`, { token, query: { fields: CLOUD_PHONE_FIELDS } });
  const providerStatus = String(data.status || "").toUpperCase();
  const phoneMatches = digitsOf(data.display_phone_number) === digitsOf(instance.phone_e164);
  const details = {
    provider_status: providerStatus || null,
    display_phone_number: data.display_phone_number || null,
    verified_name: data.verified_name || null,
    name_status: data.name_status || null,
    quality_rating: data.quality_rating || null,
    code_verification_status: data.code_verification_status || null
  };
  if (!phoneMatches) return { connected: false, state: "error", reason: "phone_mismatch", details };
  if (providerStatus !== "CONNECTED") return { connected: false, state: "disconnected", reason: `provider_status_${providerStatus || "unknown"}`, details };
  const quality = String(data.quality_rating || "").toUpperCase();
  return { connected: true, state: "connected", qualityProblem: quality === "RED", details };
}
