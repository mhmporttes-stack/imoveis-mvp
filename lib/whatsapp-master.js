import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { saveWhatsappMasterRuntimeSettings } from "./crm";
import { digitsOnly, toBrazilianE164 } from "./phone-utils";
import { getSupabaseAdminClient } from "./supabase";

const DEFAULT_GRAPH_VERSION = "v23.0";

export function getWhatsappMasterEnvironmentStatus() {
  return {
    accessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    businessAccountId: Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    webhookVerifyToken: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    appSecret: Boolean(getAppSecret())
  };
}

export function getWhatsappMasterDisplaySettings(settings) {
  const environment = getWhatsappMasterEnvironmentStatus();
  return {
    ...settings,
    phone: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || settings.phone,
    connectionStatus: environment.accessToken && environment.phoneNumberId
      ? settings.connectionStatus
      : "not_configured"
  };
}

export async function testWhatsappMasterConnection(updatedBy = null) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const checkedAt = new Date().toISOString();

  if (!token || !phoneNumberId) {
    const settings = await saveWhatsappMasterRuntimeSettings({
      connectionStatus: "not_configured",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastCheckedAt: checkedAt,
      lastError: "Credenciais da Meta ainda não configuradas."
    }, updatedBy);
    return { ok: false, settings, error: settings.lastError };
  }

  try {
    const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}`);
    url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));

    const settings = await saveWhatsappMasterRuntimeSettings({
      phone: payload.display_phone_number || "",
      connectionStatus: "connected",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastConnectedAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: "",
      active: true
    }, updatedBy);
    return {
      ok: true,
      settings,
      meta: { verifiedName: payload.verified_name || "", qualityRating: payload.quality_rating || "" }
    };
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "A API da Meta não respondeu a tempo."
      : String(error?.message || "Falha ao validar a conexão com a Meta.").slice(0, 240);
    const settings = await saveWhatsappMasterRuntimeSettings({
      connectionStatus: "disconnected",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastCheckedAt: checkedAt,
      lastError: message
    }, updatedBy);
    return { ok: false, settings, error: message };
  }
}

export function verifyWhatsappWebhookChallenge(searchParams) {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
  const mode = searchParams.get("hub.mode") || "";
  const token = searchParams.get("hub.verify_token") || "";
  const challenge = searchParams.get("hub.challenge") || "";
  return expected && mode === "subscribe" && challenge && safeEqual(token, expected) ? challenge : null;
}

export function verifyWhatsappWebhookSignature(rawBody, signature) {
  const secret = getAppSecret();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signature, expected);
}

export async function diagnoseWhatsappMetaRuntime() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const appId = process.env.WHATSAPP_APP_ID || "";
  const appSecret = getAppSecret();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);

  if (!token || !appId || !appSecret || !phoneNumberId || !businessAccountId) {
    return { ok: false, reason: "missing_runtime_configuration" };
  }

  const debugForm = new URLSearchParams({
    input_token: token,
    access_token: `${appId}|${appSecret}`
  });
  const [debugResponse, phoneResponse, subscriptionsResponse] = await Promise.all([
    fetch(`https://graph.facebook.com/${version}/debug_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: debugForm,
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    }),
    fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,status,platform_type`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    }),
    fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(businessAccountId)}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    })
  ]);

  const debugPayload = await debugResponse.json().catch(() => ({}));
  const phonePayload = await phoneResponse.json().catch(() => ({}));
  const subscriptionsPayload = await subscriptionsResponse.json().catch(() => ({}));
  const debug = debugPayload?.data || {};

  return {
    ok: debugResponse.ok && phoneResponse.ok && subscriptionsResponse.ok,
    debugToken: {
      isValid: debug?.is_valid === true,
      appId: String(debug?.app_id || ""),
      userId: String(debug?.user_id || ""),
      expiresAt: Number(debug?.expires_at || 0),
      dataAccessExpiresAt: Number(debug?.data_access_expires_at || 0),
      scopes: Array.isArray(debug?.scopes) ? debug.scopes.map(String).sort() : [],
      granularScopes: Array.isArray(debug?.granular_scopes)
        ? debug.granular_scopes.map((scope) => ({ scope: String(scope?.scope || ""), targetIds: (scope?.target_ids || []).map(String) }))
        : []
    },
    phone: phoneResponse.ok ? {
      id: String(phonePayload?.id || ""),
      displayPhoneNumber: String(phonePayload?.display_phone_number || ""),
      status: String(phonePayload?.status || ""),
      platformType: String(phonePayload?.platform_type || "")
    } : { errorCode: Number(phonePayload?.error?.code || 0) },
    subscribedApps: subscriptionsResponse.ok
      ? (subscriptionsPayload?.data || []).map((app) => ({ id: String(app?.id || ""), name: String(app?.name || "") }))
      : [],
    responseStatus: {
      debugToken: debugResponse.status,
      phone: phoneResponse.status,
      subscribedApps: subscriptionsResponse.status
    }
  };
}

export async function processWhatsappWebhook(payload) {
  const configuredPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const metadata = getWebhookMetadata(payload);

  if (!configuredPhoneNumberId) throw new Error("ID do número WhatsApp Master não configurado.");
  if (!metadata.phoneNumberIds.includes(configuredPhoneNumberId)) {
    return { received: 0, inserted: 0, ignored: "phone_number_id_mismatch" };
  }

  const events = extractWhatsappEvents(payload, configuredPhoneNumberId);
  if (!events.length) return { received: 0, inserted: 0 };

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase não configurado no servidor.");

  const rows = [];
  for (const event of events) {
    const clientId = event.sender_phone ? await findClientByPhone(event.sender_phone) : null;
    rows.push({ ...event, related_client_id: clientId });
  }

  const { data, error } = await supabase
    .from("whatsapp_master_events")
    .upsert(rows, { onConflict: "event_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;

  const now = new Date().toISOString();
  await saveWhatsappMasterRuntimeSettings({
    phoneNumberId: configuredPhoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    connectionStatus: "connected",
    lastConnectedAt: now,
    lastWebhookAt: now,
    lastError: "",
    active: true
  });

  return { received: events.length, inserted: data?.length || 0 };
}

function extractWhatsappEvents(payload, configuredPhoneNumberId) {
  const rows = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const recipientPhoneId = value?.metadata?.phone_number_id || "";
      if (recipientPhoneId !== configuredPhoneNumberId) continue;
      const contacts = new Map((value.contacts || []).map((contact) => [digitsOnly(contact?.wa_id), contact?.profile?.name || ""]));

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const senderPhone = normalizeIncomingPhone(message?.from);
        const messageId = String(message?.id || "");
        if (!messageId) continue;
        rows.push({
          event_key: `message:${messageId}`,
          message_id: messageId,
          direction: "inbound",
          event_type: "message",
          sender_phone: senderPhone || null,
          contact_name: contacts.get(digitsOnly(message?.from)) || null,
          recipient_phone_id: recipientPhoneId || null,
          message_type: message?.type || "unknown",
          message_text: extractMessageText(message),
          event_at: unixToIso(message?.timestamp),
          raw_payload: { message, metadata: value.metadata || {} }
        });
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = String(status?.id || "");
        const statusName = String(status?.status || "unknown");
        if (!messageId) continue;
        rows.push({
          event_key: `status:${messageId}:${statusName}:${status?.timestamp || ""}`,
          message_id: messageId,
          direction: "outbound",
          event_type: statusName,
          sender_phone: normalizeIncomingPhone(status?.recipient_id) || null,
          contact_name: null,
          recipient_phone_id: recipientPhoneId || null,
          message_type: null,
          message_text: null,
          event_at: unixToIso(status?.timestamp),
          raw_payload: { status, metadata: value.metadata || {} }
        });
      }
    }
  }
  return rows;
}

async function findClientByPhone(phone) {
  const supabase = getSupabaseAdminClient();
  const e164 = toBrazilianE164(phone);
  const digits = digitsOnly(phone);
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  const candidates = Array.from(new Set([e164, digits, national].filter(Boolean)));
  if (!candidates.length) return null;

  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("id")
    .or(candidates.map((candidate) => `phone_normalized.eq.${candidate}`).join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

function getWebhookMetadata(payload) {
  const phoneNumberIds = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const metadata = change?.value?.metadata;
      if (metadata?.phone_number_id) phoneNumberIds.push(String(metadata.phone_number_id));
    }
  }
  return { phoneNumberIds };
}

function extractMessageText(message) {
  if (message?.type === "text") return message?.text?.body || null;
  if (message?.type === "button") return message?.button?.text || null;
  if (message?.type === "interactive") {
    return message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || null;
  }
  return null;
}

function normalizeIncomingPhone(value) {
  return toBrazilianE164(value) || (digitsOnly(value) ? `+${digitsOnly(value)}` : "");
}

function unixToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeGraphVersion(value) {
  const version = String(value || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

function getAppSecret() {
  return process.env.WHATSAPP_APP_SECRET || process.env.APP_SECRET || "";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeMetaError(error) {
  const message = String(error?.message || "Credenciais recusadas pela Meta.");
  const code = error?.code ? ` (código ${error.code})` : "";
  return `${message}${code}`.slice(0, 240);
}
