import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { confirmDocumentBatchUpload, formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A análise por IA roda de forma síncrona aqui (chamada única à Anthropic
// para o lote inteiro) — precisa de mais tempo que o padrão de rota.
export const maxDuration = 120;

// POST { files: [{name, path, mimeType, size}] } — chamada depois que o
// navegador já subiu todos os arquivos direto pro Storage usando as URLs
// assinadas de POST /batches. Já dispara a análise (item 2 do pedido: o
// corretor não clica em "analisar", só solta os arquivos).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const batch = await confirmDocumentBatchUpload((await params).id, body.files, auth);
    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
