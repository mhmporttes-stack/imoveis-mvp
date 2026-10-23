import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  formatSimulationRegistrationError,
  listDueScheduledActivityNotifications,
  markScheduledActivityNotificationSent,
  reassignOrphanedClientsToOwner
} from "@/lib/simulation-registrations";
import { listDueCalendarActivityNotifications, markCalendarActivityNotified } from "@/lib/calendar-activities";
import { sendScheduledActivityNotification } from "@/lib/scheduled-activity-notifications";
import { runCrmAutomations } from "@/lib/crm-automations";
import { reconcileAdWaitingClients, reconcileOrganicLeads, reconcileSponsoredLeads } from "@/lib/whatsapp-sponsored-lead";
import { reconcileAutoPrivateConversations } from "@/lib/whatsapp-auto-private";
import { reassignPendingRouletteLeads } from "@/lib/lead-distribution";
import { runCaptacaoUploadCleanupIfDue } from "@/lib/captacao-upload-cleanup";
import { processDueArrival } from "@/lib/alexa-arrival";
import { reconcileExpectedReceiptActivities } from "@/lib/financial";
import { runCooledClientsFlow } from "@/lib/cooled-clients";
import { runProspectingAutoReturnJob } from "@/lib/prospecting-auto-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const dueRegistrations = await listDueScheduledActivityNotifications({ limit: 50 });
    const results = [];

    for (const registration of dueRegistrations) {
      try {
        const notification = await sendScheduledActivityNotification(registration);
        if (notification.skipped) {
          results.push({ id: registration.id, skipped: true, reason: notification.reason, channels: notification.channels });
          continue;
        }

        await markScheduledActivityNotificationSent(registration.id);
        results.push({ id: registration.id, sent: true, channels: notification.channels });
      } catch (error) {
        console.error("Falha ao enviar notificacao de atividade agendada.", error);
        results.push({ id: registration.id, error: error?.message || "Falha ao enviar." });
      }
    }

    // Atividades novas (calendar_activities, cliente pode ter várias ao mesmo
    // tempo) têm seu próprio lembrete, independente do mecanismo legado acima
    // — cada uma dispara e é marcada individualmente, sem interferir nas outras.
    const dueCalendarActivities = await listDueCalendarActivityNotifications({ limit: 50 });
    const calendarResults = [];

    for (const item of dueCalendarActivities) {
      try {
        const notification = await sendScheduledActivityNotification(item);
        if (notification.skipped) {
          calendarResults.push({ id: item.activityId, skipped: true, reason: notification.reason, channels: notification.channels });
          continue;
        }

        await markCalendarActivityNotified(item.activityId);
        calendarResults.push({ id: item.activityId, sent: true, channels: notification.channels });
      } catch (error) {
        console.error("Falha ao enviar notificacao de atividade (calendar_activities).", error);
        calendarResults.push({ id: item.activityId, error: error?.message || "Falha ao enviar." });
      }
    }

    // Previsão de recebimento da comissão (Financeiro): garante a atividade "Confirmar recebimento" na
    // Agenda mesmo que ninguém abra o Financeiro, e limpa a de venda já recebida/cancelada. Idempotente.
    let expectedReceipts = null;
    try {
      expectedReceipts = await reconcileExpectedReceiptActivities();
    } catch (receiptError) {
      console.error("Falha ao reconciliar atividades de previsao de recebimento.", receiptError);
      expectedReceipts = { error: receiptError?.message || "Falha ao reconciliar." };
    }

    let automations = [];
    try {
      automations = await runCrmAutomations();
    } catch (automationError) {
      console.error("Falha ao executar automações configuráveis.", automationError);
      automations = [{ error: automationError?.message || "Falha no motor de regras." }];
    }

    // Rede de segurança do lead patrocinado (Click to WhatsApp): conversa de anúncio das últimas 24h que
    // ainda não virou cliente (falha momentânea no webhook) volta a tentar entrar na roleta. O banco
    // garante que nunca duplica.
    let sponsoredLeads = 0;
    try {
      sponsoredLeads = (await reconcileSponsoredLeads()).filter((item) => item?.created).length;
    } catch (sponsoredError) {
      console.error("Falha ao reconciliar leads patrocinados.", sponsoredError);
    }

    // Mesma rede de segurança para contato direto (sem anúncio): conversa das últimas 24h sem cliente e sem
    // ninguém atendendo entra na roleta e vira cliente.
    try {
      await reconcileOrganicLeads();
    } catch (organicError) {
      console.error("Falha ao reconciliar contatos diretos do WhatsApp.", organicError);
    }

    // Cliente do anúncio segurado com o dono (WA-18) que respondeu/preencheu mas a liberação falhou: vai para a roleta.
    try {
      await reconcileAdWaitingClients();
    } catch (adWaitingError) {
      console.error("Falha ao reconciliar clientes do anúncio aguardando.", adWaitingError);
    }

    // WhatsApp pessoal: sem card de cliente -> Particular; ganhou card -> volta (WA-26, dono 2026-10-10).
    // "Número não identificado" em bloco próprio: falha dela (ex.: marca em crm_settings) não pula o Particular automático.
    try {
      const { reconcileLidPlaceholders } = await import("@/lib/whatsapp-individual-inbound");
      await reconcileLidPlaceholders();
    } catch (lidError) {
      console.error("Falha ao reconciliar as conversas \"Número não identificado\".", lidError);
    }
    try {
      await reconcileAutoPrivateConversations();
    } catch (autoPrivateError) {
      console.error("Falha ao reconciliar o Particular automático.", autoPrivateError);
    }

    // Retorno automático de 7 dias da Prospecção (dono, 2026-10-22: saiu das leituras de tela, pode atrasar até 2 min).
    // Antes da rede de segurança abaixo, que entrega ao dono no mesmo ciclo quem foi devolvido (FUN-11). Com trava.
    let prospectingAutoReturn = null;
    try {
      prospectingAutoReturn = await runProspectingAutoReturnJob();
    } catch (autoReturnError) {
      console.error("Falha no retorno automático da Prospecção.", autoReturnError);
      prospectingAutoReturn = { error: autoReturnError?.message || "Falha no retorno automático." };
    }

    // Fila de espera da roleta (regra do dono, 2026-09-30): distribui pro
    // primeiro corretor on-line quem ficou sem responsável porque, na hora
    // da criação, ninguém estava on-line. Roda ANTES da rede de segurança
    // abaixo, que já ignora quem está nessa fila de propósito.
    let pendingRouletteAssignment = { assigned: 0 };
    try {
      pendingRouletteAssignment = await reassignPendingRouletteLeads();
    } catch (pendingError) {
      console.error("Falha ao reconciliar a fila de espera da roleta.", pendingError);
      pendingRouletteAssignment = { error: pendingError?.message || "Falha ao reconciliar." };
    }

    // Fila de reativação dos clientes transferidos pelo FUN-15 (FUN-15l, dono 2026-10-17): toda rodada (prazo de 3 min),
    // só com o liga/desliga `cooled_clients_flow` LIGADO. Depois da fila comum; nunca derruba o resto do cron.
    let cooledReactivation = null;
    try {
      const { runCooledReactivationQueue } = await import("@/lib/cooled-clients-reactivation");
      cooledReactivation = await runCooledReactivationQueue();
    } catch (reactivationError) {
      console.error("Falha na fila de reativação dos clientes transferidos.", reactivationError);
      cooledReactivation = { error: reactivationError?.message || "Falha na fila de reativação." };
    }

    // Chat do Marketplace (MKT-2e, dono 2026-10-22): fila de espera + troca de corretor quando a conversa da roleta fica
    // sem resposta no prazo da roleta. Antes só rodava quando a extensão sincronizava. Grava o sinal do job (monitorado
    // pelo cron whatsapp-flows); nunca derruba o resto do cron.
    let marketplaceRedistribution = null;
    try {
      const { runMarketplaceRedistributionJob } = await import("@/lib/marketplace-chat");
      marketplaceRedistribution = await runMarketplaceRedistributionJob();
    } catch (marketplaceError) {
      console.error("Falha na redistribuição do Chat do Marketplace.", marketplaceError);
      marketplaceRedistribution = { error: marketplaceError?.message || "Falha na redistribuição do Marketplace." };
    }

    // Rede de segurança da regra "nenhum cliente sem responsável": pega
    // qualquer registro que tenha ficado com responsible_user_id nulo por
    // qualquer caminho (não só o de exclusão de corretor, já tratado na hora)
    // e devolve ao administrador principal.
    let orphanReassignment = { reassigned: 0 };
    try {
      orphanReassignment = await reassignOrphanedClientsToOwner();
    } catch (orphanError) {
      console.error("Falha ao reatribuir clientes sem responsável.", orphanError);
      orphanReassignment = { error: orphanError?.message || "Falha ao reatribuir." };
    }

    // Limpeza de fotos órfãs do upload público de captação — no máximo 1 vez
    // por dia (lib/captacao-upload-cleanup.js). Falha aqui nunca derruba o
    // resto do cron.
    let captacaoUploadCleanup = null;
    try {
      captacaoUploadCleanup = await runCaptacaoUploadCleanupIfDue();
    } catch (cleanupError) {
      console.error("Falha na limpeza de fotos órfãs da captação.", cleanupError);
      captacaoUploadCleanup = { error: cleanupError?.message || "Falha na limpeza." };
    }

    // Rotina "Chegada ao escritório" da Alexa: se o iPhone avisou a chegada e o
    // atraso já passou, monta o resumo e fala. Nunca derruba o resto do cron.
    try {
      await processDueArrival();
    } catch (arrivalError) {
      console.error("Falha na rotina de chegada da Alexa.", arrivalError?.name || arrivalError);
    }

    // Fluxo de clientes que esfriaram (dono, 2026-10-16): só com o liga/desliga LIGADO (crm_settings
    // `cooled_clients_flow`, nasce desligado) e no máximo a cada 10 min. Nunca derruba o resto do cron.
    let cooledClients = null;
    try {
      cooledClients = await runCooledClientsFlow();
    } catch (cooledError) {
      console.error("Falha no fluxo de clientes que esfriaram.", cooledError);
      cooledClients = { error: cooledError?.message || "Falha no fluxo." };
    }

    // Bônus "Primeiro a chegar"/"Último a sair" da imobiliária (RAN-10, dono 2026-10-23): decide uma vez por dia e tipo,
    // sem aviso/push. Nunca derruba o resto do cron.
    let officePresenceBonus = null;
    try {
      const { runOfficePresenceBonus } = await import("@/lib/office-presence-bonus");
      officePresenceBonus = await runOfficePresenceBonus();
    } catch (bonusError) {
      console.error("Falha no bônus de presença na imobiliária.", bonusError);
      officePresenceBonus = { error: bonusError?.message || "Falha no bônus de presença." };
    }

    const allResults = [...results, ...calendarResults];
    return NextResponse.json({
      ok: true,
      checked: dueRegistrations.length + dueCalendarActivities.length,
      sent: allResults.filter((item) => item.sent).length,
      skipped: allResults.filter((item) => item.skipped).length,
      failed: allResults.filter((item) => item.error).length,
      results: allResults,
      automations,
      expectedReceipts,
      sponsoredLeads,
      prospectingAutoReturn,
      pendingRouletteAssignment,
      cooledReactivation,
      marketplaceRedistribution,
      orphanReassignment,
      captacaoUploadCleanup,
      cooledClients,
      officePresenceBonus
    });
  } catch (error) {
    console.error("Falha ao verificar atividades agendadas.", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 500 });
  }
}
