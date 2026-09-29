import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runDailyGoalAutoDispatch } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Automação da Meta Diária pelo WhatsApp individual (pedido do dono,
// 2026-09-29) — ver migration 20260929190000_daily_goal_auto_dispatch.sql
// (agenda a cada 5 minutos). Mesmo padrão de autenticação dos outros crons
// deste projeto (app/api/cron/whatsapp-broadcast-dispatch e outros).
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
    const result = await runDailyGoalAutoDispatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha na automação da Meta Diária.", error);
    return NextResponse.json({ error: error.message || "Falha na automação da Meta Diária." }, { status: 500 });
  }
}
