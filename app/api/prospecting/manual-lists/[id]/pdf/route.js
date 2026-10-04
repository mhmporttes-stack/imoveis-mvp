import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { manualListHttpError } from "@/lib/prospecting-manual-list-core.mjs";
import { buildManualListPdf } from "@/lib/prospecting-manual-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// PDF A4 da lista (impressão/WhatsApp). Só por rota autenticada, sem URL pública e sem cache. Reimprimir
// devolve SEMPRE a mesma lista (snapshot); nunca seleciona contatos novos.
export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    const { bytes, fileName } = await buildManualListPdf(auth, (await params).id);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const info = manualListHttpError(error, "Não foi possível gerar o PDF.");
    if (info.log) console.error("[prospecting-manual-lists]", error?.code || error?.name || "erro");
    return NextResponse.json({ error: info.message }, { status: info.status, headers: NO_STORE });
  }
}
