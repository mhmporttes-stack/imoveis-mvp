import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { processWhatsappWebhook } from "@/lib/whatsapp-master";

export const runtime = "nodejs";

// TEMPORÁRIO — passa um webhook SINTÉTICO (telefone falso) pelo caminho real
// (processWhatsappWebhook) para ver se o fluxo ativo dispara. Apagar depois.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getSupabaseAdminClient();
  const phone = "+5500900000002";
  const out = {};
  try {
    await db.from("whatsapp_flow_sessions").delete().eq("contact_phone", phone);
    await db.from("whatsapp_conversations").delete().eq("contact_phone", phone);
    const { data: conversation } = await db.from("whatsapp_conversations").insert({ contact_phone: phone, contact_name: "Teste Webhook", status: "in_service" }).select("id").single();
    // Atendente humano respondeu há 3h (fora da janela de "atendente presente").
    await db.from("whatsapp_messages").insert({ conversation_id: conversation.id, direction: "outbound", sender_type: "user", message_type: "text", body: "resposta antiga", status: "sent", meta_message_id: `tmp-old-${Date.now()}`, message_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });

    const { data: before } = await db.from("whatsapp_flows").select("id, triggered_count").eq("status", "active");
    const payload = {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
            contacts: [{ wa_id: "5500900000002", profile: { name: "Teste Webhook" } }],
            messages: [{ from: "5500900000002", id: `wamid.TMPTEST${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Olá boa noite" } }]
          }
        }]
      }]
    };
    out.webhook = await processWhatsappWebhook(payload);

    const { data: sessions } = await db.from("whatsapp_flow_sessions").select("status, end_reason, error").eq("contact_phone", phone);
    const { data: logs } = await db.from("whatsapp_flow_logs").select("kind, node_id, detail").eq("contact_phone", phone).order("created_at");
    out.sessions = sessions;
    out.logs = (logs || []).map((log) => `${log.kind}:${log.node_id || ""}:${JSON.stringify(log.detail).slice(0, 100)}`);
    out.flowsBefore = before;
  } catch (error) {
    out.error = String(error?.message || error);
  } finally {
    const { data: flows } = await db.from("whatsapp_flows").select("id, triggered_count").eq("status", "active");
    out.flowsAfter = flows;
    await db.from("whatsapp_flow_sessions").delete().eq("contact_phone", phone);
    await db.from("whatsapp_conversations").delete().eq("contact_phone", phone);
    await db.from("whatsapp_master_events").delete().eq("sender_phone", phone);
  }
  return NextResponse.json(out);
}
