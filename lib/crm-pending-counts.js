import "server-only";
import { applyResponsibleUserScope } from "./admin-access";
import { getSupabaseAdminClient } from "./supabase";
import { AWAITING_SIMULATION_STATUS_VALUES, CLIENT_STATUS } from "./client-status";
import { getUnattendedClientIds } from "./simulation-list-query";
import { countOpenProspectingReplies } from "./prospecting-reply";

// "Agenda atrasada": atividade antiga do cadastro (scheduled_activity_at, fora de arquivado/Não contactar) e atividade
// pendente do calendário novo, já vencidas. Filtros únicos — usados pelo contador do perfil e pela visão por corretor.
function overdueLegacyActivities(query, nowIso) {
  return query
    .not("scheduled_activity_at", "is", null)
    .is("scheduled_activity_completed_at", null)
    .lt("scheduled_activity_at", nowIso)
    .neq("status", CLIENT_STATUS.ARCHIVED)
    .neq("status", CLIENT_STATUS.DO_NOT_CONTACT);
}

function overdueCalendarActivities(query, nowIso) {
  return query.eq("status", "pending").lt("scheduled_at", nowIso);
}

// Atividades atrasadas por responsável (Início do dono, INI-5): a MESMA conta do contador "Agenda" de cada pessoa,
// para os ids pedidos, em 2 consultas (sem uma por corretor). Devolve Map responsável -> quantidade.
export async function countOverdueActivitiesByResponsible(userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return result;
  const db = getSupabaseAdminClient();
  const now = new Date().toISOString();
  // Lê em páginas de 1000 (limite por resposta do Supabase): nunca conta a menos.
  const readAll = async (build) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build().order("id", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  };
  const [legacy, calendar] = await Promise.all([
    readAll(() => overdueLegacyActivities(db.from("simulation_registrations").select("id, responsible_user_id"), now).in("responsible_user_id", ids)),
    readAll(() => overdueCalendarActivities(db.from("calendar_activities").select("id, responsible_user_id"), now).in("responsible_user_id", ids))
  ]);
  for (const row of [...legacy, ...calendar]) result.set(row.responsible_user_id, (result.get(row.responsible_user_id) || 0) + 1);
  return result;
}

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
    overdueLegacyActivities(db.from("simulation_registrations").select("id", { count: "exact", head: true }), now)
      .eq("responsible_user_id", auth.profile.id),
    overdueCalendarActivities(db.from("calendar_activities").select("id", { count: "exact", head: true }), now)
      .eq("responsible_user_id", auth.profile.id),
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
