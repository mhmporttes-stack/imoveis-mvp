import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { generateClientDocumentPdf, formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { clientId } — gera (ou regenera) o PDF consolidado avulso, sem
// enviar pra CCA nem mudar status. Mesma trava de nome/e-mail/PIS
// (.code === "MISSING_CLIENT_FIELDS") do envio pra CCA.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const result = await generateClientDocumentPdf(body.clientId, auth);
    return NextResponse.json(result);
  } catch (error) {
    const responseBody = { error: formatClientDocumentsError(error) };
    if (error?.code === "MISSING_CLIENT_FIELDS") responseBody.missingFields = error.missingFields;
    return NextResponse.json(responseBody, { status: error?.status || 400 });
  }
}
