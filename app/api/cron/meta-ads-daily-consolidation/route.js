import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runDailyConsolidation } from "@/lib/meta-ads-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Consolidação diária: ressincroniza entidades + a janela móvel completa
// (META_ADS_SYNC_WINDOW_DAYS) nos 3 níveis, incorporando qualquer ajuste
// retroativo de atribuição que a Meta tenha feito nos últimos dias.
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
    const result = await runDailyConsolidation();
    return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    console.error("Falha ao executar consolidação diária da Meta Ads.", error);
    return NextResponse.json({ error: error?.message || "Falha na consolidação." }, { status: 500 });
  }
}
