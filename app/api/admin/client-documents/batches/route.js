import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createDocumentBatch, formatClientDocumentsError, listDocumentBatches } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?clientId=... — histórico de lotes do cliente.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    return NextResponse.json({ batches: await listDocumentBatches(clientId, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}

// POST { clientId, files: [{name, size, type}] } — cria o lote e devolve as
// URLs assinadas de upload direto pro Storage (uma por arquivo).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const result = await createDocumentBatch(body.clientId, body.files, auth);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
