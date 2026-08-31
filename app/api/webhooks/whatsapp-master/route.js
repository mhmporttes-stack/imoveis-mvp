import { NextResponse } from "next/server";
import { processWhatsappWebhook, verifyWhatsappWebhookChallenge, verifyWhatsappWebhookSignature } from "@/lib/whatsapp-master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const challenge = verifyWhatsappWebhookChallenge(request.nextUrl.searchParams);
  if (!challenge) return new NextResponse("Verificação inválida.", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request) {
  const rawBody = await request.text();
  if (!verifyWhatsappWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  try {
    const result = await processWhatsappWebhook(JSON.parse(rawBody));
    console.info("Webhook WhatsApp Master processado:", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha no webhook WhatsApp Master:", error?.message || "erro desconhecido");
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
