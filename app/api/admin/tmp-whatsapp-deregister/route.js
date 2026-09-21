import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Rota temporária: tenta desregistrar o número antigo (que ficou ON_PREMISE/
// DISCONNECTED, travando uma conta nova) via POST /{phone_number_id}/deregister
// - diferente do /register, que já sabíamos ser bloqueado para contas SMB.
// Remover depois de usar.
export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  const oldPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!token || !oldPhoneNumberId) return NextResponse.json({ error: "sem credenciais" }, { status: 400 });

  const response = await fetch(`https://graph.facebook.com/${version}/${oldPhoneNumberId}/deregister`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({ status: response.status, payload });
}
