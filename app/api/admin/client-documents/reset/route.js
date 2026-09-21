import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteAllClientDocuments, formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clientId } — apaga TODA a documentação do cliente (arquivos, lotes,
// checklist, envios pra CCA) pra permitir reenviar do zero. Só gestor/admin
// (assertGeneralAdminOrManager acontece dentro de deleteAllClientDocuments).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json(await deleteAllClientDocuments(body.clientId, auth));
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
