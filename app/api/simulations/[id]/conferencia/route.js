import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertCanAccessResponsibleUser } from "@/lib/admin-access";
import { canManageSimulations, formatSimulationError, getSimulation, updateSimulation } from "@/lib/simulations";
import { AUTO_REVIEW_SCHEMA_MESSAGE, markAutoReview } from "@/lib/simulation-auto-reviews";
import { AUTO_REVIEW_STATUS, AUTO_SIMULATION_REVIEW_ENABLED, parseCaixaIncome } from "@/lib/simulation-auto-review-core.mjs";
import { isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botões TEMPORÁRIOS da simulação automática (SIM-AUTO, dono 2026-10-19): "Simulação OK" (bateu com a Caixa → vira
// simulação do corretor, como salvar no Gerador) e "Corrigir simulação" (guarda a renda usada na Caixa e o corretor
// segue para a edição normal; os valores corrigidos são gravados quando ele salva). Quem pode: quem acessa o cliente.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!AUTO_SIMULATION_REVIEW_ENABLED) return NextResponse.json({ error: "Conferência da simulação automática desligada." }, { status: 404 });
  if (!canManageSimulations()) return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });

  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    const simulation = await getSimulation(id, auth);
    if (!simulation) return NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 });
    if (simulation.registration) assertCanAccessResponsibleUser(auth, simulation.registration.responsibleUserId || "");
    if (!isAutomaticSimulationSource(simulation.createdBy)) {
      return NextResponse.json({ error: "Esta simulação já foi conferida ou salva pelo corretor." }, { status: 409 });
    }

    if (body.action === "ok") {
      const review = await markAutoReview({ simulationId: id, status: AUTO_REVIEW_STATUS.OK, auth });
      if (!review.schemaReady) return NextResponse.json({ error: AUTO_REVIEW_SCHEMA_MESSAGE }, { status: 503 });
      // Mesma gravação do "Salvar" do Gerador: vira simulação do corretor e o cliente vai para "Simulação realizada".
      const { registration: _registration, ...payload } = simulation;
      const saved = await updateSimulation(id, payload, auth.user?.email || "", auth);
      return NextResponse.json({ ok: true, simulation: saved });
    }

    if (body.action === "corrigir") {
      const caixaIncome = parseCaixaIncome(body.caixaIncome);
      if (caixaIncome === null) return NextResponse.json({ error: "Informe a renda usada no simulador da Caixa (ex.: 2.550,00)." }, { status: 400 });
      const review = await markAutoReview({ simulationId: id, status: AUTO_REVIEW_STATUS.CORRECTING, caixaIncome, auth });
      if (!review.schemaReady) return NextResponse.json({ error: AUTO_REVIEW_SCHEMA_MESSAGE }, { status: 503 });
      return NextResponse.json({ ok: true, editUrl: `/admin/simulacoes/${id}` });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: error?.status || 400 });
  }
}
