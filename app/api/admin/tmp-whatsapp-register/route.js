import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { pin } = await request.json().catch(() => ({}));
  if (!pin) return NextResponse.json({ error: "pin obrigatório" }, { status: 400 });

  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin })
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({ status: response.status, payload, phoneIdConfigured: Boolean(phoneId), tokenConfigured: Boolean(token) });
}
