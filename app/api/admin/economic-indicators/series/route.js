import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getEconomicSeries, isMissingEconSchema } from "@/lib/economic-indicators";
import { ECON_INDICATORS } from "@/lib/economic-indicators-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const QUERY = z.object({
  codes: z.string().transform((v) => [...new Set(v.split(","))]).pipe(z.array(z.enum(ECON_INDICATORS.map((i) => i.code))).min(1).max(4)),
  from: DATE.optional(),
  to: DATE.optional()
});

// Histórico de até 4 indicadores num período (gráficos e comparação). Todos os perfis.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = QUERY.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  try {
    const { codes, from = null, to = null } = parsed.data;
    const series = await Promise.all(codes.map((code) => getEconomicSeries(code, { from, to })));
    return NextResponse.json({ series: Object.fromEntries(codes.map((code, i) => [code, series[i]])) });
  } catch (error) {
    if (isMissingEconSchema(error)) return NextResponse.json({ error: ECON_SCHEMA_MESSAGE }, { status: 503 });
    console.error("Indicadores Econômicos: falha ao ler série:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  }
}
