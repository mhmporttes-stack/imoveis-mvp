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
import { reassignPendingRouletteLeads } from "@/lib/lead-distribution";
import { runCaptacaoUploadCleanupIfDue } from "@/lib/captacao-upload-cleanup";
import { processDueArrival } from "@/lib/alexa-arrival";
import { reconcileExpectedReceiptActivities } from "@/lib/financial";

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
      pendingRouletteAssignment,
      orphanReassignment,
      captacaoUploadCleanup
    });
  } catch (error) {
    console.error("Falha ao verificar atividades agendadas.", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 500 });
  }
}
