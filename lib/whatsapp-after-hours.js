import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { findConversationByPhone, findDoNotContactInboundBlock } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { buildOutgoing, directSimulationLink } from "./whatsapp-flow-core.mjs";
import { AFTER_HOURS_BUTTON_LABEL, AFTER_HOURS_MESSAGE_TYPES, AFTER_HOURS_REPLY_KIND, buildAfterHoursText, closedPeriod, decideAfterHoursReply } from "./whatsapp-after-hours-core.mjs";

// RESPOSTA FORA DO HORÁRIO no número Oficial (regra do dono, 2026-10-12). Regras puras em lib/whatsapp-after-hours-core.mjs.
// Chamado pelo webhook (lib/whatsapp-master.js) num laço próprio, DEPOIS do "pare" (B12), da roleta, dos Fluxos e da
// palavra-chave — por isso a mensagem que o Fluxo acabou de responder já conta como "automação no período". Só o número
// Oficial (o webhook da Meta é só dele). "Uma vez por período" sem tabela nova: reserva
// `after-hours:<conversa>:<início do período>` em whatsapp_messages.meta_message_id ANTES de enviar
// (sendReservedAutomationMessage, mesmo padrão do lembrete do formulário). Erro = não envia.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function replyToEvent(event, now) {
  const phone = event.sender_phone;
  const conversation = await findConversationByPhone(phone, "id, contact_phone, contact_name, client_id, status, deleted_at, private_at, last_human_reply_at");
  if (!conversation?.id) return "sem_conversa";
  const period = closedPeriod(now);
  if (!period) return "dentro_do_horario";
  const candidates = phoneLookupCandidates(phone);
  const [client, phoneRegistrations, automation, teamPhone, doNotContactReason] = await Promise.all([
    conversation.client_id
      ? run(db().from("simulation_registrations").select("id, full_name, status, last_form_submitted_at, journey_type, private_contact_at, responsible_user_id, distribution_type").eq("id", conversation.client_id).maybeSingle())
      : Promise.resolve(null),
    candidates.length ? run(db().from("simulation_registrations").select("last_form_submitted_at, journey_type").in("phone_normalized", candidates).limit(20)) : Promise.resolve([]),
    // Qualquer mensagem automática (Fluxo, palavra-chave, lembrete, resposta fora do horário — inclusive a reserva em
    // andamento) nesta conversa desde o início do período fechado.
    run(db().from("whatsapp_messages").select("id").eq("conversation_id", conversation.id).eq("direction", "outbound").eq("sender_type", "automation")
      .neq("status", "failed").gte("message_at", period.start.toISOString()).limit(1)),
    findInternalTeamPhone(phone),
    findDoNotContactInboundBlock(phone, conversation.client_id || null)
  ]);
  const decision = decideAfterHoursReply({
    messageType: event.message_type,
    conversation,
    client,
    phoneRegistrations: phoneRegistrations || [],
    automationInPeriod: Boolean((automation || []).length),
    isTeamPhone: Boolean(teamPhone),
    doNotContactReason
  }, now);
  if (decision.action !== "send") return decision.reason;

  const text = buildAfterHoursText(client?.full_name || conversation.contact_name || "", { formFilled: !decision.withButton });
  let linkUrl = "";
  if (decision.withButton) {
    // Mesmo link dos Fluxos: corretor responsável ativo; segurado do anúncio/sem responsável → /s genérico.
    const { formLinkResponsibleId, resolveFormLink } = await import("./whatsapp-flows");
    linkUrl = directSimulationLink((await resolveFormLink(formLinkResponsibleId(client))).link);
  }
  const outgoing = buildOutgoing({ id: "after-hours", type: "message", data: decision.withButton
    ? { mode: "link", text, linkLabel: AFTER_HOURS_BUTTON_LABEL, linkUrl }
    : { mode: "text", text } }, {});
  const { sendReservedAutomationMessage } = await import("./whatsapp-form-reminder");
  const { sendWhatsappMessagePayload } = await import("./whatsapp-master");
  return sendReservedAutomationMessage({
    conversationId: conversation.id,
    claimKey: decision.claimKey,
    text: outgoing.display.text,
    metadata: { kind: AFTER_HOURS_REPLY_KIND, period_start: decision.periodStart.toISOString(), buttons: [], ...(outgoing.display.link ? { link: outgoing.display.link } : {}) },
    logLabel: "[fora-do-horario]",
    send: () => sendWhatsappMessagePayload({ to: conversation.contact_phone, message: outgoing.message })
  });
}

// Webhook: mensagens NOVAS (já deduplicadas, sem as de quem pediu para parar). Sequencial: a 2ª mensagem do mesmo
// cliente no mesmo webhook encontra a reserva da 1ª ("automação no período") e não responde de novo.
export async function processAfterHoursReplies(events = [], now = new Date()) {
  if (!closedPeriod(now)) return [];
  const results = [];
  for (const event of events || []) {
    if (event.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    if (!AFTER_HOURS_MESSAGE_TYPES.has(String(event.message_type || ""))) continue;
    try {
      const outcome = await replyToEvent(event, now);
      console.info(JSON.stringify({ source: "whatsapp-after-hours", event: outcome, messageId: event.message_id }));
      results.push(outcome);
    } catch (error) {
      console.error("Falha na resposta fora do horário do WhatsApp:", error?.message || error);
    }
  }
  return results;
}
