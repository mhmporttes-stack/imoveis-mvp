import { NextResponse } from "next/server";
import {
  formatSimulationRegistrationError,
  listDueScheduledActivityNotifications,
  markScheduledActivityNotificationSent
} from "@/lib/simulation-registrations";
import { sendScheduledActivityNotification } from "@/lib/scheduled-activity-notifications";
import { runCrmAutomations } from "@/lib/crm-automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";

  if (!secret || authorization !== `Bearer ${secret}`) {
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

    let automations = [];
    try {
      automations = await runCrmAutomations();
    } catch (automationError) {
      console.error("Falha ao executar automações configuráveis.", automationError);
      automations = [{ error: automationError?.message || "Falha no motor de regras." }];
    }

    return NextResponse.json({
      ok: true,
      checked: dueRegistrations.length,
      sent: results.filter((item) => item.sent).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error).length,
      results,
      automations
    });
  } catch (error) {
    console.error("Falha ao verificar atividades agendadas.", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 500 });
  }
}
