import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { createWhatsappFlow, deleteWhatsappFlow, processDueFlowSessions, processFlowInbound, publishWhatsappFlow } from "@/lib/whatsapp-flows";

export const runtime = "nodejs";

// TEMPORÁRIO — teste de integração dos Fluxos com um telefone FALSO (número
// impossível: a Meta recusa o envio). Apagar depois do teste.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getSupabaseAdminClient();
  const phone = "+5500900000001";
  const out = { steps: [] };
  let flowId = null;
  try {
    await db.from("whatsapp_conversations").delete().eq("contact_phone", phone);
    const { data: conversation, error: convError } = await db.from("whatsapp_conversations").insert({
      contact_phone: phone, contact_name: "Teste Fluxo", status: "in_service", last_inbound_at: new Date().toISOString()
    }).select("id").single();
    if (convError) throw convError;
    await db.from("whatsapp_messages").insert({ conversation_id: conversation.id, direction: "inbound", sender_type: "customer", message_type: "text", body: "zzteste", status: "received", meta_message_id: `tmp-flow-test-${Date.now()}` });

    const flow = await createWhatsappFlow({
      name: "TESTE TEMPORARIO",
      trigger: { type: "keyword", keywords: ["zzteste"], match: "contains", cooldownHours: 0 },
      graph: {
        nodes: [
          { id: "start", type: "start", x: 0, y: 0, data: {} },
          { id: "c1", type: "condition", x: 0, y: 0, data: { kind: "is_client" } },
          { id: "m1", type: "message", x: 0, y: 0, data: { mode: "buttons", text: "Teste {{primeiro_nome}}", buttons: [{ id: "b1", title: "Sim" }], followUp: { enabled: false, amount: 2, unit: "hours" } } },
          { id: "m2", type: "message", x: 0, y: 0, data: { mode: "buttons", text: "Teste 2", buttons: [{ id: "b1", title: "Ok" }], followUp: { enabled: false, amount: 2, unit: "hours" } } }
        ],
        edges: [
          { id: "e1", from: "start", port: "next", to: "c1" },
          { id: "e2", from: "c1", port: "yes", to: "m1" },
          { id: "e3", from: "c1", port: "no", to: "m2" }
        ]
      }
    }, auth);
    flowId = flow.id;
    await publishWhatsappFlow(flow.id, auth);
    out.steps.push("fluxo criado e publicado");

    const handled = await processFlowInbound({
      sender_phone: phone, message_type: "text", message_text: "quero zzteste", contact_name: "Teste Fluxo",
      raw_payload: { message: { type: "text", text: { body: "quero zzteste" } } }
    });
    out.handled = handled;

    const { data: sessions } = await db.from("whatsapp_flow_sessions").select("status, end_reason, error, current_node_id").eq("flow_id", flow.id);
    const { data: logs } = await db.from("whatsapp_flow_logs").select("kind, node_id, detail").eq("flow_id", flow.id).order("created_at");
    const { data: conv } = await db.from("whatsapp_conversations").select("status").eq("id", conversation.id).single();
    const { data: flowRow } = await db.from("whatsapp_flows").select("triggered_count").eq("id", flow.id).single();
    out.sessions = sessions;
    out.logs = logs;
    out.conversationStatusAfter = conv?.status;
    out.triggeredCount = flowRow?.triggered_count;

    // Segunda mensagem igual: sessão anterior terminou (failed) -> deve poder iniciar de novo (cooldown 0).
    out.cron = await processDueFlowSessions();
  } catch (error) {
    out.error = String(error?.message || error);
  } finally {
    if (flowId) await deleteWhatsappFlow(flowId, auth).catch(() => {});
    await db.from("whatsapp_conversations").delete().eq("contact_phone", phone);
  }
  return NextResponse.json(out);
}
