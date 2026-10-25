import { NextResponse } from "next/server";
import { processMessengerWebhook, verifyMessengerWebhookChallenge, verifyMessengerWebhookSignature } from "@/lib/messenger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Webhook do Messenger oficial da Página do Facebook (MSG-1, dono, 2026-10-25). Público por natureza (quem chama é a
// Meta): GET = verificação com MESSENGER_VERIFY_TOKEN; POST só com `x-hub-signature-256` válido (HMAC com
// MESSENGER_APP_SECRET) — sem segredo configurado, falha fechado (401). Mesmo padrão do whatsapp-master. Logs só com
// contagens e motivo: nunca texto da mensagem, nome ou PSID.

export async function GET(request) {
  const challenge = verifyMessengerWebhookChallenge(request.nextUrl.searchParams);
  if (!challenge) {
    log("challenge_rejected", { status: 403 });
    return new NextResponse("Verificação inválida.", { status: 403 });
  }
  log("challenge_accepted", { status: 200 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request) {
  const startedAt = Date.now();
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyMessengerWebhookSignature(rawBody, signature)) {
    log("event_rejected", { status: 401, reason: signature ? "invalid_signature" : "missing_signature", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log("event_rejected", { status: 400, reason: "invalid_json" });
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  try {
    const result = await processMessengerWebhook(payload);
    log("event_processed", { status: 200, object: String(payload?.object || ""), ...result, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log("event_failed", { status: 500, reason: String(error?.code || error?.message || "erro").slice(0, 120), durationMs: Date.now() - startedAt }, true);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}

function log(event, details, isError = false) {
  const record = JSON.stringify({ source: "messenger-webhook", event, timestamp: new Date().toISOString(), route: "/api/webhooks/messenger", ...details });
  if (isError) console.error(record);
  else console.info(record);
}
