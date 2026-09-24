import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processDueFlowSessions } from "@/lib/whatsapp-flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// A cada minuto (migration 20260924120100_whatsapp_flows_cron.sql): retoma os
// Fluxos do WhatsApp que estavam esperando (bloco "Espera" ou prazo de "se não
// responder"). Mesma autenticação dos demais crons deste projeto.
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
    return NextResponse.json({ ok: true, ...(await processDueFlowSessions()) });
  } catch (error) {
    console.error("Falha ao processar os Fluxos do WhatsApp.", error);
    return NextResponse.json({ error: "Falha ao processar os fluxos." }, { status: 500 });
  }
}
