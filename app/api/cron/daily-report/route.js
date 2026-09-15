import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getDailyReport } from "@/lib/daily-report";
import { markDailyReportSentOn, sendDailyReportEmail, wasDailyReportSentOn } from "@/lib/daily-report-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesmo padrão de autenticação do cron existente (app/api/cron/scheduled-
// activities) — chamado externamente 1x por dia, perto do fim do
// expediente. getDailyReport (lib/daily-report.js) já é completo; só
// faltava alguém disparar isso automaticamente em vez de depender de
// alguém abrir a tela.
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
    // Visibilidade completa (mesmo padrão de getDailyTeamRankingSnapshot em
    // lib/performance-overview.js) — o relatório é sempre da operação
    // inteira, nunca escopado a um usuário específico.
    const fullVisibilityAuth = { ok: true, user: { email: "" }, profile: { id: "", role: "admin" } };
    const report = await getDailyReport({ period: "today" }, fullVisibilityAuth);

    const alreadySent = await wasDailyReportSentOn(report.range.startDate);
    if (alreadySent) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_sent_today" });
    }

    const result = await sendDailyReportEmail(report);
    if (result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason });
    }

    await markDailyReportSentOn(report.range.startDate);
    return NextResponse.json({ ok: true, sent: true });
  } catch (error) {
    console.error("Falha ao enviar relatório diário automático.", error);
    return NextResponse.json({ error: error?.message || "Falha ao enviar relatório diário." }, { status: 500 });
  }
}
