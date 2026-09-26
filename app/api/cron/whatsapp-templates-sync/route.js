import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { syncTemplatesFromMetaForCron } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Uma vez por dia, 5h (Brasília) — migration 20260926120000_whatsapp_templates_sync_cron.sql: traz da Meta o status atual
// dos modelos (aprovado / em análise / reprovado) para o Chat e o Disparo. Só LÊ na Meta (sem custo). Mesma autenticação
// dos demais crons deste projeto.
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
    return NextResponse.json({ ok: true, ...(await syncTemplatesFromMetaForCron()) });
  } catch (error) {
    console.error("Falha ao sincronizar os modelos do WhatsApp com a Meta.", error);
    return NextResponse.json({ error: "Falha ao sincronizar os modelos." }, { status: 500 });
  }
}
