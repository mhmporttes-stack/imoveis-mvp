import "server-only";
import { createHash } from "crypto";
import { META_PIXEL_ID, normalizePhoneForMeta } from "./meta-pixel-shared";

const GRAPH_API_VERSION = "v21.0";
export const CRM_REGISTRATION_EVENT = "CadastroCRM";

export function canSendMetaConversionEvents() {
  return Boolean(META_PIXEL_ID && process.env.META_CONVERSIONS_API_ACCESS_TOKEN);
}

// IP/user-agent/URL do PRÓPRIO request no servidor — nunca de um valor
// enviado pelo cliente no corpo da requisição (que poderia ser forjado).
export function extractRequestMetadata(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const eventSourceUrl = request.headers.get("referer") || "";
  // Identificadores do navegador/clique da Meta (2026-10-09, qualidade da correspondência): cookies _fbp/_fbc que o
  // próprio pixel grava no domínio do site (chegam junto no POST do formulário); sem _fbc, monta a partir do fbclid
  // da página do formulário, no formato oficial fb.1.<ms>.<fbclid>.
  const cookie = (name) => {
    try { return request.cookies?.get?.(name)?.value || ""; } catch { return ""; }
  };
  return {
    clientIp: forwardedFor.split(",")[0]?.trim() || "",
    userAgent: request.headers.get("user-agent") || "",
    eventSourceUrl,
    fbp: cleanFbCookie(cookie("_fbp")),
    fbc: cleanFbCookie(cookie("_fbc")) || fbcFromUrl(eventSourceUrl)
  };
}

export function cleanFbCookie(value) {
  const text = String(value || "").trim();
  return /^fb\.\d\.\d+\.[\w.-]+$/.test(text) && text.length <= 500 ? text : "";
}

export function fbcFromUrl(url, now = Date.now()) {
  try {
    const fbclid = new URL(url).searchParams.get("fbclid") || "";
    return /^[\w.-]{10,400}$/.test(fbclid) ? `fb.1.${now}.${fbclid}` : "";
  } catch {
    return "";
  }
}

function normalizeNameForMeta(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

// Nome -> fn/ln normalizados (minúsculas, sem acento), como a Meta pede antes do hash.
export function metaNameParts(fullName) {
  const parts = normalizeNameForMeta(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { fn: parts[0], ...(parts.length > 1 ? { ln: parts[parts.length - 1] } : {}) };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Envio server-side (Conversions API) do MESMO evento "Lead" que o pixel do
// navegador dispara — a própria Meta recomenda os dois juntos: o navegador
// pode ser bloqueado (ad blocker, Safari ITP, iOS), o servidor não. O
// eventId compartilhado entre os dois canais (gerado no cliente, ecoado
// aqui) evita que a Meta conte a mesma conversão duas vezes. Best-effort:
// nunca lança exceção — rastreamento não pode derrubar um cadastro real.
export async function sendMetaLeadEvent({ phone, eventId, incomeBracket = "", eventSourceUrl = "", clientIp = "", userAgent = "", fbp = "", fbc = "", fullName = "", externalId = "" } = {}) {
  if (!canSendMetaConversionEvents()) return;

  try {
    const digitsPhone = normalizePhoneForMeta(phone);
    if (!digitsPhone) return;

    const userData = { ph: [sha256Hex(digitsPhone)] };
    if (clientIp) userData.client_ip_address = clientIp;
    if (userAgent) userData.client_user_agent = userAgent;
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;
    const { fn, ln } = metaNameParts(fullName);
    if (fn) userData.fn = [sha256Hex(fn)];
    if (ln) userData.ln = [sha256Hex(ln)];
    userData.country = [sha256Hex("br")];
    if (externalId) userData.external_id = [sha256Hex(String(externalId))];

    const event = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      user_data: userData,
      custom_data: incomeBracket ? { content_category: incomeBracket } : undefined
    };
    if (eventId) event.event_id = eventId;
    if (eventSourceUrl) event.event_source_url = eventSourceUrl;

    // "CadastroCRM" (pedido do dono, 2026-10-08): o "Lead" do pixel vinha inflado por eventos que NÃO são cadastro
    // (ex.: 06/10 a Meta contou 22 leads e o site inteiro recebeu 12 cadastros). Este evento sai SÓ do servidor, depois
    // do cadastro novo gravado no banco — nada no navegador (gateway, extensão, script de terceiro) consegue dispará-lo.
    // É a base da conversão personalizada "Cadastro CRM" no Gerenciador (docs/TRAFEGO_META.md).
    const crmEvent = { ...event, event_name: CRM_REGISTRATION_EVENT, event_id: eventId ? `${eventId}-crm` : undefined };

    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CONVERSIONS_API_ACCESS_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event, crmEvent] })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("Falha ao enviar evento para a Meta Conversions API:", response.status, body.slice(0, 300));
    }
  } catch (error) {
    console.warn("Falha ao enviar evento para a Meta Conversions API:", error?.message || error);
  }
}
