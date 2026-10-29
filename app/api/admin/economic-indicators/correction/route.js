import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, calculateCorrection, isMissingEconSchema } from "@/lib/economic-indicators";
import { CORRECTION_CODES } from "@/lib/economic-indicators-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = z.string().regex(/^\d{4}-\d{2}$/);
const BODY = z.object({
  amount: z.coerce.number().positive().max(1e12),
  indicator: z.enum(CORRECTION_CODES),
  startMonth: MONTH,
  endMonth: MONTH
});

// Calculadora de correção monetária (ECON-1): usa só a série oficial gravada no banco. Não grava nada.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = BODY.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Preencha valor, índice e período." }, { status: 400 });
  try {
    const result = await calculateCorrection(parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing || [] }, { status: 422 });
    return NextResponse.json(result);
  } catch (error) {
    if (isMissingEconSchema(error)) return NextResponse.json({ error: ECON_SCHEMA_MESSAGE }, { status: 503 });
    console.error("Correção monetária: falha:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível calcular a correção." }, { status: 500 });
  }
}
