import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota TEMPORARIA de diagnostico (sera removida logo em seguida) — consulta
// campos de status de registro do numero direto na Graph API, para investigar
// o erro 133010 "Account not registered" encontrado em producao.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const version = "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}`);
  url.searchParams.set("fields", "display_phone_number,verified_name,code_verification_status,platform_type,throughput,quality_rating,messaging_limit_tier,is_official_business_account,status,name_status");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({ status: response.status, payload });
}
