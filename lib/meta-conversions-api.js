import "server-only";
import { createHash } from "crypto";
import { META_PIXEL_ID, normalizePhoneForMeta } from "./meta-pixel-shared";

const GRAPH_API_VERSION = "v21.0";

export function canSendMetaConversionEvents() {
  return Boolean(META_PIXEL_ID && process.env.META_CONVERSIONS_API_ACCESS_TOKEN);
}

// IP/user-agent/URL do PRÓPRIO request no servidor — nunca de um valor
// enviado pelo cliente no corpo da requisição (que poderia ser forjado).
export function extractRequestMetadata(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return {
    clientIp: forwardedFor.split(",")[0]?.trim() || "",
    userAgent: request.headers.get("user-agent") || "",
    eventSourceUrl: request.headers.get("referer") || ""
  };
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
export async function sendMetaLeadEvent({ phone, eventId, incomeBracket = "", eventSourceUrl = "", clientIp = "", userAgent = "" } = {}) {
  if (!canSendMetaConversionEvents()) return;

  try {
    const digitsPhone = normalizePhoneForMeta(phone);
    if (!digitsPhone) return;

    const userData = { ph: [sha256Hex(digitsPhone)] };
    if (clientIp) userData.client_ip_address = clientIp;
    if (userAgent) userData.client_user_agent = userAgent;

    const event = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      user_data: userData,
      custom_data: incomeBracket ? { content_category: incomeBracket } : undefined
    };
    if (eventId) event.event_id = eventId;
    if (eventSourceUrl) event.event_source_url = eventSourceUrl;

    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CONVERSIONS_API_ACCESS_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("Falha ao enviar evento para a Meta Conversions API:", response.status, body.slice(0, 300));
    }
  } catch (error) {
    console.warn("Falha ao enviar evento para a Meta Conversions API:", error?.message || error);
  }
}
