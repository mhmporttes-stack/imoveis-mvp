import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota TEMPORARIA (sera removida logo em seguida) — registra o numero na
// Cloud API (POST /{phone-number-id}/register) com o PIN de verificacao em
// duas etapas fornecido pelo usuario no corpo da requisicao (nunca
// hardcoded aqui, nunca commitado). Resolve o erro 133010 "Account not
// registered" encontrado em producao apos confirmacao explicita do usuario
// (parou de usar ManyChat, numero nao e mais usado no app do celular).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const pin = String(body?.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ error: "PIN deve ter 6 dígitos." }, { status: 400 });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin })
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({ status: response.status, payload });
}
