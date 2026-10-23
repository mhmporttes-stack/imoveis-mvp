import { NextResponse } from "next/server";
import { applyIndividualSessionStatus, getIndividualSessionRow, isSlotDispatchEnabled, verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { parseSessionId } from "@/lib/whatsapp-session-slots.mjs";
import { listLidCandidatePhones, mergeLidConversation, projectGroupMessage, projectIndividualChatAction, projectIndividualHistoryBatch, projectIndividualInboundMessage, projectIndividualMessageStatus } from "@/lib/whatsapp-individual-inbound";
import { ensureDailyGoalAutoEnabledOnConnect, redistributeBrokerQueueOnReconnect } from "@/lib/daily-goal-auto";
import { processProspectingInboundReply } from "@/lib/prospecting-reply";
import { runIndependentConsumers } from "@/lib/prospecting-reply-core.mjs";
import { listRecentConnectEvents } from "@/lib/whatsapp-session-telemetry";
import { UNDECRYPTED_WEBHOOK_TYPE, undecryptedOwnMessageEvent } from "@/lib/whatsapp-undecrypted-core.mjs";
import { normalizeViewOnce } from "@/lib/whatsapp-view-once-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lote de histórico grande pode demorar (vários inserts) — o plano Pro da
// Vercel aguenta até 300s; 280 dá margem sem passar do limite.
export const maxDuration = 280;

// Recebe do microsserviço whatsapp-individual-service/ (sessão pessoal de
// WhatsApp de cada corretor, via Baileys): mensagem nova (type:'message') ou
// mudança de status/QR da sessão (type:'status'). Autenticado por
// X-Service-Secret (nunca por cookie/sessão do CRM — não é o navegador quem chama).
export async function POST(request) {
  const secretHeader = request.headers.get("x-service-secret");
  if (!verifyIndividualServiceSecret(secretHeader)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const sessionId = String(payload?.userId || "").trim();
  if (!sessionId) return NextResponse.json({ error: "userId não informado." }, { status: 400 });
  // "userId" do microsserviço = id da SESSÃO (2026-10-08): "<id do corretor>" = Número 1 (como sempre) ou
  // "<id>:2" = Número 2. Daqui para baixo `userId` é sempre o corretor dono e `sessionSlot` o número.
  const session = parseSessionId(sessionId);
  if (!session) return NextResponse.json({ error: "userId inválido." }, { status: 400 });
  const { userId, slot: sessionSlot } = session;

  try {
    if (payload.type === "status") {
      await applyIndividualSessionStatus(userId, {
        status: payload.status,
        phoneNumber: payload.phoneNumber,
        qrData: payload.qr,
        qrExpiresAt: payload.qrExpiresAt,
        pairingCode: payload.pairingCode,
        error: payload.error,
        statusCode: payload.statusCode,
        output: payload.output,
        slot: sessionSlot
      });
      // Ativa a automação da Meta Diária sozinha assim que a sessão
      // individual DESTE corretor conecta (pedido do dono, 2026-09-30) — só
      // liga quando ainda não estava ligada, nunca pausa/desliga nada. Em
      // seguida, se sobrou atrasado de antes da desconexão, redistribui a
      // fila sozinha (pedido do dono, 2026-10-02) — nunca deixa o reconectar
      // despejar uma rajada de mensagens atrasadas fora do intervalo configurado.
      // Dois números (2026-10-08): só quando o número que conectou está com "Usar para disparo" ligado
      // (Número 1 por padrão, como antes; o Número 2 nasce desligado e não liga nada sozinho).
      if (payload.status === "connected" && isSlotDispatchEnabled(await getIndividualSessionRow(userId, sessionSlot))) {
        await ensureDailyGoalAutoEnabledOnConnect(userId);
        await redistributeBrokerQueueOnReconnect(userId);
      }
      return NextResponse.json({ ok: true });
    }

    if (payload.type === "message") {
      const kind = ["reaction", "edit", "revoke"].includes(payload.kind) ? payload.kind : "message";
      // Reação, edição e "apagar para todos" (2026-10-02): só sincronizam a
      // mensagem original no Chat — nunca são "resposta" do cliente para a
      // Prospecção (BUSINESS_RULES PRO-9/WA-9: reação nunca é resposta real).
      if (kind !== "message") {
        const result = await projectIndividualChatAction({
          userId,
          sessionSlot,
          kind,
          from: payload.from,
          fromMe: Boolean(payload.fromMe),
          waMessageId: payload.waMessageId,
          targetId: payload.targetId,
          emoji: payload.emoji,
          newText: payload.newText,
          at: payload.at
        });
        return NextResponse.json({ ok: true, chat: result });
      }

      const media = payload.media && typeof payload.media === "object" ? payload.media : null;
      const event = {
        userId,
        sessionSlot,
        from: payload.from,
        text: payload.text,
        waMessageId: payload.waMessageId,
        at: payload.at,
        contactName: payload.contactName,
        fromMe: Boolean(payload.fromMe),
        media,
        quotedId: payload.quotedId,
        quotedText: payload.quotedText,
        remoteJid: payload.remoteJid,
        // Visualização única (WA-35, dono 2026-10-23): só o marcador, sem arquivo.
        viewOnce: normalizeViewOnce(payload.viewOnce)
      };
      // Foto/áudio/figurinha sem legenda também é resposta real do cliente
      // para a Prospecção (texto de marcação, nunca vira opt-out). Visualização única segue o mesmo critério da mídia.
      const prospectingEvent = { ...event, text: String(payload.text || "").trim() || (event.viewOnce ? "[visualização única]" : media ? `[${media.kind || "mídia"}]` : "") };
      // Dois consumidores INDEPENDENTES do mesmo evento (pedido do dono,
      // 2026-10-02): A) resposta à Prospecção e B) Chat do CRM. Rodam em
      // paralelo, cada um com a própria idempotência; a falha de um (ex.: erro
      // ao gravar no Chat) nunca impede o outro.
      const results = await runIndependentConsumers({
        prospecting: () => processProspectingInboundReply(prospectingEvent),
        chat: () => projectIndividualInboundMessage(event)
      });
      for (const [name, result] of Object.entries(results)) {
        if (!result.ok) console.error(`Erro no webhook do WhatsApp individual (${name}):`, result.error?.message || result.error);
      }
      const failed = Object.values(results).some((result) => !result.ok);
      return NextResponse.json({
        ok: !failed,
        prospecting: results.prospecting.ok ? results.prospecting.value : { error: true },
        chat: results.chat.ok ? results.chat.value : { error: true }
      }, { status: failed ? 500 : 200 });
    }

    // Saída do corretor que a sessão do CRM não conseguiu decifrar (dono, 2026-10-19): é prova de envio — entra no Chat com
    // texto fixo e conta como contato humano (registerHumanContact) pelo mesmo caminho da mensagem do celular. Só o Chat:
    // mensagem do próprio corretor nunca é resposta da Prospecção.
    if (payload.type === UNDECRYPTED_WEBHOOK_TYPE) {
      const decision = undecryptedOwnMessageEvent(payload);
      if (decision.skip) return NextResponse.json({ ok: true, skipped: decision.skip });
      return NextResponse.json({ ok: true, chat: await projectIndividualInboundMessage({ ...decision.event, userId, sessionSlot }) });
    }

    // Grupo (2026-10-11): só para a aba "Grupos" do dono — nunca passa pela Prospecção nem pelo Chat de clientes.
    if (payload.type === "group_message") {
      return NextResponse.json({ ok: true, ...(await projectGroupMessage({ ...payload, userId, sessionSlot })) });
    }

    if (payload.type === "history") {
      const result = await projectIndividualHistoryBatch(userId, Array.isArray(payload.items) ? payload.items : [], { sessionSlot });
      return NextResponse.json({ ok: true, ...result });
    }

    // Mensagem enviada pelo celular do corretor para contato novo (só LID, sem telefone): o serviço pede os telefones
    // candidatos (clientes recentes desse corretor) para descobrir no WhatsApp qual deles é esse LID (2026-10-10).
    if (payload.type === "lid_candidates") {
      return NextResponse.json({ ok: true, phones: await listLidCandidatePhones(userId, sessionSlot, payload.lid) });
    }

    // O serviço descobriu o telefone de um LID que tinha conversa "Número não identificado": junta as duas.
    if (payload.type === "lid_resolved") {
      return NextResponse.json({ ok: true, ...(await mergeLidConversation({ userId, sessionSlot, lidJid: payload.lid, phone: payload.phone })) });
    }

    if (payload.type === "message_status") {
      const result = await projectIndividualMessageStatus({ userId, sessionSlot, waMessageId: payload.waMessageId, status: payload.status });
      return NextResponse.json({ ok: true, ...result });
    }

    // Limite de tentativas depois de um 403 (dono, 2026-10-13): o serviço pede a telemetria recente do número para decidir se
    // pode abrir uma conexão nova (reconnect-policy.js). Só leitura; sem credencial, mensagem nem telefone.
    if (payload.type === "connect_events") {
      return NextResponse.json({ ok: true, events: await listRecentConnectEvents(userId, sessionSlot, { windowMs: payload.windowMs }) });
    }

    return NextResponse.json({ ok: true, ignored: "unknown_type" });
  } catch (error) {
    console.error("Erro no webhook do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
