import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSiteBaseUrl, isGeneralAdminAuth } from "@/lib/admin-profiles";
import { prepareClientDocumentsList, recordClientDocumentsListSent } from "@/lib/documents-forecast";
import { findOpenOfficialConversationId, getChatReplyReadiness } from "@/lib/whatsapp-chat";
import { getOpenRestriction } from "@/lib/whatsapp-restriction";
import { VALIDATION_VALIDATED } from "@/lib/whatsapp-restriction-core.mjs";
import { isPrintedListModeAuth } from "@/lib/whatsapp-manual-disconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botão "Enviar lista de documentos" da ficha do cliente (round 4). Quem ENVIA é o corretor, depois de ver a prévia: este
// endpoint nunca manda mensagem. Guard: requireAdminApi + escopo de equipe do cliente (getSimulationRegistration(id, auth),
// que usa assertCanAccessResponsibleUser). Durante "Alterar conta" é ação OPERACIONAL atribuída ao corretor emulado.
//   POST { action: "preparar" } (padrão) → { message, link, imageUrl, chatReady, chatReason }: legenda curta + URL da IMAGEM PNG da lista
//     (imageUrl = anexo do Chat; link = ?baixar=1 do botão "Baixar imagem da lista" quando o WhatsApp não está conectado)
//   POST { action: "registrar" }         → grava "Lista de documentos enviada" na jornada (não muda status)
// Cliente arquivado / "Não contactar": 409. Sem simulação com valores: 422 ("Lance a simulação primeiro").

// Sempre o domínio da marca (lib/site-url.mjs): o cabeçalho Host não é confiável para montar o link enviado ao cliente
// nem para a busca de aquecimento feita pelo servidor.
function origin() {
  return getSiteBaseUrl().replace(/[/]$/, "");
}

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const action = payload?.action === "registrar" ? "registrar" : "preparar";
  const { id } = await params;

  try {
    if (action === "registrar") {
      const result = await recordClientDocumentsListSent(id, auth);
      if (result.kind === "not_found") return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      if (result.kind === "blocked") return NextResponse.json({ error: "Este cliente não pode receber mensagens." }, { status: 409 });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await prepareClientDocumentsList(id, auth, origin(request));
    if (result.kind === "not_found") return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    if (result.kind === "blocked") return NextResponse.json({ error: "Este cliente não pode receber mensagens." }, { status: 409 });
    if (result.kind === "no_simulation") return NextResponse.json({ error: "Lance a simulação primeiro." }, { status: 422 });
    if (result.kind === "unavailable") return NextResponse.json({ error: "Recurso ainda não ativado no banco." }, { status: 503 });
    // Canal da lista (regra do dono, 2026-10-14), na ordem:
    //   1. conversa do cliente no número OFICIAL com a janela de 24 h aberta → Chat pelo oficial;
    //   2. conversa do cliente com o WhatsApp do corretor conectado ao CRM → Chat por esse número
    //      (mesmo critério do envio real: getChatReplyReadiness, o Chat só RESPONDE — proteção de 2026-10-05);
    //   3. WhatsApp do aparelho (wa.me/Web) SOMENTE com restrição do WhatsApp VALIDADA no CRM (PRO-13/14);
    //      admin geral segue isento, como nas demais regras de restrição;
    //   4. senão, não envia (o modal explica). Falha ao checar = nunca abre o WhatsApp externo por engano.
    //   Modo lista impressa (PRO-15, dono 2026-10-15): sem Chat — os passos 1 e 2 não valem; sem restrição validada, não envia.
    const printedListMode = await isPrintedListModeAuth(auth);
    let channel = { type: "blocked", reason: printedListMode ? "printed_list_mode" : "no_conversation", conversationId: "" };
    if (!printedListMode) {
      try {
        const officialId = await findOpenOfficialConversationId(id);
        if (officialId) channel = { type: "official", reason: "official_window", conversationId: officialId };
      } catch (officialError) {
        console.error("Falha ao checar a conversa do número oficial (lista de documentos):", officialError?.message || officialError);
      }
    }
    if (channel.type === "blocked" && !printedListMode) {
      try {
        const chat = await getChatReplyReadiness(id);
        if (chat.ready) channel = { type: "individual", reason: "reply", conversationId: chat.conversationId || "" };
        else channel = { ...channel, reason: chat.reason || "no_conversation" };
      } catch (readinessError) {
        console.error("Falha ao checar a conversa do cliente no Chat (lista de documentos):", readinessError?.message || readinessError);
      }
    }
    if (channel.type === "blocked") {
      let validated = isGeneralAdminAuth(auth);
      if (!validated) {
        try {
          const restriction = await getOpenRestriction(auth.profile?.id);
          validated = restriction?.validation_status === VALIDATION_VALIDATED;
        } catch (restrictionError) {
          console.error("Falha ao checar a restrição do WhatsApp (lista de documentos):", restrictionError?.message || restrictionError);
        }
      }
      if (validated) channel = { type: "external", reason: channel.reason, conversationId: "" };
    }
    return NextResponse.json(
      {
        message: result.message,
        // Lista personalizada em texto para o botão "Copiar texto" (dono, 2026-10-20); sempre disponível, mesmo sem canal.
        listText: result.listText || "",
        link: result.link,
        imageUrl: result.imageUrl,
        channel: channel.type,
        channelReason: channel.reason,
        conversationId: channel.conversationId,
        // Compatibilidade com telas antigas abertas (app sem recarregar).
        chatReady: channel.type === "official" || channel.type === "individual",
        chatReason: channel.reason
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
    if (error?.code === "AUTO_SIMULATION_NOT_REVIEWED") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Falha ao preparar a lista de documentos do cliente:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível preparar a lista de documentos." }, { status: 500 });
  }
}
