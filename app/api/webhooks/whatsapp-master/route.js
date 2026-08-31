import { NextResponse } from "next/server";
import { diagnoseWhatsappMetaRuntime, processWhatsappWebhook, verifyWhatsappWebhookChallenge, verifyWhatsappWebhookSignature } from "@/lib/whatsapp-master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const challenge = verifyWhatsappWebhookChallenge(request.nextUrl.searchParams);
  if (!challenge) {
    logWebhook("challenge_rejected", { method: "GET", status: 403, reason: "invalid_challenge" });
    return new NextResponse("Verificação inválida.", { status: 403 });
  }
  logWebhook("challenge_accepted", { method: "GET", status: 200 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request) {
  const startedAt = Date.now();
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const signatureValid = verifyWhatsappWebhookSignature(rawBody, signature);
  if (!signatureValid) {
    logWebhook("event_rejected", {
      method: "POST",
      signaturePresent: Boolean(signature),
      signatureValid: false,
      status: 401,
      reason: signature ? "invalid_signature" : "missing_signature",
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logWebhook("event_rejected", {
      method: "POST",
      signaturePresent: true,
      signatureValid: true,
      status: 400,
      reason: "invalid_json",
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const summary = summarizePayload(payload);
  try {
    if (process.env.WHATSAPP_WEBHOOK_DIAGNOSTICS === "true") {
      const diagnostics = await diagnoseWhatsappMetaRuntime();
      logWebhook("meta_runtime_diagnostics", { method: "POST", status: 200, ...diagnostics });
    }
    const result = await processWhatsappWebhook(payload);
    logWebhook("event_processed", {
      method: "POST",
      signaturePresent: true,
      signatureValid: true,
      status: 200,
      ...summary,
      ...result,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logWebhook("event_failed", {
      method: "POST",
      signaturePresent: true,
      signatureValid: true,
      status: 500,
      reason: classifyError(error),
      ...summary,
      durationMs: Date.now() - startedAt
    }, true);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}

function summarizePayload(payload) {
  const wabaIds = [];
  const phoneNumberIds = [];
  const eventTypes = [];
  const messageIds = [];

  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    if (entry?.id) wabaIds.push(String(entry.id));
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field) eventTypes.push(String(change.field));
      const value = change?.value || {};
      if (value?.metadata?.phone_number_id) phoneNumberIds.push(String(value.metadata.phone_number_id));
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        if (message?.id) messageIds.push(String(message.id));
      }
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        if (status?.id) messageIds.push(String(status.id));
        if (status?.status) eventTypes.push(`status:${status.status}`);
      }
    }
  }

  return {
    object: String(payload?.object || ""),
    wabaIds: [...new Set(wabaIds)],
    phoneNumberIds: [...new Set(phoneNumberIds)],
    eventTypes: [...new Set(eventTypes)],
    messageIds: [...new Set(messageIds)]
  };
}

function classifyError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("supabase") || message.includes("database") || message.includes("relation")) return "database_error";
  if (message.includes("id do número")) return "configuration_error";
  return "processing_error";
}

function logWebhook(event, details, isError = false) {
  const record = JSON.stringify({
    source: "whatsapp-master-webhook",
    event,
    timestamp: new Date().toISOString(),
    route: "/api/webhooks/whatsapp-master",
    ...details
  });
  if (isError) console.error(record);
  else console.info(record);
}
