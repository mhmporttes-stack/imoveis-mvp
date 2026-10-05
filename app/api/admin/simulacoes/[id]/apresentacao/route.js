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
import { logClientJourneyEvent, resolveActorSnapshot } from "@/lib/client-journey";
import {
  PRESENTATION_SENT_EVENT,
  PRESENTATION_SENT_JOURNEY_TEXT,
  buildPresentationSendMessage,
  canSendPresentationTo
} from "@/lib/simulation-presentation-send.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apresentação interativa da simulação — lado do CRM. Mesmo guard e MESMO escopo do PDF/da simulação:
// `getSimulation(id, auth)` valida se o usuário pode ver aquela simulação (admin tudo; gestor a equipe; corretor os
// próprios clientes; associado os do corretor vinculado). Nada daqui é público.
//   GET  → estado do link + métricas discretas
//   POST → { action: "enviar-preparar" } (get-or-create + mensagem com o link; não envia) / { action: "enviar-registrar" } (jornada)
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
  const action = ["regenerate", "enviar-preparar", "enviar-registrar"].includes(payload?.action) ? payload.action : "generate";

  try {
    const { simulation, auth } = loaded;

    // Terceira opção do "Enviar simulação" (PDF / Imagem / Apresentação). Nunca envia: devolve a mensagem para o corretor confirmar.
    if (action === "enviar-preparar" || action === "enviar-registrar") {
      if (!canSendPresentationTo(simulation.registration)) {
        return NextResponse.json({ error: "Este cliente não pode receber mensagens." }, { status: 409 });
      }
      if (action === "enviar-registrar") {
        if (simulation.registrationId) {
          await logClientJourneyEvent({
            clientId: simulation.registrationId,
            eventType: PRESENTATION_SENT_EVENT,
            actor: resolveActorSnapshot(auth),
            details: { text: PRESENTATION_SENT_JOURNEY_TEXT }
          });
        }
        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!countPresentationScenes(simulation)) {
        return NextResponse.json({ error: "Preencha os valores da simulação (financiamento, subsídio ou parcelas) antes de gerar a apresentação." }, { status: 422 });
      }
      const result = await ensurePresentation({ simulation, userId: auth.profile?.id || "" });
      if (!result?.schemaReady || !result.presentation?.token) {
        return NextResponse.json({ error: PRESENTATION_SCHEMA_MESSAGE }, { status: 503 });
      }
      const link = presentationUrl(result.presentation.token, origin(request));
      // Aquece a imagem da prévia (e a página) ANTES de o corretor enviar: gerar a imagem leva alguns segundos e, se o
      // crawler do WhatsApp chega antes, ele mostra só uma miniatura. Com o CDN já aquecido o cartão grande abre.
      // Nunca bloqueia nem quebra o envio (espera no máximo 8 s).
      await Promise.race([
        Promise.allSettled([fetch(`${link}/og`, { cache: "no-store" }), fetch(link, { cache: "no-store", headers: { "User-Agent": "WhatsApp/2" } })]),
        new Promise((resolve) => setTimeout(resolve, 8000))
      ]).catch(() => {});
      return NextResponse.json(
        // Cada envio leva um sufixo ?p= próprio: o WhatsApp guarda a prévia por URL, e um link já raspado com a imagem lenta
        // (miniatura pequena) continuaria saindo assim. URL nova = raspagem nova, já com a imagem aquecida (cartão grande).
        (() => {
          const sendLink = `${link}?p=${Math.random().toString(36).slice(2, 8)}`;
          return { link: sendLink, message: buildPresentationSendMessage({ fullName: simulation.clientName, link: sendLink }) };
        })(),
        { headers: { "Cache-Control": "no-store" } }
      );
    }

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
