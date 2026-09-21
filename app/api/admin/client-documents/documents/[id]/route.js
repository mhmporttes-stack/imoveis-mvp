import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteClientDocument, formatClientDocumentsError, getDocumentUrl } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — URL assinada temporária para abrir/baixar UM documento específico
// (item 21: nunca link público permanente).
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = await getDocumentUrl((await params).id, auth);
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}

// DELETE — soft delete (item 2: excluir antes do envio externo).
export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await deleteClientDocument((await params).id, auth));
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
