import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  formatSimulationRegistrationError,
  listDueScheduledActivityNotifications,
  markScheduledActivityNotificationSent
} from "@/lib/simulation-registrations";
import { listDueCalendarActivityNotifications, markCalendarActivityNotified } from "@/lib/calendar-activities";
import { sendScheduledActivityNotification } from "@/lib/scheduled-activity-notifications";
import { runCrmAutomations } from "@/lib/crm-automations";

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

    const allResults = [...results, ...calendarResults];
    return NextResponse.json({
      ok: true,
      checked: dueRegistrations.length + dueCalendarActivities.length,
      sent: allResults.filter((item) => item.sent).length,
      skipped: allResults.filter((item) => item.skipped).length,
      failed: allResults.filter((item) => item.error).length,
      results: allResults,
      automations
    });
  } catch (error) {
    console.error("Falha ao verificar atividades agendadas.", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 500 });
  }
}
