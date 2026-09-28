import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { sendDocumentPendingMessage, formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ message: await sendDocumentPendingMessage((await params).id, body.conversationId, body.message, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error.status || 400 });
  }
}
