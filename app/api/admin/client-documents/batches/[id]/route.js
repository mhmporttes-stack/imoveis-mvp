import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatClientDocumentsError, getBatchDetail } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const batch = await getBatchDetail((await params).id, auth);
    if (!batch) return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
