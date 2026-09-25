import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { setGuideEnabled } from "@/lib/attendance-guides";
import { guideErrorResponse } from "../../guide-errors";

export const runtime = "nodejs";

// Ativar/desativar: guia desativado deixa de abrir para os corretores (o rascunho e o progresso ficam guardados).
export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ guide: await setGuideEnabled((await params).id, body?.enabled === true, auth) });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível alterar o guia.");
  }
}
