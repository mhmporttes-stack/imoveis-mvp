import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getEconomicOverview, isMissingEconSchema } from "@/lib/economic-indicators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Indicadores Econômicos (ECON-1): todos os perfis do painel. Só leitura do banco (a coleta é do cron).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getEconomicOverview());
  } catch (error) {
    if (isMissingEconSchema(error)) return NextResponse.json({ error: ECON_SCHEMA_MESSAGE }, { status: 503 });
    console.error("Indicadores Econômicos: falha ao ler:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar os indicadores." }, { status: 500 });
  }
}
