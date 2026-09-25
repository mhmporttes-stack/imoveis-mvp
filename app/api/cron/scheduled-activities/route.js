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
import { reconcileOrganicLeads, reconcileSponsoredLeads } from "@/lib/whatsapp-sponsored-lead";

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

    const allResults = [...results, ...calendarResults];
    return NextResponse.json({
      ok: true,
      checked: dueRegistrations.length + dueCalendarActivities.length,
      sent: allResults.filter((item) => item.sent).length,
      skipped: allResults.filter((item) => item.skipped).length,
      failed: allResults.filter((item) => item.error).length,
      results: allResults,
      automations,
      sponsoredLeads,
      orphanReassignment
    });
  } catch (error) {
    console.error("Falha ao verificar atividades agendadas.", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 500 });
  }
}
