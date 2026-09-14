import { NextResponse } from "next/server";
import { requireFinancialManagerApi } from "@/lib/admin-auth";
import { createPropertyDocumentUploadTarget, deletePropertyDocumentByUrl } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesma permissão já usada para editar empreendimentos (PUT/POST /api/properties)
// — não amplia nem restringe além do que já existe. Gera uma URL assinada para
// o navegador enviar o PDF direto ao Supabase Storage (o corpo do arquivo nunca
// passa por esta função — é isso que evita o limite de payload da Vercel).
export async function POST(request) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const fileName = String(body?.fileName || "").trim();
    if (!fileName) return NextResponse.json({ error: "Nenhum arquivo foi enviado." }, { status: 400 });
    if (body?.mimeType && body.mimeType !== "application/pdf") {
      return NextResponse.json({ error: "Formato não suportado. Envie um arquivo PDF." }, { status: 400 });
    }

    const target = await createPropertyDocumentUploadTarget(body.propertyId || "drafts", fileName, body.fileSize);
    return NextResponse.json(target, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível enviar o arquivo." }, { status: 400 });
  }
}

export async function DELETE(request) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    if (body?.url) await deletePropertyDocumentByUrl(body.url);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível remover o arquivo." }, { status: 400 });
  }
}
