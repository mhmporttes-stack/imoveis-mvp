import { verifyHubSignature, safeEqual } from "../utils/crypto.js";

// Webhooks da Cloud API.
// Verificação (GET): hub.mode=subscribe, hub.verify_token, hub.challenge — https://developers.facebook.com/docs/graph-api/webhooks/getting-started
// Assinatura (POST): X-Hub-Signature-256 = sha256=HMAC-SHA256(corpo bruto, App Secret).
// Conteúdo: object=whatsapp_business_account → entry[].changes[].field
//   messages (statuses[] sent/delivered/read/failed + messages[] de entrada) — webhooks/reference/messages/status
//   phone_number_quality_update, account_update (ACCOUNT_VIOLATION / ACCOUNT_RESTRICTION / DISABLED_UPDATE).

export function verifySubscription(query, verifyToken) {
  if (!verifyToken) return null;
  if (query["hub.mode"] !== "subscribe") return null;
  if (!safeEqual(query["hub.verify_token"], verifyToken)) return null;
  const challenge = String(query["hub.challenge"] ?? "");
  return /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

export function isSignatureValid(rawBody, header, appSecret) {
  return verifyHubSignature(rawBody, header, appSecret);
}

const ACCOUNT_BLOCKING_EVENTS = new Set(["ACCOUNT_VIOLATION", "ACCOUNT_RESTRICTION", "DISABLED_UPDATE"]);

// Normaliza o corpo em eventos internos. Nunca devolve o texto completo da mensagem do cliente
// (só o necessário para detectar o pedido de saída, comparado em memória).
export function parseCloudWebhook(body) {
  const events = [];
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return events;
  for (const entry of body.entry) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      if (change.field === "messages") {
        for (const s of value.statuses || []) {
          events.push({
            kind: "status", phoneNumberId, providerMessageId: s.id, status: String(s.status || ""),
            callbackData: s.biz_opaque_callback_data || null, recipient: s.recipient_id || null,
            timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000) : null,
            errors: (s.errors || []).map((e) => ({ code: String(e.code ?? ""), title: String(e.title || "").slice(0, 200) }))
          });
        }
        for (const m of value.messages || []) {
          events.push({
            kind: "incoming", phoneNumberId, from: m.from || null, providerMessageId: m.id, type: m.type,
            text: m.type === "text" ? String(m.text?.body || "") : m.type === "button" ? String(m.button?.text || "") : "",
            timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : null
          });
        }
      } else if (change.field === "phone_number_quality_update") {
        events.push({ kind: "quality", wabaId: entry.id || null, displayPhoneNumber: value.display_phone_number || null, event: value.event || null });
      } else if (change.field === "account_update") {
        events.push({ kind: "account", wabaId: entry.id || null, event: value.event || null, blocking: ACCOUNT_BLOCKING_EVENTS.has(value.event) });
      } else {
        events.push({ kind: "other", field: String(change.field || "") });
      }
    }
  }
  return events;
}
