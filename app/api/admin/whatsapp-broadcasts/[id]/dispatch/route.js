import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { dispatchBroadcastNow, formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
// Envia um primeiro lote de mensagens de imediato (até ~25s) antes de
// responder — precisa rodar sem timeout curto de rota estática.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Disparar agora" (item 25/26). Protegido contra clique duplo no próprio
// lib/whatsapp-broadcasts.js (UPDATE condicional em status='draft').
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const broadcast = await dispatchBroadcastNow((await params).id, auth);
    return NextResponse.json({ broadcast });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
