import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runIntradaySync } from "@/lib/meta-ads-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ciclo mais frequente (dia corrente, nível "ad") — pensado pra ser
// agendado a cada 1-2h no painel de Cron da Vercel. A consolidação com
// janela móvel completa roda só uma vez por dia (meta-ads-daily-consolidation).
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

  try {
    const result = await runIntradaySync();
    return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    console.error("Falha ao executar sincronização intraday da Meta Ads.", error);
    return NextResponse.json({ error: error?.message || "Falha na sincronização." }, { status: 500 });
  }
}
