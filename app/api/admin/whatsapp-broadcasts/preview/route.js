import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError, previewBroadcast } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Etapa de revisão (item 24) — só calcula, nunca cria nada no banco.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ preview: await previewBroadcast(body, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
