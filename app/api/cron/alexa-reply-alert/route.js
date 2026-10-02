import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processReplyAlerts } from "@/lib/alexa-reply-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A cada minuto: avisa pela Alexa o cliente que espera resposta do corretor há 10 min.
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

  const result = await processReplyAlerts();
  return NextResponse.json({ ok: true, alerted: result?.alerted || 0 });
}
