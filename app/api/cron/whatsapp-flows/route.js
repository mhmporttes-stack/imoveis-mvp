import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { processDueFlowSessions } from "@/lib/whatsapp-flows";
import { processFormReminders } from "@/lib/whatsapp-form-reminder";
import { processAutoSimulationSends } from "@/lib/simulation-auto-send";
import { processWelcomeVoiceAudios } from "@/lib/client-voice-audio";
import { checkWhatsappServiceStalled } from "@/lib/whatsapp-service-stall";
import { checkFalseConnections } from "@/lib/whatsapp-false-connection";
import { checkMarketplaceExtensionSignal, checkMarketplaceRedistributionStalled } from "@/lib/marketplace-chat";

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
  // Envio automático da simulação automática (SIM-AUTO-ENVIO, dono 2026-10-23) — rodado à parte: erro aqui nunca impede o
  // resto do cron e aparece na resposta/log.
  let autoSimulationSends = null;
  try {
    autoSimulationSends = await processAutoSimulationSends();
  } catch (error) {
    console.error("Falha ao processar o envio automático da simulação.", error);
    autoSimulationSends = { error: "Falha ao processar o envio automático da simulação." };
  }
  // Boas-vindas em áudio com a voz do dono ao lead novo da roleta (VOZ-1, dono 2026-10-23). Nasce desligado; à parte: erro
  // aqui nunca impede o resto do cron.
  let welcomeVoiceAudios = null;
  try {
    welcomeVoiceAudios = await processWelcomeVoiceAudios();
  } catch (error) {
    console.error("Falha ao processar as boas-vindas em áudio.", error);
    welcomeVoiceAudios = { error: "Falha ao processar as boas-vindas em áudio." };
  }
  // Serviço do WhatsApp parado (lease sem renovar há > 5 min) -> alerta à administração. Nunca lança (WA-22).
  const serviceStall = await checkWhatsappServiceStalled();
  // Número "conectado" com evidência de falha (envios sem confirmação, fila travada): reinicia sem QR; persistiu -> marca e avisa. Nunca lança.
  const falseConnections = await checkFalseConnections();
  // Redistribuição do Chat do Marketplace sem rodar com sucesso há > 10 min -> alerta aos admins gerais (MKT-2e). Nunca lança.
  const marketplaceRedistribution = await checkMarketplaceRedistributionStalled();
  // Extensão do Marketplace sem sinal há > 30 min no horário da sincronização -> aviso aos admins; volta -> aviso (MKT-2g). Nunca lança.
  const marketplaceExtension = await checkMarketplaceExtensionSignal();
  if (flowsError || remindersError) {
    return NextResponse.json({
      error: flowsError ? "Falha ao processar os fluxos." : "Falha ao processar o lembrete do formulário.",
      ...(flows || {}),
      ...(formReminders ? { formReminders } : {}),
      autoSimulationSends,
      welcomeVoiceAudios,
      serviceStall,
      falseConnections,
      marketplaceRedistribution,
      marketplaceExtension
    }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...flows, formReminders, autoSimulationSends, welcomeVoiceAudios, serviceStall, falseConnections, marketplaceRedistribution, marketplaceExtension });
}
