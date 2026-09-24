import "server-only";
import { normalizeGraphVersion, sanitizeMetaError } from "./whatsapp-master";

// Perfil comercial do número oficial do WhatsApp (o que o cliente vê ao tocar
// no nome da empresa): foto, recado, descrição, endereço, e-mail, sites e
// categoria. Tudo via Graph API (`whatsapp_business_profile`) com o mesmo
// token do envio — o token nunca sai do servidor.
//
// O NOME de exibição (verified_name) NÃO é editável por aqui: a Meta só altera
// pelo Gerenciador do WhatsApp, com análise/aprovação. Só é lido e mostrado.

export const PROFILE_LIMITS = { about: 139, description: 512, address: 256, email: 128, website: 256, websites: 2 };

export const PROFILE_VERTICALS = [
  { value: "UNDEFINED", label: "Não definido" },
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "RETAIL", label: "Varejo" },
  { value: "FINANCE", label: "Finanças" },
  { value: "EDU", label: "Educação" },
  { value: "HEALTH", label: "Saúde" },
  { value: "EVENT_PLAN", label: "Eventos" },
  { value: "HOTEL", label: "Hotelaria" },
  { value: "TRAVEL", label: "Viagens" },
  { value: "AUTO", label: "Automotivo" },
  { value: "BEAUTY", label: "Beleza e estética" },
  { value: "APPAREL", label: "Moda" },
  { value: "ENTERTAIN", label: "Entretenimento" },
  { value: "GROCERY", label: "Mercado" },
  { value: "RESTAURANT", label: "Restaurante" },
  { value: "GOVT", label: "Governo" },
  { value: "NONPROFIT", label: "Sem fins lucrativos" },
  { value: "OTHER", label: "Outro" }
];

const PROFILE_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_MIME_TYPES = ["image/jpeg", "image/png"];

export class WhatsappProfileError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WhatsappProfileError";
    this.status = status;
  }
}

function getCredentials() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!token || !phoneNumberId) throw new WhatsappProfileError("Credenciais da Meta Cloud API não configuradas.", 503);
  return { token, phoneNumberId, version: normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION) };
}

async function graphRequest(url, { token, method = "GET", body, headers = {}, authScheme = "Bearer", timeout = 15000 }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `${authScheme} ${token}`, ...headers },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    throw new WhatsappProfileError(
      error?.name === "TimeoutError" ? "A API da Meta não respondeu a tempo." : "Não foi possível falar com a API da Meta.",
      502
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new WhatsappProfileError(sanitizeMetaError(payload?.error), 400);
  return payload;
}

function shapeProfile(profile, phone) {
  return {
    about: profile?.about || "",
    description: profile?.description || "",
    address: profile?.address || "",
    email: profile?.email || "",
    vertical: profile?.vertical || "UNDEFINED",
    websites: Array.isArray(profile?.websites) ? profile.websites.slice(0, PROFILE_LIMITS.websites) : [],
    pictureUrl: profile?.profile_picture_url || "",
    displayName: phone?.verified_name || "",
    displayPhone: phone?.display_phone_number || "",
    nameStatus: phone?.name_status || ""
  };
}

export async function getWhatsappBusinessProfile() {
  const { token, phoneNumberId, version } = getCredentials();
  const base = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}`;

  const profileUrl = new URL(`${base}/whatsapp_business_profile`);
  profileUrl.searchParams.set("fields", PROFILE_FIELDS);
  const phoneUrl = new URL(base);
  phoneUrl.searchParams.set("fields", "verified_name,display_phone_number,name_status");

  const [profilePayload, phone] = await Promise.all([
    graphRequest(profileUrl, { token }),
    graphRequest(phoneUrl, { token }).catch(() => null)
  ]);
  return shapeProfile(profilePayload?.data?.[0] || {}, phone);
}

function cleanText(value, max, label) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > max) throw new WhatsappProfileError(`${label}: no máximo ${max} caracteres.`);
  return text;
}

// Valida e monta só os campos enviados (PATCH parcial). A Meta exige recado
// (about) não vazio; os demais campos vazios limpam o valor no perfil.
export function validateProfileInput(input = {}) {
  const changes = {};

  if ("about" in input) {
    const about = cleanText(input.about, PROFILE_LIMITS.about, "Recado");
    if (!about) throw new WhatsappProfileError("O recado (\"Info\") não pode ficar vazio.");
    changes.about = about;
  }
  if ("description" in input) changes.description = cleanText(input.description, PROFILE_LIMITS.description, "Descrição");
  if ("address" in input) changes.address = cleanText(input.address, PROFILE_LIMITS.address, "Endereço");
  if ("email" in input) {
    const email = cleanText(input.email, PROFILE_LIMITS.email, "E-mail");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WhatsappProfileError("E-mail inválido.");
    changes.email = email;
  }
  if ("vertical" in input) {
    const vertical = String(input.vertical || "UNDEFINED");
    if (!PROFILE_VERTICALS.some((item) => item.value === vertical)) throw new WhatsappProfileError("Categoria inválida.");
    changes.vertical = vertical;
  }
  if ("websites" in input) {
    const list = (Array.isArray(input.websites) ? input.websites : []).map((site) => String(site || "").trim()).filter(Boolean);
    if (list.length > PROFILE_LIMITS.websites) throw new WhatsappProfileError(`No máximo ${PROFILE_LIMITS.websites} sites.`);
    for (const site of list) {
      if (site.length > PROFILE_LIMITS.website) throw new WhatsappProfileError("Endereço de site muito longo.");
      if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(site)) throw new WhatsappProfileError(`Site inválido: ${site} (use http:// ou https://).`);
    }
    changes.websites = list;
  }
  return changes;
}

async function postProfile(changes) {
  const { token, phoneNumberId, version } = getCredentials();
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile`;
  await graphRequest(url, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...changes })
  });
}

export async function updateWhatsappBusinessProfile(input) {
  const changes = validateProfileInput(input);
  if (!Object.keys(changes).length) throw new WhatsappProfileError("Nada para atualizar.");
  await postProfile(changes);
  return getWhatsappBusinessProfile();
}

// A Resumable Upload API exige o ID do APP da Meta. Vem de WHATSAPP_APP_ID
// (opcional) ou é descoberto pelo próprio token via /debug_token.
async function resolveAppId({ token, version }) {
  const fromEnv = String(process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || "").trim();
  if (/^\d+$/.test(fromEnv)) return fromEnv;
  const url = new URL(`https://graph.facebook.com/${version}/debug_token`);
  url.searchParams.set("input_token", token);
  const payload = await graphRequest(url, { token });
  const appId = String(payload?.data?.app_id || "");
  if (!/^\d+$/.test(appId)) throw new WhatsappProfileError("Não foi possível identificar o app da Meta para enviar a foto.", 502);
  return appId;
}

export async function updateWhatsappProfilePhoto({ buffer, mimeType }) {
  if (!PHOTO_MIME_TYPES.includes(mimeType)) throw new WhatsappProfileError("A foto precisa ser JPG ou PNG.");
  if (!buffer?.length) throw new WhatsappProfileError("Arquivo de foto vazio.");
  if (buffer.length > PHOTO_MAX_BYTES) throw new WhatsappProfileError("A foto passou de 4 MB. Use uma imagem menor.");

  const credentials = getCredentials();
  const { token, version } = credentials;
  const appId = await resolveAppId(credentials);

  // 1) abre a sessão de upload; 2) envia os bytes e recebe o "handle";
  // 3) aplica o handle no perfil.
  const sessionUrl = new URL(`https://graph.facebook.com/${version}/${appId}/uploads`);
  sessionUrl.searchParams.set("file_length", String(buffer.length));
  sessionUrl.searchParams.set("file_type", mimeType);
  sessionUrl.searchParams.set("file_name", mimeType === "image/png" ? "perfil.png" : "perfil.jpg");
  const session = await graphRequest(sessionUrl, { token, method: "POST" });
  if (!session?.id) throw new WhatsappProfileError("A Meta não abriu a sessão de envio da foto.", 502);

  const upload = await graphRequest(`https://graph.facebook.com/${version}/${session.id}`, {
    token,
    authScheme: "OAuth",
    method: "POST",
    headers: { file_offset: "0", "Content-Type": mimeType },
    body: buffer,
    timeout: 30000
  });
  if (!upload?.h) throw new WhatsappProfileError("A Meta não devolveu o identificador da foto.", 502);

  await postProfile({ profile_picture_handle: upload.h });
  return getWhatsappBusinessProfile();
}
