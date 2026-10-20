import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { PRESENTATION_LINK_COPIED_EVENT, PRESENTATION_SENT_EVENT } from "./simulation-presentation-send.mjs";
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
  const evidence = classifySimulationSentEvidence({ presentationEvents: journey.count || 0, messages });
  if (evidence.sent) return evidence;
  return classifySimulationSentEvidence({ presentationEvents: journey.count || 0, messages, tokenLinkSent: await isPresentationTokenSentByTeam(clientId) });
}

// Prova de envio em conversa Particular / sem cliente vinculado (dono, 2026-10-19 — aprovado na Mesa "Atendimento depois da
// simulação"; toca a privacidade da WA-19/WA-23): procura o TOKEN EXATO dos links de apresentação do cliente (≥ 128 bits,
// único) em mensagens de SAÍDA não falhas do WhatsApp pessoal do responsável e da equipe dele (responsável, corretor
// vinculado, associados vinculados e gestor; `session_user_id`, indexado). Devolve SÓ sim/não: nenhum conteúdo sai daqui e a
// conversa não é ligada ao cliente. Sem índice de texto novo (busca limitada às sessões da equipe, 1 linha).
async function isPresentationTokenSentByTeam(clientId) {
  const [registration, simulations] = await Promise.all([
    db().from("simulation_registrations").select("responsible_user_id").eq("id", clientId).maybeSingle(),
    db().from("simulations").select("id").eq("registration_id", clientId)
  ]);
  if (registration.error) throw registration.error;
  if (simulations.error) throw simulations.error;
  const responsibleId = registration.data?.responsible_user_id || "";
  if (!responsibleId) return false;
  const simulationIds = (simulations.data || []).map((row) => row.id);
  const presentationFilter = [`registration_id.eq.${clientId}`, simulationIds.length ? `simulation_id.in.(${simulationIds.join(",")})` : ""].filter(Boolean).join(",");
  const [presentations, responsible, associates] = await Promise.all([
    db().from("simulation_presentations").select("token").or(presentationFilter),
    db().from("admin_users").select("id, manager_id, linked_broker_id").eq("id", responsibleId).maybeSingle(),
    db().from("admin_users").select("id").eq("linked_broker_id", responsibleId)
  ]);
  if (presentations.error) {
    if (/simulation_presentations/i.test(presentations.error.message || "") || ["42P01", "PGRST205"].includes(String(presentations.error.code || ""))) return false;
    throw presentations.error;
  }
  if (responsible.error) throw responsible.error;
  if (associates.error) throw associates.error;
  // Só tokens no formato do link (24 base62): nada que possa virar curinga no filtro de texto.
  const tokens = [...new Set((presentations.data || []).map((row) => row.token).filter((token) => /^[A-Za-z0-9]{22,64}$/.test(token || "")))];
  if (!tokens.length) return false;
  const teamIds = [...new Set([responsibleId, responsible.data?.manager_id, responsible.data?.linked_broker_id, ...(associates.data || []).map((row) => row.id)].filter(Boolean))];
  const tokenFilter = tokens.flatMap((token) => [`body.ilike.%/s/${token}%`, `metadata->link->>url.ilike.%/s/${token}%`]).join(",");
  const { data, error } = await db().from("whatsapp_messages")
    .select("id")
    .in("session_user_id", teamIds)
    .eq("direction", "outbound")
    .neq("status", "failed")
    .or(tokenFilter)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// Painel da apresentação (dono, 2026-10-19): há prova de envio? E quando o link foi copiado pela última vez? "Copiado" é só
// informativo — nunca conta como envio (a prova continua sendo `loadSimulationSentEvidence`).
export async function loadPresentationSendState(clientId) {
  if (!clientId) return { sent: false, copiedAt: "" };
  const [evidence, copied] = await Promise.all([
    loadSimulationSentEvidence(clientId),
    db().from("client_journey_events").select("occurred_at").eq("client_id", clientId).eq("event_type", PRESENTATION_LINK_COPIED_EVENT).order("occurred_at", { ascending: false }).limit(1)
  ]);
  if (copied.error) throw copied.error;
  return { sent: evidence.sent === true, copiedAt: copied.data?.[0]?.occurred_at || "" };
}

// Barreira no SERVIDOR para mudança MANUAL de status (quem chama passa o `auth` do usuário). Mudanças automáticas sem
// usuário (automações do CRM) não passam por aqui.
export async function assertManualSimulationSentAllowed({ clientId, currentStatus, nextStatus, auth }) {
  const profile = auth?.profile;
  if (!shouldBlockManualSimulationSent({ currentStatus, nextStatus, profile, evidenceSent: false })) return;
  const evidence = clientId ? await loadSimulationSentEvidence(clientId) : { sent: false };
  if (shouldBlockManualSimulationSent({ currentStatus, nextStatus, profile, evidenceSent: evidence.sent })) throw new SimulationSentLockError();
}
