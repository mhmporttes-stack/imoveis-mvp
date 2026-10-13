import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { checkClientHasWhatsapp } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// O número do cliente tem WhatsApp? (2026-10-13) Só pergunta ao WhatsApp pela sessão conectada do corretor; não envia nada.
// { exists: true | false | null } — null = sem como saber (nunca bloqueia o botão por isso).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const clientId = new URL(request.url).searchParams.get("clientId") || "";
    if (!clientId) return NextResponse.json({ error: "Informe o cliente." }, { status: 400 });
    return NextResponse.json(await checkClientHasWhatsapp(clientId, auth), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
