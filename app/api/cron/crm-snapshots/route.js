import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runCloseSnapshot, runRefresh, runStockSnapshot } from "@/lib/crm-metrics/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O pg_net do cron espera até 50 s; cada tarefa tem orçamento próprio de 25 s.
export const maxDuration = 55;

// Jobs de métricas da Alexa V2 / CRM (cache recente + retrato diário).
// Mesmo padrão de autenticação dos outros crons — nenhum mecanismo novo.
//   ?mode=refresh (padrão) | stock | close
export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const supabaseCronTokenHash = process.env.SUPABASE_CRON_TOKEN_HASH || "";
  const authorization = request.headers.get("authorization") || "";

  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedHash = createHash("sha256").update(suppliedToken).digest("hex");
  const validSupabaseToken =
    supabaseCronTokenHash.length === suppliedHash.length &&
    timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(supabaseCronTokenHash));

  if ((!secret || authorization !== `Bearer ${secret}`) && !validSupabaseToken) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const mode = new URL(request.url).searchParams.get("mode") || "refresh";
  try {
    if (mode === "stock") return NextResponse.json({ ok: true, mode, ...(await runStockSnapshot()) });
    if (mode === "close") return NextResponse.json({ ok: true, mode, ...(await runCloseSnapshot()) });
    return NextResponse.json({ ok: true, mode: "refresh", ...(await runRefresh()) });
  } catch (error) {
    console.error(`[crm-metrics] modo ${mode} falhou: ${error?.name || "erro"}.`);
    return NextResponse.json({ error: "Falha ao atualizar as métricas." }, { status: 500 });
  }
}
