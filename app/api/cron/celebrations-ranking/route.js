import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runCelebrationRankingTick } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Acompanha quem está em 1º no ranking do dia e dispara "assumiu a
// liderança" ao completar o tempo mínimo configurado — de 2 em 2 minutos.
// Mesmo padrão de autenticação dos outros crons deste projeto (nenhum
// mecanismo novo).
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
    const result = await runCelebrationRankingTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha no tick de reconhecimentos do ranking.", error);
    return NextResponse.json({ error: error.message || "Falha no tick." }, { status: 500 });
  }
}
