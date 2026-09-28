import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { analyzeSelectedChatMessages, formatClientDocumentsError, markChatBatchStartFailure, queueChatDocumentRetry, reanalyzeBatch } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const batch = body.retryBatchId
      ? await queueChatDocumentRetry(body.retryBatchId, body.conversationId, auth)
      : await analyzeSelectedChatMessages(body.conversationId, body.messageIds, auth, body.requestKey);
    if (batch.queued) after(async () => { try { await reanalyzeBatch(batch.id, auth); } catch (failure) { console.error("Falha ao iniciar análise documental do Chat:", failure); await markChatBatchStartFailure(batch.id, failure); } });
    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error.status || 400 });
  }
}
