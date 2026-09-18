import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError, getBroadcastDetail } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detalhe do lote (item 37): contatos, telefone, status, horário, erro.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const detail = await getBroadcastDetail((await params).id, auth);
    if (!detail) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    return NextResponse.json({ broadcast: detail });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
