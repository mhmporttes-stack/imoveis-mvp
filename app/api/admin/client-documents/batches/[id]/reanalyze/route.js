import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatClientDocumentsError, reanalyzeBatch } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const batch = await reanalyzeBatch((await params).id, auth);
    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
