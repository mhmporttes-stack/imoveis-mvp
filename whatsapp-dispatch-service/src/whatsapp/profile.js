import { ProviderError } from "../utils/errors.js";

// Cloud API — perfil comercial do número.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles
//   GET  /{phone-number-id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical
//   POST /{phone-number-id}/whatsapp_business_profile  { messaging_product: "whatsapp", <campos> } → { success: true }
// Foto: Resumable Upload API → handle → profile_picture_handle.
// https://developers.facebook.com/docs/graph-api/guides/upload
//   POST /{app-id}/uploads?file_name&file_length&file_type&access_token → { id: "upload:..." }
//   POST /upload:<id>  (Authorization: OAuth <token>, file_offset: 0, corpo binário) → { h }
// Nome comercial (display name): NÃO há campo no perfil; é definido no registro do número e alterado no WhatsApp
// Manager com revisão da Meta (https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names).
// A API só LÊ (verified_name / name_status).

export const PROFILE_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";
export const VERTICALS = ["ALCOHOL", "APPAREL", "AUTO", "BEAUTY", "EDU", "ENTERTAIN", "EVENT_PLAN", "FINANCE", "GOVT", "GROCERY",
  "HEALTH", "HOTEL", "NONPROFIT", "ONLINE_GAMBLING", "OTC_DRUGS", "OTHER", "PHYSICAL_GAMBLING", "PROF_SERVICES", "RESTAURANT",
  "RETAIL", "TRAVEL"];
export const PROFILE_LIMITS = { about: 139, address: 256, description: 512, email: 128 };

const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export async function getCloudProfile(graph, token, instance) {
  const data = await graph.request("GET", `/${instance.provider_config.phone_number_id}/whatsapp_business_profile`, {
    token, query: { fields: PROFILE_FIELDS }
  });
  return Array.isArray(data?.data) ? data.data[0] || {} : {};
}

export async function updateCloudProfile(graph, token, instance, fields) {
  const data = await graph.request("POST", `/${instance.provider_config.phone_number_id}/whatsapp_business_profile`, {
    token, json: { messaging_product: "whatsapp", ...fields }
  });
  if (data?.success !== true) throw new ProviderError("Graph API não confirmou a atualização do perfil.", { kind: "temporary" });
  return { success: true };
}

export async function uploadCloudProfilePhoto(graph, token, instance, { url, appId, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!appId) throw new ProviderError("WA_APP_ID não configurado (necessário para enviar a foto).", { kind: "permanent", instanceImpact: "not_configured" });
  if (!/^https:\/\//i.test(String(url || ""))) throw new ProviderError("URL da foto precisa ser https.", { kind: "permanent" });
  let image;
  try {
    image = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(`Não foi possível baixar a foto (${error?.name || "erro"}).`, { kind: "temporary" });
  }
  if (!image.ok) throw new ProviderError(`Download da foto respondeu ${image.status}.`, { kind: image.status >= 500 ? "temporary" : "permanent" });
  const type = String(image.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.has(type)) throw new ProviderError(`Tipo de imagem não aceito: ${type || "desconhecido"}.`, { kind: "permanent" });
  const bytes = Buffer.from(await image.arrayBuffer());
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES) throw new ProviderError("Foto vazia ou maior que 5 MB.", { kind: "permanent" });

  const session = await graph.request("POST", `/${appId}/uploads`, {
    token,
    query: { file_name: type === "image/png" ? "perfil.png" : "perfil.jpg", file_length: bytes.length, file_type: type, access_token: token }
  });
  if (!/^upload:/.test(String(session?.id || ""))) throw new ProviderError("Graph API não devolveu a sessão de upload.", { kind: "temporary" });
  const uploaded = await graph.request("POST", `/${session.id}`, {
    token, authScheme: "OAuth", headers: { file_offset: "0" }, body: bytes
  });
  if (!uploaded?.h) throw new ProviderError("Graph API não devolveu o handle da foto.", { kind: "temporary" });
  return { handle: uploaded.h };
}
