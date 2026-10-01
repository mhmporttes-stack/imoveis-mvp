import "server-only";
import { CLIENT_STATUS } from "../../client-status";
import { composeArrivalSummary, firstName, saoPauloNow } from "../../alexa-config-core.mjs";
import { fetchStatusCounts } from "../../crm-metrics/funnel-stock";
import { getOwnerAuth } from "../../crm-metrics/owner-auth";
import { readOverview } from "../../crm-metrics/overview";
import { readPendencias, readTeamGoal } from "../../crm-metrics/team-goal";
import { deriveMeta } from "../../crm-metrics/team-goal-core.mjs";
import { plural } from "../text.mjs";
import { agendaProvider } from "./agenda";
import { atendimentoProvider } from "./atendimento";

// Resumo do dia e "o que precisa de atenção": só COMPÕEM o que os outros
// provedores já leem (cache e consultas leves). O texto do resumo usa o mesmo
// compositor da rotina de chegada (composeArrivalSummary), mas SEM chamar a
// Meta da Equipe ao vivo — lê o cache.
export async function resumoProvider(q) {
  if (q.topic === "atencao") return atencao();

  const auth = await getOwnerAuth();
  const [counts, agenda, meta, overview] = await Promise.all([
    fetchStatusCounts(),
    agendaProvider({ topic: "agenda", periodo: "hoje" }),
    readTeamGoal("hoje"),
    readOverview("hoje")
  ]);

  const now = new Date();
  const upcoming = (agenda.items || []).find((item) => new Date(item.at) >= now);
  const hitters = meta ? deriveMeta(meta.payload, "meta_bateram").items.map((item) => item.name) : [];

  const text = composeArrivalSummary({
    name: firstName(auth.profile?.name),
    minutesOfDay: saoPauloNow(now).minutes,
    agenda: { count: agenda.count || 0, nextTime: upcoming ? { h: upcoming.hours, m: upcoming.minutes } : null },
    awaitingSimulation: counts.byStatus[CLIENT_STATUS.PENDING] || 0,
    documentsPending: (counts.byStatus[CLIENT_STATUS.DOCUMENTATION] || 0) + (counts.byStatus[CLIENT_STATUS.DOCUMENTS_PENDING] || 0),
    awaitingApproval: counts.byStatus[CLIENT_STATUS.APPROVAL_PENDING] || 0,
    goalDoneNames: hitters,
    salesToday: overview?.payload?.metrics?.sale || 0
  });
  return { text };
}

async function atencao() {
  const settle = async (task, fallback) => {
    try {
      return await task();
    } catch {
      return fallback;
    }
  };
  const [unattended, roulette, overdue, pendencias] = await Promise.all([
    settle(() => atendimentoProvider({ topic: "sem_atendimento", kind: "count" }), { count: 0 }),
    settle(() => atendimentoProvider({ topic: "fila_roleta", kind: "count" }), { count: 0 }),
    settle(() => agendaProvider({ topic: "reunioes_atrasadas", periodo: "hoje" }), { count: 0 }),
    settle(() => readPendencias(), null)
  ]);
  const pendingTotal = (pendencias?.payload?.brokers || []).reduce((sum, broker) => sum + broker.remaining, 0);

  const items = [];
  if (unattended.count > 0) items.push(plural(unattended.count, "cliente sem atendimento humano", "clientes sem atendimento humano"));
  if (roulette.count > 0) items.push(plural(roulette.count, "cliente na fila da roleta", "clientes na fila da roleta"));
  if (overdue.count > 0) items.push(plural(overdue.count, "reunião atrasada", "reuniões atrasadas"));
  if (pendingTotal > 0) items.push(plural(pendingTotal, "pendência", "pendências"));
  return { items };
}
