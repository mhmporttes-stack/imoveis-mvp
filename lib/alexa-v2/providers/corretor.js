import "server-only";
import { addDaysToPlainDate, zonedPlainDateToUtcIso } from "../../daily-report";
import { saoPauloDateKey } from "../../alexa-config-core.mjs";
import { readOverview } from "../../crm-metrics/overview";
import { readTeamGoal } from "../../crm-metrics/team-goal";
import { agendaProvider, countActivities } from "./agenda";
import { presencaProvider } from "./presenca";
import { deriveCorretor } from "./corretor-core.mjs";

// Provedor das consultas POR CORRETOR (e da equipe): lê o cache do Desempenho
// e da Meta Diária (mesmas funções das telas) e, só quando preciso, uma ou duas
// consultas leves de agenda. Nunca calcula métrica própria.
const META_ONLY = new Set(["meta_corretor", "meta_bateu", "prospeccao_faltam"]); // só a Meta Diária
const AGENDA_ONLY = new Set(["compromissos", "quem_reuniao"]); // só a Agenda
const WITH_GOAL = new Set(["corretor_resumo", "equipe_resumo", "comparar"]); // Desempenho + Meta (hoje/ontem)

const safe = async (task, fallback = null) => {
  try {
    return await task();
  } catch {
    return fallback;
  }
};

export async function corretorProvider(q) {
  const goalPeriod = q.periodo === "hoje" || q.periodo === "ontem";
  const needsGoal = META_ONLY.has(q.topic) || (goalPeriod && WITH_GOAL.has(q.topic));
  const needsOverview = !AGENDA_ONLY.has(q.topic);

  const [overviewEntry, goalEntry] = await Promise.all([needsOverview ? readOverview(q.periodo) : null, needsGoal ? readTeamGoal(q.periodo) : null]);
  if (META_ONLY.has(q.topic) ? !goalEntry : needsOverview && !overviewEntry) return null;

  const src = {
    overview: overviewEntry?.payload || { team: [], ranking: [], metrics: {}, funnel: {}, attention: {} },
    goal: goalEntry?.payload || null
  };

  if (q.topic === "corretor_resumo" && q.periodo === "hoje") {
    const agenda = await safe(() => agendaProvider({ topic: "agenda", periodo: "hoje", corretorId: q.corretorId }));
    src.meetings = agenda ? agenda.count : null;
  }
  if (AGENDA_ONLY.has(q.topic)) {
    if (q.topic === "compromissos") {
      const today = saoPauloDateKey();
      const day = q.periodo === "amanha" ? addDaysToPlainDate(today, 1) : today;
      src.compromissos = await countActivities({
        fromIso: zonedPlainDateToUtcIso(day),
        toIso: zonedPlainDateToUtcIso(addDaysToPlainDate(day, 1)),
        brokerId: q.corretorId || ""
      });
    } else {
      const agenda = await agendaProvider({ topic: "agenda", periodo: q.periodo });
      src.agendaItems = agenda.items || [];
    }
  }
  if (q.topic === "equipe_resumo") {
    const presence = await safe(() => presencaProvider());
    src.online = presence ? presence.count : null;
  }

  const data = deriveCorretor(q, src);
  if (!data) return null;
  const staleMinutes = Math.max(overviewEntry?.staleMinutes || 0, goalEntry?.staleMinutes || 0);
  return staleMinutes ? { ...data, staleMinutes } : data;
}
