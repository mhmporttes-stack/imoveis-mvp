import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getWeeklyRankingWinner } from "@/lib/weekly-ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

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
    const winner = await getWeeklyRankingWinner();
    return NextResponse.json({ ok: true, winner });
  } catch (error) {
    console.error("Falha ao consolidar o ranking semanal.", error);
    return NextResponse.json({ error: "Falha ao consolidar o ranking semanal." }, { status: 500 });
  }
}
