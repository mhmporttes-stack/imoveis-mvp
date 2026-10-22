import "server-only";
import { applyResponsibleUserScope } from "./admin-access";
import { getSupabaseAdminClient } from "./supabase";
import { AWAITING_SIMULATION_STATUS_VALUES, CLIENT_STATUS } from "./client-status";
import { getUnattendedClientIds } from "./simulation-list-query";
import { countOpenProspectingReplies } from "./prospecting-reply";

// Contadores de pendências do CRM (Novos atendimentos, Aguardando simulação, Agenda atrasada, Respostas da prospecção)
// — fonte única do balão "Pendências" do cabeçalho (/api/admin/crm-badge-counts) e da tela Início. O número do Chat
// não mora aqui: vem do resumo do Chat (getChatSummary).
export async function getCrmPendingCounts(auth) {
  const db = getSupabaseAdminClient();
  const now = new Date().toISOString();
  // A Agenda exibe somente as atividades do perfil atual; o legado e o
  // calendário novo têm registros diferentes e cada atividade vale uma vez.
  const [unattendedIds, awaitingSimulation, legacy, calendar, prospectingReplies] = await Promise.all([
    getUnattendedClientIds(auth),
    applyResponsibleUserScope(db.from("simulation_registrations")
      .select("id", { count: "exact", head: true })
      .in("status", AWAITING_SIMULATION_STATUS_VALUES), auth),
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
  return { clients: firstContact + simulation, newAttendances: firstContact, awaitingSimulation: simulation, agenda: (legacy.count || 0) + (calendar.count || 0), prospectingReplies };
}
