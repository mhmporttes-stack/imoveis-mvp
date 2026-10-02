import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveProspectingReply } from "@/lib/prospecting-reply";

export const runtime = "nodejs";

// Botões da pendência: start_service | do_not_contact (resposta) e
// reactivate | keep_do_not_contact (cliente em "Não contactar"). A permissão
// por cliente é checada dentro de resolveProspectingReply (mesma leitura
// escopada da ficha do cliente).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await resolveProspectingReply((await params).id, String(body.action || ""), auth, { reasonKey: body.reasonKey, reasonText: body.reasonText });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível atualizar a pendência." }, { status: error?.status || 400 });
  }
}
