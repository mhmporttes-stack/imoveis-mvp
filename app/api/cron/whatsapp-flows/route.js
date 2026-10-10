import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processDueFlowSessions } from "@/lib/whatsapp-flows";
import { processFormReminders } from "@/lib/whatsapp-form-reminder";
import { checkWhatsappServiceStalled } from "@/lib/whatsapp-service-stall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// A cada minuto (migration 20260924120100_whatsapp_flows_cron.sql): retoma os
// Fluxos do WhatsApp que estavam esperando (bloco "Espera" ou prazo de "se não
// responder"). Mesma autenticação dos demais crons deste projeto.
// Também envia o lembrete do formulário não preenchido (lib/whatsapp-form-reminder.js, 2026-10-09) — rodado à parte:
// erro em um nunca impede o outro, e o erro aparece na resposta e no log.
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

  let flows = null;
  let flowsError = null;
  try {
    flows = await processDueFlowSessions();
  } catch (error) {
    console.error("Falha ao processar os Fluxos do WhatsApp.", error);
    flowsError = error;
  }
  let formReminders = null;
  let remindersError = null;
  try {
    formReminders = await processFormReminders();
  } catch (error) {
    console.error("Falha ao processar o lembrete do formulário.", error);
    remindersError = error;
  }
  // Serviço do WhatsApp parado (lease sem renovar há > 5 min) -> alerta à administração. Nunca lança (WA-22).
  const serviceStall = await checkWhatsappServiceStalled();
  if (flowsError || remindersError) {
    return NextResponse.json({
      error: flowsError ? "Falha ao processar os fluxos." : "Falha ao processar o lembrete do formulário.",
      ...(flows || {}),
      ...(formReminders ? { formReminders } : {}),
      serviceStall
    }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...flows, formReminders, serviceStall });
}
