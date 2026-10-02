import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { applyResponsibleUserScope } from "@/lib/admin-access";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { CLIENT_STATUS } from "@/lib/client-status";
import { getUnattendedClientIds } from "@/lib/simulation-list-query";
import { countOpenProspectingReplies } from "@/lib/prospecting-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getSupabaseAdminClient();
    const now = new Date().toISOString();
    // A Agenda exibe somente as atividades do perfil atual; o legado e o
    // calendário novo têm registros diferentes e cada atividade vale uma vez.
    const [unattendedIds, awaitingSimulation, legacy, calendar, prospectingReplies] = await Promise.all([
      getUnattendedClientIds(auth),
      applyResponsibleUserScope(db.from("simulation_registrations")
        .select("id", { count: "exact", head: true })
        .eq("status", CLIENT_STATUS.PENDING), auth),
      db.from("simulation_registrations").select("id", { count: "exact", head: true })
        .eq("responsible_user_id", auth.profile.id)
        .not("scheduled_activity_at", "is", null)
        .is("scheduled_activity_completed_at", null)
        .lt("scheduled_activity_at", now)
        .neq("status", CLIENT_STATUS.ARCHIVED)
        .neq("status", CLIENT_STATUS.DO_NOT_CONTACT),
      db.from("calendar_activities").select("id", { count: "exact", head: true })
        .eq("responsible_user_id", auth.profile.id)
        .eq("status", "pending")
        .lt("scheduled_at", now),
      // "Respostas da prospecção" — nunca derruba os demais contadores.
      countOpenProspectingReplies(auth).catch((error) => {
        console.warn("Falha ao contar respostas da prospecção:", error?.message || error);
        return 0;
      })
    ]);
    for (const result of [awaitingSimulation, legacy, calendar]) if (result.error) throw result.error;
    const firstContact = unattendedIds.length;
    const simulation = awaitingSimulation.count || 0;
    return NextResponse.json({ clients: firstContact + simulation, newAttendances: firstContact, awaitingSimulation: simulation, agenda: (legacy.count || 0) + (calendar.count || 0), prospectingReplies });
  } catch (error) {
    console.error("Erro ao contar pendências do CRM:", error);
    return NextResponse.json({ error: "Não foi possível contar as pendências." }, { status: 500 });
  }
}
