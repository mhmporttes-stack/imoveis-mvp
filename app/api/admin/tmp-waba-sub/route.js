import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORÁRIO (apagar depois de usar): confere/ativa a assinatura do app
// "Clareia" na WABA do número oficial — sem isso a Meta não entrega webhooks
// (mensagens recebidas/status) dessa WABA. Nunca devolve o token.
export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const version = /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_API_VERSION || "") ? process.env.WHATSAPP_GRAPH_API_VERSION : "v23.0";
  const fix = new URL(request.url).searchParams.get("fix") === "1";
  if (!token || !wabaId) return NextResponse.json({ error: "Credenciais ausentes" }, { status: 500 });

  const call = async (path, init) => {
    const response = await fetch(`https://graph.facebook.com/${version}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) }, cache: "no-store" });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  const out = { wabaId, phoneId };
  out.subscribedBefore = await call(`${wabaId}/subscribed_apps`);
  if (fix) {
    out.subscribeResult = await call(`${wabaId}/subscribed_apps`, { method: "POST" });
    out.subscribedAfter = await call(`${wabaId}/subscribed_apps`);
  }
  out.phone = await call(`${phoneId}?fields=display_phone_number,status,platform_type,webhook_configuration,name_status,quality_rating`);
  return NextResponse.json(out);
}
