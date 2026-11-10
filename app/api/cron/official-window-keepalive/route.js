import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runOfficialWindowKeepalive } from "@/lib/official-window-keepalive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Rotina das 08:00 (dono, 2026-11-10 — WA-40): cada corretor ativo com WhatsApp individual conectado manda, pelo número pessoal,
// "Bom dia, já estou disponível para atender" ao número Oficial (mantém a janela de 24 h aberta); ~10 min depois confere se chegou e
// reenvia 👋 (até 2x). Idempotente por dia/corretor; só roda entre 08:00 e 12:00 (America/Sao_Paulo). O agendamento (pg_cron) NÃO está
// criado: SQL em docs/WHATSAPP.md. Mesma autenticação dos demais crons (Bearer CRON_SECRET ou hash do token do Supabase).
export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const supabaseCronTokenHash = process.env.SUPABASE_CRON_TOKEN_HASH || "";
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedHash = createHash("sha256").update(suppliedToken).digest("hex");
  const validSupabaseToken = supabaseCronTokenHash.length === suppliedHash.length && timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(supabaseCronTokenHash));
  if ((!secret || authorization !== `Bearer ${secret}`) && !validSupabaseToken) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runOfficialWindowKeepalive()) });
  } catch (error) {
    console.error("Falha na rotina das 08:00 do número oficial.", error);
    return NextResponse.json({ error: "Falha na rotina das 08:00 do número oficial." }, { status: 500 });
  }
}
