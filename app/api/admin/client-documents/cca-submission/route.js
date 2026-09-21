import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatClientDocumentsError, prepareCcaSubmission, submitToCca } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clientId, batchId?, ccaId, propertyType?, propertyValue?,
// propertyName?, cpf?, pis?, action: "preview" | "submit" }
// "Enviar para análise" (item 8 do pedido original) — só Caroline/Admin (a
// checagem assertGeneralAdminOrManager acontece dentro de
// prepareCcaSubmission/submitToCca, nunca aqui, pra nunca ter dois lugares
// com a mesma regra).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    if (body.action === "submit") {
      return NextResponse.json(await submitToCca(body.clientId, body.batchId, body, auth));
    }
    return NextResponse.json(await prepareCcaSubmission(body.clientId, body.batchId, body, auth));
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
