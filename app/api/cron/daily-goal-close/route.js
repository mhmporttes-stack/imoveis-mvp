import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { closeAllOpenDailyGoals, formatDailyGoalError, freezeDailyGoalPendingForActiveBrokers } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fechamento + congelamento das pendências de todos os corretores (o pg_net do
// cron espera até 50 s; o congelamento tem orçamento próprio de 30 s).
export const maxDuration = 55;

// Rede de segurança diária da Meta Diária: fecha em definitivo qualquer dia
// anterior ainda aberto (de QUALQUER corretor) e devolve à Prospecção quem
// não foi trabalhado — "meta diária é diária", nunca carrega progresso pro
// dia seguinte. getBrokerDailyGoal já fecha o dia anterior do próprio
// corretor toda vez que ele abre a tela; este cron cobre quem passa dias
// sem abrir. Mesmo padrão de autenticação dos outros crons (app/api/cron/
// daily-report, scheduled-activities) — nenhum mecanismo novo.
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
    const result = await closeAllOpenDailyGoals();

    // Início do dia: congela as pendências de hoje (meta = prospecção + pendentes).
    // Roda depois do fechamento e nunca o derruba; quem não for congelado aqui é
    // congelado no primeiro acesso do dia à Meta Diária.
    let pendingFreeze = null;
    try {
      pendingFreeze = await freezeDailyGoalPendingForActiveBrokers();
    } catch (freezeError) {
      console.error("Falha ao congelar as pendências da Meta Diária.", freezeError);
    }
    return NextResponse.json({ ok: true, ...result, pendingFreeze });
  } catch (error) {
    console.error("Falha ao fechar a Meta Diária.", error);
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: 500 });
  }
}
