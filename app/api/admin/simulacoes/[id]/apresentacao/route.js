import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageSimulations, formatSimulationError, getSimulation } from "@/lib/simulations";
import {
  PRESENTATION_SCHEMA_MESSAGE,
  countPresentationScenes,
  ensurePresentation,
  getActivePresentation,
  presentationUrl,
  regeneratePresentation
} from "@/lib/simulation-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apresentação interativa da simulação — lado do CRM. Mesmo guard e MESMO escopo do PDF/da simulação:
// `getSimulation(id, auth)` valida se o usuário pode ver aquela simulação (admin tudo; gestor a equipe; corretor os
// próprios clientes; associado os do corretor vinculado). Nada daqui é público.
//   GET  → estado do link + métricas discretas
//   POST → { action: "generate" } (idempotente: devolve o mesmo link) ou { action: "regenerate" } (revoga e cria novo)

function origin(request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

async function loadAuthorizedSimulation(request, params) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!canManageSimulations()) {
    return { response: NextResponse.json({ error: "Supabase não configurado." }, { status: 503 }) };
  }
  try {
    const simulation = await getSimulation((await params).id, auth);
    if (!simulation) return { response: NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 }) };
    return { auth, simulation };
  } catch (error) {
    if (error?.name === "AdminPermissionError") {
      return { response: NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 }) };
    }
    return { response: NextResponse.json({ error: formatSimulationError(error) }, { status: 400 }) };
  }
}

async function stateBody(simulation, result, request) {
  if (!result.schemaReady) {
    return { schemaReady: false, message: PRESENTATION_SCHEMA_MESSAGE, presentation: null };
  }
  const presentation = result.presentation;
  const sceneCount = await countPresentationScenes(simulation);
  return {
    schemaReady: true,
    ready: sceneCount > 0,
    sceneCount,
    clientName: simulation.clientName || "",
    simulationDate: simulation.simulationDate || "",
    presentation: presentation
      ? {
          url: presentationUrl(presentation.token, origin(request)),
          createdAt: presentation.createdAt,
          firstOpenedAt: presentation.firstOpenedAt,
          lastOpenedAt: presentation.lastOpenedAt,
          viewCount: presentation.viewCount,
          completedAt: presentation.completedAt,
          lastScene: presentation.lastScene
        }
      : null
  };
}

export async function GET(request, { params }) {
  const loaded = await loadAuthorizedSimulation(request, params);
  if (loaded.response) return loaded.response;
  try {
    const result = await getActivePresentation(loaded.simulation.id);
    return NextResponse.json(await stateBody(loaded.simulation, result, request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar apresentação da simulação:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível consultar a apresentação." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const loaded = await loadAuthorizedSimulation(request, params);
  if (loaded.response) return loaded.response;

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const action = payload?.action === "regenerate" ? "regenerate" : "generate";

  try {
    const { simulation, auth } = loaded;
    const sceneCount = await countPresentationScenes(simulation);
    if (!sceneCount) {
      return NextResponse.json({ error: "Preencha os valores da simulação (financiamento, subsídio ou parcelas) antes de gerar a apresentação." }, { status: 422 });
    }
    const userId = auth.profile?.id || "";
    const result = action === "regenerate"
      ? await regeneratePresentation({ simulation, userId })
      : await ensurePresentation({ simulation, userId });
    return NextResponse.json(await stateBody(simulation, result, request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao gerar apresentação da simulação:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gerar a apresentação." }, { status: 500 });
  }
}
