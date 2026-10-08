import "server-only";
import { normalizeGraphVersion, sanitizeMetaError } from "./whatsapp-master";

// Registro do número oficial na Cloud API (2026-10-08). No Gerenciador do WhatsApp o número aparece como "Pendente" até
// ser REGISTRADO por POST /{phone-number-id}/register com um PIN de 6 dígitos (verificação em duas etapas). O token e o
// PIN nunca saem do servidor nem são gravados: o PIN digitado pelo dono só vai para a Meta, uma vez.

export class WhatsappRegisterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WhatsappRegisterError";
    this.status = status;
  }
}

function getCredentials() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!token || !phoneNumberId) throw new WhatsappRegisterError("Credenciais da Meta Cloud API não configuradas.", 503);
  return { token, phoneNumberId, version: normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION) };
}

async function graph(url, { token, method = "GET", body }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new WhatsappRegisterError("Não foi possível falar com a Meta agora. Tente de novo em instantes.", 502);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new WhatsappRegisterError(sanitizeMetaError(payload?.error), response.status >= 400 && response.status < 500 ? 400 : 502);
  }
  return payload;
}

export async function getNumberRegistrationStatus() {
  const { token, phoneNumberId, version } = getCredentials();
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}`);
  url.searchParams.set("fields", "display_phone_number,verified_name,status,code_verification_status,quality_rating,name_status,platform_type");
  const data = await graph(url, { token });
  return {
    displayPhoneNumber: String(data.display_phone_number || ""),
    verifiedName: String(data.verified_name || ""),
    status: String(data.status || ""),
    codeVerificationStatus: String(data.code_verification_status || ""),
    qualityRating: String(data.quality_rating || ""),
    nameStatus: String(data.name_status || ""),
    platformType: String(data.platform_type || "")
  };
}

export function isValidRegistrationPin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

export async function registerNumber(pin) {
  if (!isValidRegistrationPin(pin)) throw new WhatsappRegisterError("O PIN precisa ter exatamente 6 números.");
  const { token, phoneNumberId, version } = getCredentials();
  await graph(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/register`, {
    token,
    method: "POST",
    body: { messaging_product: "whatsapp", pin: String(pin) }
  });
  return getNumberRegistrationStatus();
}
