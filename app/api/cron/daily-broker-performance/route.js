import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getTodayInSaoPaulo } from "@/lib/daily-report";
import {
  markDailyGoalPerformanceWhatsappSentOn,
  sendDailyGoalPerformanceWhatsappToAllBrokers,
  wasDailyGoalPerformanceWhatsappSentOn
} from "@/lib/daily-goal-performance-whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesmo padrão de autenticação dos outros crons (scheduled-activities,
// daily-report) — dispara 1x por dia, perto do fim do expediente, mandando
// pra CADA corretor uma mensagem de WhatsApp com o desempenho dele no dia
// (reaproveita os mesmos números já existentes em Meta Diária/Desempenho,
// ver lib/daily-goal-performance-whatsapp.js).
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
    const today = getTodayInSaoPaulo();
    const alreadySent = await wasDailyGoalPerformanceWhatsappSentOn(today);
    if (alreadySent) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_sent_today" });
    }

    const results = await sendDailyGoalPerformanceWhatsappToAllBrokers();
    await markDailyGoalPerformanceWhatsappSentOn(today, results);

    return NextResponse.json({
      ok: true,
      checked: results.length,
      sent: results.filter((item) => item.sent).length,
      failed: results.filter((item) => item.error).length,
      results
    });
  } catch (error) {
    console.error("Falha ao enviar WhatsApp diario de desempenho.", error);
    return NextResponse.json({ error: error?.message || "Falha ao enviar WhatsApp diario de desempenho." }, { status: 500 });
  }
}
