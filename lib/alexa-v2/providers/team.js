import "server-only";
import { deriveMeta, derivePendencias, deriveProspeccao } from "../../crm-metrics/team-goal-core.mjs";
import { readPendencias, readTeamGoal } from "../../crm-metrics/team-goal";
import { readSnapshots } from "../../crm-metrics/snapshots";
import { pendenciasFromSnapshot } from "../../crm-metrics/snapshot-rows-core.mjs";

// Provedores de equipe (Meta, Prospecção, Pendências). Só LEEM o cache já
// calculado (nunca contas pesadas). Dado fora da janela vira aviso curto
// (staleMinutes); sem dado nenhum devolve null (a voz usa o fallback).
function withStale(view, staleMinutes) {
  if (!view) return null;
  return staleMinutes ? { ...view, staleMinutes } : view;
}

export async function metaProvider(q) {
  const entry = await readTeamGoal(q.periodo);
  if (!entry) return null;
  return withStale(deriveMeta(entry.payload, q.topic, q.corretor), entry.staleMinutes);
}

export async function prospeccaoProvider(q) {
  const entry = await readTeamGoal(q.periodo);
  if (!entry) return null;
  return withStale(deriveProspeccao(entry.payload, q.topic, q.corretor), entry.staleMinutes);
}

export async function pendenciasProvider(q) {
  if (q.periodo === "ontem") {
    if (q.kind === "list" && q.topic === "pendencias") return { unavailable: "historico" };
    const rows = await readSnapshots({ date: q.range.startDate, metric: "pendencias_total" });
    return pendenciasFromSnapshot(rows, q.topic) || { unavailable: "historico" };
  }
  if (q.periodo !== "hoje") return { unavailable: "historico" };
  const entry = await readPendencias();
  if (!entry) return null;
  return withStale(derivePendencias(entry.payload, q.topic), entry.staleMinutes);
}
