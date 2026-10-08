import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { WhatsappRegisterError, getAppWebhookConfig, getNumberRegistrationStatus, getWebhookSubscription, registerNumber, subscribeWebhook } from "@/lib/whatsapp-register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error, fallback) {
  const known = error instanceof WhatsappRegisterError;
  return NextResponse.json({ error: known ? error.message : fallback }, { status: known ? error.status : 500, headers: NO_STORE });
}

async function lastWebhookAt() {
  try {
    const { data } = await getSupabaseAdminClient().from("whatsapp_master_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data?.created_at || null;
  } catch {
    return null;
  }
}

async function fullState() {
  const [registration, subscription, lastWebhook, appWebhook] = await Promise.all([
    getNumberRegistrationStatus(),
    getWebhookSubscription().catch(() => ({ subscribed: null, apps: [] })),
    lastWebhookAt(),
    getAppWebhookConfig().catch(() => ({ known: false }))
  ]);
  return { registration, subscription, lastWebhookAt: lastWebhook, appWebhook };
}

// Estado do registro do número oficial + inscrição do webhook (somente administrador geral).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await fullState(), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Não foi possível consultar o número na Meta.");
  }
}

// { pin } registra o número (o PIN de 6 dígitos não é gravado nem logado); { action: "subscribe" } inscreve o app no webhook.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === "subscribe") await subscribeWebhook();
    else await registerNumber(body?.pin);
    return NextResponse.json(await fullState(), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Não foi possível concluir a operação com a Meta.");
  }
}
