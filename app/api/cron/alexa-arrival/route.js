import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processDueArrival } from "@/lib/alexa-arrival";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gatilho leve a cada minuto só para a rotina "Chegada ao escritório" da Alexa:
// assim a fala sai logo depois do atraso configurado (e nunca antes dele).
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

  const result = await processDueArrival();
  return NextResponse.json({ ok: true, ran: Boolean(result?.ran) });
}
