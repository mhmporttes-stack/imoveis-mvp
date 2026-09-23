import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { runBackfill } from "@/lib/meta-ads-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backfill histórico — operação rara e pesada, disparada manualmente pelo
// admin geral (não pelo cron). Retomável: reexecutar esta rota continua de
// onde o backfill anterior parou (meta_ad_sync_state.backfill_completed_through),
// nunca duplica graças ao UPSERT em meta_ad_insights.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode disparar o backfill da Meta Ads.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const result = await runBackfill({ startDate: payload?.startDate });
    return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    console.error("Falha ao executar backfill da Meta Ads.", error);
    return NextResponse.json({ error: error?.message || "Falha no backfill." }, { status: 500 });
  }
}
