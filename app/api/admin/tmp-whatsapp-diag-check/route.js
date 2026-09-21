import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Rota temporária de diagnóstico — checa platform_type/status/
// code_verification_status/pin do número (dados que o teste de conexão
// padrão não pede), pra confirmar se o registro pra Cloud API está
// realmente completo (não só conectividade básica). Remover depois de usar.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  if (!token || !phoneNumberId) return NextResponse.json({ error: "sem credenciais" }, { status: 400 });

  const url = new URL(`https://graph.facebook.com/${version}/${phoneNumberId}`);
  url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating,platform_type,status,code_verification_status,name_status,is_pin_enabled,messaging_limit_tier");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({ status: response.status, payload });
}
