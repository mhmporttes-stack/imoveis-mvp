import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError, syncTemplatesFromMeta } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Item 9 do pedido: traz TODOS os templates já existentes na conta da Meta
// (criados por aqui ou não) para o registro local, evitando duplicidade.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ templates: await syncTemplatesFromMeta(auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
