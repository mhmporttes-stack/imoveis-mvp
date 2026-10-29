import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getEconomicRadar, isMissingEconSchema } from "@/lib/economic-indicators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Card "Radar Econômico" do cabeçalho (IPCA e INCC). Todos os perfis; só leitura do banco.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getEconomicRadar());
  } catch (error) {
    if (isMissingEconSchema(error)) return NextResponse.json({ error: ECON_SCHEMA_MESSAGE }, { status: 503 });
    console.error("Radar Econômico: falha ao ler:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar o Radar Econômico." }, { status: 500 });
  }
}
