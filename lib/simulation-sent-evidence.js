import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { PRESENTATION_SENT_EVENT } from "./simulation-presentation-send.mjs";
import { SIMULATION_SENT_LOCK_MESSAGE, classifySimulationSentEvidence, shouldBlockManualSimulationSent } from "./simulation-sent-lock-core.mjs";

// Leitura do banco da evidência "simulação realmente enviada" (regra pura em simulation-sent-lock-core.mjs).

export class SimulationSentLockError extends Error {
  constructor() {
    super(SIMULATION_SENT_LOCK_MESSAGE);
    this.name = "SimulationSentLockError";
    this.status = 409;
    this.code = "SIMULATION_SENT_LOCKED";
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Evento da jornada + mensagens de saída (todas as conversas do cliente: número oficial e celular do corretor) que
// possam conter o link /s/ (no texto ou no botão "Visualizar simulação" do oficial, metadata.link.url) ou um documento. A decisão fina (regex do link, falha, nome do PDF) é da regra pura.
export async function loadSimulationSentEvidence(clientId) {
  if (!clientId) return classifySimulationSentEvidence();
  const [journey, conversations] = await Promise.all([
    db().from("client_journey_events").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("event_type", PRESENTATION_SENT_EVENT),
    db().from("whatsapp_conversations").select("id").eq("client_id", clientId)
  ]);
  if (journey.error) throw journey.error;
  if (conversations.error) throw conversations.error;
  const conversationIds = (conversations.data || []).map((row) => row.id);
  let messages = [];
  if (conversationIds.length) {
    const { data, error } = await db().from("whatsapp_messages")
      .select("direction, status, message_type, body, metadata")
      .in("conversation_id", conversationIds)
      .eq("direction", "outbound")
      .neq("status", "failed")
      .or("body.ilike.%/s/%,metadata->link->>url.ilike.%/s/%,message_type.eq.document")
      .order("message_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    messages = data || [];
  }
  return classifySimulationSentEvidence({ presentationEvents: journey.count || 0, messages });
}

// Barreira no SERVIDOR para mudança MANUAL de status (quem chama passa o `auth` do usuário). Mudanças automáticas sem
// usuário (automações do CRM) não passam por aqui.
export async function assertManualSimulationSentAllowed({ clientId, currentStatus, nextStatus, auth }) {
  const profile = auth?.profile;
  if (!shouldBlockManualSimulationSent({ currentStatus, nextStatus, profile, evidenceSent: false })) return;
  const evidence = clientId ? await loadSimulationSentEvidence(clientId) : { sent: false };
  if (shouldBlockManualSimulationSent({ currentStatus, nextStatus, profile, evidenceSent: evidence.sent })) throw new SimulationSentLockError();
}
