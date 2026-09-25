// Monta os guias iniciais (Prospecção, Lead, Orgânico e Banco de Objeções) a partir dos "specs" de conteúdo.
// Os ids dos guias são FIXOS: os cards "ref" dos fluxos apontam para o Banco de Objeções pelo id dele, e a
// migration de seed (supabase/migrations/…_attendance_guides_seed.sql) é gerada por scripts/build-attendance-guide-seed-sql.mjs.
import { START_NODE_ID } from "./attendance-guide-core.mjs";
import { autoArrangeGuide } from "./attendance-guide-layout.mjs";
import { LIBRARY_SPEC } from "./attendance-guide-seed-library.mjs";
import { LEAD_SPEC, ORGANIC_SPEC, PROSPECTING_SPEC } from "./attendance-guide-seed-flows.mjs";

export const SEED_IDS = {
  library: "5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b01",
  prospecting: "5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b02",
  lead: "5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b03",
  organic: "5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b04"
};

function strip(target) {
  return String(target).replace(/^@/, "");
}

// spec -> grafo. Primeiro card do spec = destino do "Começar".
function buildGraph(spec, { libraryId = SEED_IDS.library, isLibrary = false } = {}) {
  const nodes = [{ id: START_NODE_ID, type: "start", x: 0, y: 0, data: {} }];
  const edges = [];
  const link = (from, port, to) => edges.push({ id: `e-${from}-${port}-${strip(to)}`, from, port, to: strip(to) });

  for (const item of spec) {
    if (item.type === "ref") {
      nodes.push({ id: item.id, type: "ref", x: 0, y: 0, data: { guideId: libraryId, nodeId: item.entry, label: item.label || "" } });
      if (item.next) link(item.id, "next", item.next);
    } else if (item.type === "followup") {
      nodes.push({ id: item.id, type: "followup", x: 0, y: 0, data: { title: item.title, guidance: item.guidance || "", message: item.message || "", defaultDays: item.defaultDays ?? 1, activityType: "follow_up" } });
    } else if (item.type === "end") {
      nodes.push({ id: item.id, type: "end", x: 0, y: 0, data: { title: item.title, guidance: item.guidance || "", outcome: item.outcome || "" } });
    } else if (item.type === "return") {
      nodes.push({ id: item.id, type: "return", x: 0, y: 0, data: {} });
    } else {
      const options = (item.options || []).map(([label], index) => ({ id: `${item.id}~${index + 1}`, label }));
      nodes.push({
        id: item.id, type: "card", x: 0, y: 0,
        data: { title: item.title, phase: item.phase || "investigar", guidance: item.guidance || "", argument: item.argument || "", message: item.message || "", entry: item.entry === true, options }
      });
      (item.options || []).forEach(([, target], index) => link(item.id, `${item.id}~${index + 1}`, target));
    }
  }
  if (!isLibrary) link(START_NODE_ID, "next", spec[0].id);
  return autoArrangeGuide({ nodes, edges });
}

export function buildSeedGuides() {
  return [
    {
      id: SEED_IDS.prospecting, slug: "prospeccao", kind: "prospecting", sortOrder: 10,
      name: "Prospecção — reativação de cliente antigo",
      description: "Abertura com cliente antigo, descoberta do motivo de não ter comprado e caminho para a documentação.",
      graph: buildGraph(PROSPECTING_SPEC)
    },
    {
      id: SEED_IDS.lead, slug: "lead", kind: "lead", sortOrder: 20,
      name: "Lead — patrocinado / lead novo",
      description: "Fluxo direto: recepção → interesse → necessidade → simulação → objeções → documentação.",
      graph: buildGraph(LEAD_SPEC)
    },
    {
      id: SEED_IDS.organic, slug: "organico", kind: "organic", sortOrder: 30,
      name: "Orgânico — Instagram, indicação, WhatsApp e contato espontâneo",
      description: "Origem → interesse → necessidade → situação atual → simulação → objeções → documentação.",
      graph: buildGraph(ORGANIC_SPEC)
    },
    {
      id: SEED_IDS.library, slug: "banco-de-objecoes", kind: "library", sortOrder: 90,
      name: "Banco de objeções",
      description: "Objeções e argumentações reutilizáveis: investigar, achar o motivo real, solucionar, testar aceitação e definir retorno.",
      graph: buildGraph(LIBRARY_SPEC, { isLibrary: true })
    }
  ];
}
