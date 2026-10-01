import "server-only";
import { getSupabaseAdminClient } from "../../supabase";
import { CLIENT_STATUS } from "../../client-status";
import { addDaysToPlainDate, zonedPlainDateToUtcIso } from "../../daily-report";
import { saoPauloDateKey } from "../../alexa-config-core.mjs";
import { agendaRange, buildMeetingItems, nextMeeting } from "./agenda-core.mjs";

// Reuniões do ESCRITÓRIO (todos os corretores). Mesmas duas fontes que a
// Agenda do CRM junta: calendar_activities e o campo legado de
// simulation_registrations. Reunião = tipo que começa com "reuni", pendente.
const CHUNK = 150;

async function loadMeetingRows(supabase, fromIso, toIso) {
  const [calendar, legacy] = await Promise.all([
    supabase
      .from("calendar_activities")
      .select("scheduled_at, client_id, responsible_user_id")
      .eq("status", "pending")
      .ilike("activity_type", "reuni%")
      .gte("scheduled_at", fromIso)
      .lt("scheduled_at", toIso)
      .order("scheduled_at", { ascending: true })
      .limit(300),
    supabase
      .from("simulation_registrations")
      .select("id, full_name, scheduled_activity_at, responsible_user_id, status")
      .ilike("scheduled_activity_type", "reuni%")
      .is("scheduled_activity_completed_at", null)
      .gte("scheduled_activity_at", fromIso)
      .lt("scheduled_activity_at", toIso)
      .order("scheduled_activity_at", { ascending: true })
      .limit(300)
  ]);
  if (calendar.error) throw calendar.error;
  if (legacy.error) throw legacy.error;

  const calendarRows = calendar.data || [];
  const clientIds = [...new Set(calendarRows.map((row) => row.client_id).filter(Boolean))];
  const clientNames = new Map();
  for (let index = 0; index < clientIds.length; index += CHUNK) {
    const { data, error } = await supabase.from("simulation_registrations").select("id, full_name").in("id", clientIds.slice(index, index + CHUNK));
    if (error) throw error;
    for (const row of data || []) clientNames.set(row.id, row.full_name);
  }

  const rows = [
    ...calendarRows.map((row) => ({ at: row.scheduled_at, clientId: row.client_id, clientName: clientNames.get(row.client_id) || "", brokerId: row.responsible_user_id })),
    ...(legacy.data || [])
      .filter((row) => ![CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT].includes(row.status))
      .map((row) => ({ at: row.scheduled_activity_at, clientId: row.id, clientName: row.full_name, brokerId: row.responsible_user_id }))
  ];

  const brokerIds = [...new Set(rows.map((row) => row.brokerId).filter(Boolean))];
  const brokerNames = new Map();
  if (brokerIds.length) {
    const { data, error } = await supabase.from("admin_users").select("id, name").in("id", brokerIds);
    if (error) throw error;
    for (const row of data || []) brokerNames.set(row.id, row.name);
  }
  return { rows, brokerNames };
}

// Atividades pendentes (qualquer tipo) de um dia: mesmas duas fontes da Agenda.
export async function countActivities({ fromIso, toIso, brokerId = "" }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");
  let calendar = supabase.from("calendar_activities").select("id", { count: "exact", head: true }).eq("status", "pending").gte("scheduled_at", fromIso).lt("scheduled_at", toIso);
  let legacy = supabase
    .from("simulation_registrations")
    .select("id", { count: "exact", head: true })
    .not("scheduled_activity_at", "is", null)
    .is("scheduled_activity_completed_at", null)
    .not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`)
    .gte("scheduled_activity_at", fromIso)
    .lt("scheduled_activity_at", toIso);
  if (brokerId) {
    calendar = calendar.eq("responsible_user_id", brokerId);
    legacy = legacy.eq("responsible_user_id", brokerId);
  }
  const [a, b] = await Promise.all([calendar, legacy]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return (a.count || 0) + (b.count || 0);
}

// Filtra as linhas pelo corretor quando a pergunta é de um corretor específico.
const onlyBroker = (rows, q) => (q.corretorId ? rows.filter((row) => row.brokerId === q.corretorId) : rows);

export async function agendaProvider(q) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");
  const today = saoPauloDateKey();
  const now = new Date();

  if (q.topic === "reunioes_atrasadas") {
    const from = new Date(now.getTime() - 60 * 86400000).toISOString();
    const { rows } = await loadMeetingRows(supabase, from, now.toISOString());
    return { count: buildMeetingItems(onlyBroker(rows, q), { today }).length };
  }

  if (q.topic === "proxima_reuniao") {
    const to = new Date(now.getTime() + 14 * 86400000).toISOString();
    const { rows, brokerNames } = await loadMeetingRows(supabase, now.toISOString(), to);
    const next = nextMeeting(buildMeetingItems(onlyBroker(rows, q), { today, brokerNames }), now);
    return next || { when: null };
  }

  const range = agendaRange(q.periodo, today);
  const fromIso = zonedPlainDateToUtcIso(range.startDate);
  const toIso = zonedPlainDateToUtcIso(addDaysToPlainDate(range.endDate, 1));
  const { rows, brokerNames } = await loadMeetingRows(supabase, fromIso, toIso);
  const items = buildMeetingItems(onlyBroker(rows, q), { today, brokerNames });
  return { count: items.length, items };
}
