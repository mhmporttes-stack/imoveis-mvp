import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSiteBaseUrl } from "@/lib/admin-profiles";
import { canManageSimulations, formatSimulationError, getSimulation } from "@/lib/simulations";
import {
  PRESENTATION_SCHEMA_MESSAGE,
  countPresentationScenes,
  ensurePresentation,
  getActivePresentation,
  presentationUrl,
  isApprovalPresentation,
  regeneratePresentation
} from "@/lib/simulation-presentation";
import { logClientJourneyEvent, resolveActorSnapshot } from "@/lib/client-journey";
import { readPaymentStrategy } from "@/lib/payment-strategy";
import { findOpenOfficialConversationId } from "@/lib/whatsapp-chat";
import {
  PRESENTATION_LINK_COPIED_EVENT,
  PRESENTATION_LINK_COPIED_JOURNEY_TEXT,
  PRESENTATION_SENT_EVENT,
  PRESENTATION_SENT_JOURNEY_TEXT,
  buildPresentationSendMessage,
  canSendPresentationTo
} from "@/lib/simulation-presentation-send.mjs";
import { loadPresentationSendState } from "@/lib/simulation-sent-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apresentação interativa da simulação — lado do CRM. Mesmo guard e MESMO escopo do PDF/da simulação:
// `getSimulation(id, auth)` valida se o usuário pode ver aquela simulação (admin tudo; gestor a equipe; corretor os
// próprios clientes; associado os do corretor vinculado). Nada daqui é público.
//   GET  → estado do link + métricas discretas
//   POST → { action: "enviar-preparar" } (get-or-create + mensagem com o link; não envia) / { action: "enviar-registrar" } (jornada)
//   POST → { action: "copiar-registrar" } (dono, 2026-10-19): "Copiar link" fica na jornada como COPIADO (presentation_link_copied),
//          nunca como enviado — não conta como envio (FUN-13) nem como atendimento (FUN-15f)
//   POST → { action: "generate" } (idempotente: devolve o mesmo link) ou { action: "regenerate" } (revoga e cria novo)
//   POST → { action: "aprovacao" } — RECUSADO (409): a "Apresentação de aprovação" liga sozinha quando o cliente está em
//          "Cliente aprovado" ou etapa posterior (REGRA OFICIAL — dono, 2026-10-19; substitui a chave manual do PRES-21).

const APPROVAL_AUTOMATIC_MESSAGE = "A apresentação de aprovação agora liga sozinha quando o cliente passa para \"Cliente aprovado\".";

// Sempre o domínio da marca (lib/site-url.mjs): o cabeçalho Host não é confiável para montar o link enviado ao cliente
// nem para a busca de aquecimento feita pelo servidor.
function origin() {
  return getSiteBaseUrl().replace(/[/]$/, "");
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
  // Última "Estratégia de pagamento" gravada pelo cliente no link (PRES-24). Falha de leitura não derruba o painel.
  const paymentStrategy = presentation ? await readPaymentStrategy(presentation.id).catch((error) => {
    console.error("[apresentacao] nao foi possivel ler a estrategia de pagamento:", error?.message || error);
    return null;
  }) : null;
  // Linha "envio não registrado" do painel (dono, 2026-10-19): só faz sentido com link já aberto pelo cliente. Falha de leitura
  // não derruba o painel (a linha só não aparece) e fica no log.
  const sendState = presentation?.firstOpenedAt && simulation.registrationId
    ? await loadPresentationSendState(simulation.registrationId).catch((error) => {
      console.error("[apresentacao] nao foi possivel ler a prova de envio:", error?.message || error);
      return null;
    })
    : null;
  return {
    schemaReady: true,
    ready: sceneCount > 0,
    // Sem permissão de contato (arquivado / Não contactar): o "Enviar simulação" do painel fica desativado.
    canContact: canSendPresentationTo(simulation.registration),
    sendState,
    sceneCount,
    // Apresentação de aprovação automática (dono, 2026-10-19): ligada pela etapa atual do cliente, sem chave manual.
    approvalEnabled: isApprovalPresentation(simulation),
    clientName: simulation.clientName || "",
    simulationDate: simulation.simulationDate || "",
    paymentStrategy,
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
  const action = ["regenerate", "enviar-preparar", "enviar-registrar", "copiar-registrar", "aprovacao"].includes(payload?.action) ? payload.action : "generate";

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
      // Dono, 2026-10-11: pelo Chat só quando o cliente iniciou conversa no número oficial (janela de 24 h aberta).
      const officialConversationId = await findOpenOfficialConversationId(simulation.registrationId).catch(() => "");
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
          return { link: sendLink, message: buildPresentationSendMessage({ fullName: simulation.clientName, link: sendLink }), officialConversationId };
        })(),
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (action === "copiar-registrar") {
      const copiedAt = new Date().toISOString();
      if (simulation.registrationId) {
        await logClientJourneyEvent({
          clientId: simulation.registrationId,
          eventType: PRESENTATION_LINK_COPIED_EVENT,
          actor: resolveActorSnapshot(auth),
          details: { text: PRESENTATION_LINK_COPIED_JOURNEY_TEXT }
        });
      }
      return NextResponse.json({ ok: true, copiedAt, recorded: Boolean(simulation.registrationId) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "aprovacao") {
      return NextResponse.json({ error: APPROVAL_AUTOMATIC_MESSAGE }, { status: 409 });
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
    if (error?.code === "AUTO_SIMULATION_NOT_REVIEWED") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Falha ao gerar apresentação da simulação:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gerar a apresentação." }, { status: 500 });
  }
}
