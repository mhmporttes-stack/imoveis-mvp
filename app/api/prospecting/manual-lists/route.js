import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { generateManualList, getManualListsOverview } from "@/lib/prospecting-manual-lists";
import { manualListHttpError } from "@/lib/prospecting-manual-list-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Imprimir lista" da Prospecção (2026-10-04). Mesmo escopo da atribuição em massa: só admin e gestor
// (gestor só para a própria equipe — conferido em lib/prospecting-manual-lists.js). Telefone de cliente é
// dado pessoal: resposta sempre sem cache e sem log de conteúdo.
const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error) {
  const info = manualListHttpError(error, "Não foi possível concluir a operação.");
  if (info.log) console.error("[prospecting-manual-lists]", error?.code || error?.name || "erro");
  return NextResponse.json({ error: info.message }, { status: info.status, headers: NO_STORE });
}

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await getManualListsOverview(auth, { brokerId: params.get("brokerId") || "", offset: params.get("offset") || 0 }), { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await generateManualList(auth, { brokerId: body?.brokerId, requestKey: body?.requestKey }), { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
