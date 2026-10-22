import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import { listAdminProfiles } from "./admin-profiles";
import { clientStatusLabel } from "./client-status";
import { getPerformanceOverview } from "./performance-overview";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { zonedPlainDateToUtcIso, addDaysToPlainDate } from "./daily-report";
import { readOverview } from "./crm-metrics/overview";
import { readTeamGoal } from "./crm-metrics/team-goal";
import { slimOverview } from "./crm-metrics/overview-core.mjs";
import { slimTeamGoal } from "./crm-metrics/team-goal-core.mjs";
import { leadOriginBreakdown } from "./painel-inicio-core.mjs";
import { buildHenryClientSearch, sanitizeClientSearchTerm } from "./henry-reports-core.mjs";

// Leituras do Henry para períodos longos (pedido do dono, 2026-10-22 — HENRY-1). SOMENTE LEITURA e sempre pelas MESMAS
// funções das telas: Desempenho/Ranking/Funil = getPerformanceOverview; Meta Diária da equipe = getOwnerTeamDailyOverview;
// leads por origem = leadOriginBreakdown do Início. Períodos que o CRM já pré-calcula (hoje, ontem, esta semana, semana
// passada, este mês, mês passado — crm_metric_cache) saem do cache quando ele está em dia; os demais são calculados na
// hora, como a tela faz com o filtro de datas. O cache curto (45 s) fica em henry-voice.js (createHenryReadCache).

const CACHED_PERIODS = new Set(["hoje", "ontem", "esta_semana", "semana_passada", "este_mes", "mes_passado"]);

function screenParams(range) {
  if (range.id === "hoje") return { period: "today" };
  if (range.id === "ontem") return { period: "yesterday" };
  return { period: "custom", startDate: range.startDate, endDate: range.endDate };
}

function sameRange(payload, range) {
  return payload?.range?.startDate === range.startDate && payload?.range?.endDate === range.endDate;
}

// Desempenho do período (slimOverview: funil, equipe, ranking, atenção).
export async function loadHenryOverview(auth, range) {
  if (CACHED_PERIODS.has(range.id)) {
    const entry = await readOverview(range.id).catch(() => null);
    if (entry && !entry.staleMinutes && sameRange(entry.payload, range)) return entry.payload;
  }
  return slimOverview(await getPerformanceOverview(screenParams(range), auth));
}

// Meta Diária da equipe no período (slimTeamGoal: % da equipe e de cada corretor = realizadas ÷ previstas).
export async function loadHenryTeamGoal(auth, range) {
  if (CACHED_PERIODS.has(range.id)) {
    const entry = await readTeamGoal(range.id).catch(() => null);
    if (entry && !entry.staleMinutes && sameRange(entry.payload, range)) return entry.payload;
  }
  return slimTeamGoal(await getOwnerTeamDailyOverview(screenParams(range), auth));
}

// Leads (cadastros novos) do período por origem, no escopo de quem pergunta (o dono = todos). Paginado: período longo
// pode passar das 1.000 linhas de uma consulta.
const LEADS_PAGE = 1000;
const LEADS_MAX_PAGES = 20;
export async function loadHenryLeadOrigins(auth, range) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const startIso = zonedPlainDateToUtcIso(range.startDate);
  const endIso = zonedPlainDateToUtcIso(addDaysToPlainDate(range.endDate, 1));
  const rows = [];
  for (let page = 0; page < LEADS_MAX_PAGES; page += 1) {
    const { data, error } = await applyResponsibleUserScope(
      supabase.from("simulation_registrations").select("id, acquisition_context").gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }),
      auth
    ).range(page * LEADS_PAGE, page * LEADS_PAGE + LEADS_PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < LEADS_PAGE) break;
  }
  return leadOriginBreakdown(rows);
}

// Foto e primeiro nome dos corretores (a mesma photo_url que o painel já mostra) para o cardzinho da cena.
export async function loadHenryBrokerCards() {
  const profiles = await listAdminProfiles();
  return new Map(profiles.filter((profile) => profile.id).map((profile) => [profile.id, { id: profile.id, name: profile.name || "", photoUrl: profile.photoUrl || "", gender: profile.gender || "" }]));
}

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
function describeDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  const when = days <= 0 ? (time > Date.now() ? "" : "hoje") : days === 1 ? "ontem" : `há ${days} dias`;
  return when ? `${DATE_FORMAT.format(new Date(time))} (${when})` : DATE_FORMAT.format(new Date(time));
}

// Cliente por nome: etapa, responsável, último contato, próxima atividade. Nunca CPF/documento; telefone só com
// withPhone. Mesmo filtro da lista de Clientes: escopo do perfil e sem contatos Particulares.
export async function searchHenryClients(auth, rawTerm, { withPhone = false } = {}) {
  const term = sanitizeClientSearchTerm(rawTerm);
  if (term.length < 2) return buildHenryClientSearch({ term: String(rawTerm || "").slice(0, 40), rows: [] });
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const columns = `id, full_name, status, responsible_user_id, last_whatsapp_contact_at, last_status_change_at, scheduled_activity_at, scheduled_activity_completed_at${withPhone ? ", phone" : ""}`;
  const [{ data, error }, cards] = await Promise.all([
    applyResponsibleUserScope(supabase.from("simulation_registrations").select(columns).is("private_contact_at", null).ilike("full_name", `%${term}%`), auth)
      .order("last_status_change_at", { ascending: false, nullsFirst: false })
      .limit(8),
    loadHenryBrokerCards().catch(() => new Map())
  ]);
  if (error) throw error;
  return buildHenryClientSearch({
    term,
    rows: data || [],
    statusLabel: clientStatusLabel,
    brokerName: (id) => cards.get(id)?.name || "",
    formatDate: describeDate,
    withPhone
  });
}
