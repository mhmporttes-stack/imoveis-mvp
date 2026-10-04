import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { manualListHttpError } from "@/lib/prospecting-manual-list-core.mjs";
import { getManualList } from "@/lib/prospecting-manual-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Visualizar uma lista (somente leitura): sempre o snapshot gravado na geração.
export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    return NextResponse.json(await getManualList(auth, (await params).id), { headers: NO_STORE });
  } catch (error) {
    const info = manualListHttpError(error, "Não foi possível abrir a lista.");
    if (info.log) console.error("[prospecting-manual-lists]", error?.code || error?.name || "erro");
    return NextResponse.json({ error: info.message }, { status: info.status, headers: NO_STORE });
  }
}
