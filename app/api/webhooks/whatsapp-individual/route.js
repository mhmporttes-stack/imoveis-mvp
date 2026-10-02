import { NextResponse } from "next/server";
import { applyIndividualSessionStatus, verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { projectIndividualHistoryBatch, projectIndividualInboundMessage, projectIndividualMessageStatus } from "@/lib/whatsapp-individual-inbound";
import { ensureDailyGoalAutoEnabledOnConnect, redistributeBrokerQueueOnReconnect } from "@/lib/daily-goal-auto";
import { processProspectingInboundReply } from "@/lib/prospecting-reply";
import { runIndependentConsumers } from "@/lib/prospecting-reply-core.mjs";

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

  const userId = String(payload?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId não informado." }, { status: 400 });

  try {
    if (payload.type === "status") {
      await applyIndividualSessionStatus(userId, {
        status: payload.status,
        phoneNumber: payload.phoneNumber,
        qrData: payload.qr,
        qrExpiresAt: payload.qrExpiresAt,
        pairingCode: payload.pairingCode,
        error: payload.error
      });
      // Ativa a automação da Meta Diária sozinha assim que a sessão
      // individual DESTE corretor conecta (pedido do dono, 2026-09-30) — só
      // liga quando ainda não estava ligada, nunca pausa/desliga nada. Em
      // seguida, se sobrou atrasado de antes da desconexão, redistribui a
      // fila sozinha (pedido do dono, 2026-10-02) — nunca deixa o reconectar
      // despejar uma rajada de mensagens atrasadas fora do intervalo configurado.
      if (payload.status === "connected") {
        await ensureDailyGoalAutoEnabledOnConnect(userId);
        await redistributeBrokerQueueOnReconnect(userId);
      }
      return NextResponse.json({ ok: true });
    }

    if (payload.type === "message") {
      const event = {
        userId,
        from: payload.from,
        text: payload.text,
        waMessageId: payload.waMessageId,
        at: payload.at,
        contactName: payload.contactName,
        fromMe: Boolean(payload.fromMe)
      };
      // Dois consumidores INDEPENDENTES do mesmo evento (pedido do dono,
      // 2026-10-02): A) resposta à Prospecção e B) Chat do CRM. Rodam em
      // paralelo, cada um com a própria idempotência; a falha de um (ex.: erro
      // ao gravar no Chat) nunca impede o outro.
      const results = await runIndependentConsumers({
        prospecting: () => processProspectingInboundReply(event),
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

    if (payload.type === "history") {
      const result = await projectIndividualHistoryBatch(userId, Array.isArray(payload.items) ? payload.items : []);
      return NextResponse.json({ ok: true, ...result });
    }

    if (payload.type === "message_status") {
      const result = await projectIndividualMessageStatus({ waMessageId: payload.waMessageId, status: payload.status });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: true, ignored: "unknown_type" });
  } catch (error) {
    console.error("Erro no webhook do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
