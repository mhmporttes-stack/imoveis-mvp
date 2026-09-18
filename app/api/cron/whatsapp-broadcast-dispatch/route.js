import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processAllActiveBroadcastQueues, formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Rede de segurança do Disparo (item 27): roda a cada minuto (ver migration
// 20260920143000_whatsapp_broadcast_dispatch_cron.sql) e processa a fila de
// QUALQUER campanha ainda em 'processing' — garante que o envio continua
// mesmo se ninguém estiver com a tela aberta. Mesmo padrão de autenticação
// dos outros crons deste projeto (app/api/cron/daily-goal-close e outros).
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
    const result = await processAllActiveBroadcastQueues();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha ao processar a fila de disparo do WhatsApp Master.", error);
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: 500 });
  }
}
