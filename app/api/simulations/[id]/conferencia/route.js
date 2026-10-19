import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertCanAccessResponsibleUser } from "@/lib/admin-access";
import { canManageSimulations, formatSimulationError, getSimulation, updateSimulation } from "@/lib/simulations";
import { AUTO_REVIEW_SCHEMA_MESSAGE } from "@/lib/simulation-auto-reviews";
import { closeAutoReview, ensureOpenAutoReview, getOpenAutoReview, saveTypeReviews } from "@/lib/simulation-auto-review-types";
import { AUTO_SIMULATION_REVIEW_ENABLED } from "@/lib/simulation-auto-review-core.mjs";
import {
  TYPE_REVIEW_STATUS,
  isReviewType,
  markedTypes,
  modelsWithCorrection,
  parseTypeCorrection,
  pendingTypes,
  withTypeMark
} from "@/lib/simulation-auto-review-types-core.mjs";
import { normalizeSimulationModels } from "@/lib/simulation-models";
import { isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conferência da simulação automática POR TIPO de imóvel (REGRA OFICIAL — dono, 2026-10-19): 👍 (bateu com a Caixa) ou
// 👎 (corrigir: renda usada + valores Price da Caixa) sob o novo e o usado. Quando TODOS os tipos marcados estão
// conferidos, a conferência fecha e a simulação vira do corretor (mesma gravação do "Salvar" do Gerador: "Simulação
// realizada" + ponto + link liberado). Quem pode: quem acessa o cliente.
//   GET  → { typeReviews, types, pending }
//   POST → { action: "ok" | "corrigir", type: "novo" | "usado", correction? }
const CLOSED_MESSAGE = "Não há conferência aberta para registrar este voto. Clique em \"Refazer simulação automática\" e confira de novo.";

async function load(request, params) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!AUTO_SIMULATION_REVIEW_ENABLED) return { response: NextResponse.json({ error: "Conferência da simulação automática desligada." }, { status: 404 }) };
  if (!canManageSimulations()) return { response: NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 }) };
  const id = (await params).id;
  const simulation = await getSimulation(id, auth);
  if (!simulation) return { response: NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 }) };
  if (simulation.registration) assertCanAccessResponsibleUser(auth, simulation.registration.responsibleUserId || "");
  return { auth, id, simulation };
}

export async function GET(request, { params }) {
  try {
    const loaded = await load(request, params);
    if (loaded.response) return loaded.response;
    const models = normalizeSimulationModels(loaded.simulation.simulationModels, loaded.simulation);
    const automatic = isAutomaticSimulationSource(loaded.simulation.createdBy);
    const open = automatic ? await getOpenAutoReview(loaded.id) : { schemaReady: true, typeReviews: {} };
    return NextResponse.json({
      automatic,
      schemaReady: open.schemaReady,
      types: markedTypes(models),
      typeReviews: open.typeReviews,
      pending: automatic ? pendingTypes(models, open.typeReviews) : []
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: error?.status || 400 });
  }
}

export async function POST(request, { params }) {
  try {
    const loaded = await load(request, params);
    if (loaded.response) return loaded.response;
    const { auth, id, simulation } = loaded;
    if (!isAutomaticSimulationSource(simulation.createdBy)) {
      return NextResponse.json({ error: "Esta simulação já foi conferida ou salva pelo corretor." }, { status: 409 });
    }
    const body = await request.json().catch(() => ({}));
    const type = body?.type;
    const models = normalizeSimulationModels(simulation.simulationModels, simulation);
    if (!isReviewType(type) || !markedTypes(models).includes(type)) {
      return NextResponse.json({ error: "Escolha o imóvel (novo ou usado) que você conferiu." }, { status: 400 });
    }
    if (!["ok", "corrigir"].includes(body?.action)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

    // Conferência aberta: cria quando não existe; nunca libera o link sem registrar o voto.
    const open = await ensureOpenAutoReview(simulation);
    if (!open.schemaReady) return NextResponse.json({ error: AUTO_REVIEW_SCHEMA_MESSAGE }, { status: 503 });
    if (!open.row) return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 409 });

    const actor = { by: auth.user?.email || "", byUserId: auth.profile?.id || "", at: new Date().toISOString() };
    let current = simulation;
    let mark = { status: TYPE_REVIEW_STATUS.OK, ...actor };
    if (body.action === "corrigir") {
      const correction = parseTypeCorrection(body.correction || {});
      if (correction.error) return NextResponse.json({ error: correction.error }, { status: 400 });
      // Grava os valores da Caixa SÓ deste tipo como rascunho da automática (autosave: não vira do corretor ainda).
      const { registration: _registration, ...payload } = simulation;
      current = await updateSimulation(id, { ...payload, simulationModels: modelsWithCorrection(models, type, correction.values), autosave: true }, auth.user?.email || "", auth, { skipScenario: true });
      mark = { status: TYPE_REVIEW_STATUS.CORRECTED, caixaIncome: correction.caixaIncome, values: correction.values, ...actor };
    }

    const typeReviews = withTypeMark(open.typeReviews, type, mark);
    const currentModels = normalizeSimulationModels(current.simulationModels, current);
    const pending = pendingTypes(currentModels, typeReviews);
    if (pending.length) {
      const saved = await saveTypeReviews({ rowId: open.row.id, typeReviews });
      if (!saved) return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 409 });
      return NextResponse.json({ ok: true, done: false, typeReviews, pending });
    }

    // Todos os tipos marcados conferidos: fecha a conferência e só então a simulação vira do corretor.
    const closed = await closeAutoReview({ rowId: open.row.id, simulation: current, typeReviews, auth });
    if (!closed) return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 409 });
    const { registration: _registration, ...finalPayload } = current;
    const saved = await updateSimulation(id, finalPayload, auth.user?.email || "", auth);
    return NextResponse.json({ ok: true, done: true, typeReviews, pending: [], simulation: saved });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: error?.status || 400 });
  }
}
