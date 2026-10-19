import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatSimulationError, redoAutomaticSimulation } from "@/lib/simulations";
import { markRegistrationAutoSimulation } from "@/lib/simulation-registrations";
import { saveAutoSnapshot } from "@/lib/simulation-auto-reviews";
import { buildAutoSnapshot } from "@/lib/simulation-auto-review-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Refazer simulação automática" (REGRA OFICIAL — dono, 2026-10-19): recalcula com os dados atuais do cadastro e grava
// como simulação automática (conferência obrigatória de novo). Quem pode: quem acessa o cliente (requireAdminApi +
// assertCanAccessResponsibleUser em redoAutomaticSimulation). Nada é enviado ao cliente.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await redoAutomaticSimulation(id, { confirmReplace: body?.confirmReplace === true }, auth);
    if (result.needsConfirmation) return NextResponse.json({ needsConfirmation: true, message: result.message }, { status: 409 });
    try {
      await markRegistrationAutoSimulation(id);
      await saveAutoSnapshot({
        registrationId: id,
        simulationId: result.simulation.id,
        snapshot: buildAutoSnapshot(result.registration, result.estimate, result.referenceDate, { origin: "refazer", requestedBy: auth.user?.email || null, suggestion: result.suggestion }),
        newRound: true
      });
    } catch (followUpError) {
      console.warn("Refazer simulação automática: status/conferência não atualizados:", followUpError?.message || followUpError);
    }
    return NextResponse.json({
      ok: true,
      simulationId: result.simulation.id,
      income: result.estimate.income,
      informalCapped: result.estimate.informalCapped,
      suggestion: result.suggestion,
      replacedManual: result.replacedManual
    });
  } catch (error) {
    if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
    if (error?.name === "AutomaticSimulationError") return NextResponse.json({ error: error.message }, { status: error.status || 422 });
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}
