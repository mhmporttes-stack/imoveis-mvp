import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runEconomicIndicatorsCollection } from "@/lib/economic-indicators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Coleta diária dos Indicadores Econômicos (ECON-1): pg_cron `economic-indicators-daily` (migration 20261029120000).
// Mesmo padrão de autenticação dos demais crons: Bearer comparado com CRON_SECRET ou o hash do token do Vault; falha fechado.
export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const hash = process.env.SUPABASE_CRON_TOKEN_HASH || "";
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedHash = createHash("sha256").update(token).digest("hex");
  const validVaultToken = hash.length === suppliedHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(suppliedHash));
  if ((!secret || authorization !== `Bearer ${secret}`) && !validVaultToken) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const result = await runEconomicIndicatorsCollection();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha na coleta dos Indicadores Econômicos.", error);
    return NextResponse.json({ error: "Falha na coleta dos Indicadores Econômicos." }, { status: 500 });
  }
}
