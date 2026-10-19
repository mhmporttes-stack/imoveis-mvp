import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertCanAccessResponsibleUser } from "@/lib/admin-access";
import { getSimulationRegistration } from "@/lib/simulation-registrations";
import { applySimulationScenario, formatSimulationError, getSimulation } from "@/lib/simulations";
import { listScenarios } from "@/lib/simulation-scenarios";
import { scenarioDataFromSimulation } from "@/lib/simulation-scenarios-core.mjs";
import { isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aba "Comparar simulações" (REGRA OFICIAL — dono, 2026-10-19). GET: cenários do cliente + a simulação atual. POST:
// "Usar este cenário". Quem pode: quem acessa o cliente. Nada é enviado ao cliente; nenhum ponto a mais.
async function loadRegistration(request, params) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  const { id } = await params;
  const registration = await getSimulationRegistration(id, auth);
  if (!registration) return { response: NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 }) };
  assertCanAccessResponsibleUser(auth, registration.responsibleUserId || "");
  return { auth, registration };
}

function failure(error) {
  if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
  if (error?.name === "AutomaticSimulationError") return NextResponse.json({ error: error.message }, { status: error.status || 422 });
  return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
}

export async function GET(request, { params }) {
  try {
    const loaded = await loadRegistration(request, params);
    if (loaded.response) return loaded.response;
    const { auth, registration } = loaded;
    const { data: rows, error } = await getSupabaseAdminClient().from("simulations").select("id").eq("registration_id", registration.id).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    const simulation = rows?.[0] ? await getSimulation(rows[0].id, auth) : null;
    const scenarios = await listScenarios(registration.id);
    return NextResponse.json({
      schemaReady: scenarios.schemaReady,
      current: simulation ? { simulationId: simulation.id, automatic: isAutomaticSimulationSource(simulation.createdBy), data: scenarioDataFromSimulation(simulation, { registration }) } : null,
      items: scenarios.items.map(({ data, ...item }) => ({ ...item, data: { ...data, autoSnapshot: undefined } }))
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request, { params }) {
  try {
    const loaded = await loadRegistration(request, params);
    if (loaded.response) return loaded.response;
    const body = await request.json().catch(() => ({}));
    if (!body?.scenarioId) return NextResponse.json({ error: "Escolha um cenário." }, { status: 400 });
    const result = await applySimulationScenario(loaded.registration.id, String(body.scenarioId), { confirmReplace: body.confirmReplace === true }, loaded.auth);
    if (result.needsConfirmation) return NextResponse.json({ needsConfirmation: true, message: result.message }, { status: 409 });
    return NextResponse.json({ ok: true, checked: result.checked, simulationId: result.simulation?.id || "" });
  } catch (error) {
    return failure(error);
  }
}
