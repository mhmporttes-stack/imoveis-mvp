import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { correctChecklistItem, formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { documentType?, personLabel?, status?, observations? } — correção
// manual, só usada como exceção (item 9: documento não identificado, pessoa
// não identificada, confiança baixa ou classificação incorreta da IA).
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ item: await correctChecklistItem((await params).id, body, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
