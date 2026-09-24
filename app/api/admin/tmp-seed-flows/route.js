import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { buildFlowFromTemplate } from "@/components/flows/flow-templates";
import { createWhatsappFlow, listWhatsappFlows } from "@/lib/whatsapp-flows";
import { validateGraph, validateTrigger } from "@/lib/whatsapp-flow-core.mjs";

export const runtime = "nodejs";

// TEMPORÁRIO — cria como RASCUNHO os 4 fluxos modelo na conta do admin.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const existing = await listWhatsappFlows();
  const names = new Set(existing.map((flow) => flow.name));
  const created = [];
  for (const key of ["menu-principal", "anuncio", "palavra-simulacao", "palavra-corretor"]) {
    const template = buildFlowFromTemplate(key);
    const graphResult = validateGraph(template.graph);
    const triggerErrors = validateTrigger(template.trigger);
    if (graphResult.errors.length || triggerErrors.length) {
      created.push({ key, error: [...triggerErrors, ...graphResult.errors.map((item) => item.message)] });
      continue;
    }
    if (names.has(template.name)) {
      created.push({ key, skipped: true });
      continue;
    }
    const flow = await createWhatsappFlow(template, auth);
    created.push({ key, id: flow.id, nodes: flow.graph.nodes.length });
  }
  return NextResponse.json({ created });
}
