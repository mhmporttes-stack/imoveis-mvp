import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { clientMatchesContactPhone } from "./contact-client-link.mjs";
import { isOptOutMessage } from "./daily-goal-auto-core.mjs";
import { recordClientStatusChange } from "./client-status-history";
import { clientDoNotContactPatch, contactDoNotContactPatch } from "./do-not-contact-core.mjs";
import { CLIENT_STATUS } from "./client-status";
import { markClientsInServiceOnReply } from "./whatsapp-client-status";
import { applyResponsibleUserScope } from "./admin-access";
import { getActingAdminEmail } from "./admin-auth";
import { ALERT_KIND, REPLY_ACTION, decideProspectingReplyAction, isAlertStillValid, pickAlertBroker, replyPreview } from "./prospecting-reply-core.mjs";

// Automação de RESPOSTA À PROSPECÇÃO (pedido do dono, 2026-10-02) — consumidor
// do evento de mensagem recebida do WhatsApp conectado por QR, INDEPENDENTE do
// Chat: não lê nem depende de whatsapp_messages/whatsapp_conversations, tem a
// própria idempotência (whatsapp_inbound_events) e roda mesmo se a gravação
// no Chat falhar (ver app/api/webhooks/whatsapp-individual/route.js).
// Regras puras e testadas em lib/prospecting-reply-core.mjs.

const OPT_OUT_CONFIRMATION = "Combinado! Você não vai mais receber mensagens automáticas nossas. Se precisar de algo, é só chamar por aqui. 🙂";
const SYSTEM_ACTOR = "sistema";

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

// Idempotência: true = processar; false = este wa_message_id já foi
// processado pela Prospecção (reentrega, replay de reconexão).
async function claimInboundEvent({ waMessageId, userId, phone, messageAt }) {
  if (!waMessageId) return true;
  const { error } = await db().from("whatsapp_inbound_events").insert({
    wa_message_id: waMessageId,
    session_user_id: userId || null,
    phone_normalized: phone,
    message_at: messageAt
  });
  if (!error) return true;
  if (error.code !== "23505") throw error;
  const existing = await run(db().from("whatsapp_inbound_events").select("prospecting_processed_at").eq("wa_message_id", waMessageId).maybeSingle());
  // Linha existe mas o processamento anterior não terminou (erro no meio):
  // tenta de novo — cada passo abaixo é seguro de repetir.
  return !existing?.prospecting_processed_at;
}

async function finishInboundEvent(waMessageId, outcome) {
  if (!waMessageId) return;
  await run(db().from("whatsapp_inbound_events").update({ prospecting_outcome: outcome, prospecting_processed_at: new Date().toISOString() }).eq("wa_message_id", waMessageId));
}

const CONTACT_COLUMNS = "id, status, assigned_user_id, last_broker_id, last_attempt_at, registration_id, phone_normalized";

async function loadContacts(candidates, registrationId = null) {
  const byPhone = await run(db().from("prospecting_contacts").select(CONTACT_COLUMNS).in("phone_normalized", candidates));
  const rows = [...(byPhone || [])];
  if (registrationId) {
    // Linhas irmãs: mesma pessoa com outro telefone na fila (mesmo cadastro).
    const siblings = await run(db().from("prospecting_contacts").select(CONTACT_COLUMNS).eq("registration_id", registrationId));
    for (const row of siblings || []) if (!rows.some((item) => item.id === row.id)) rows.push(row);
  }
  return rows;
}

// Cliente da mensagem: o cadastro vinculado ao contato da fila, se o telefone
// for mesmo o dele (regra P-01, lib/contact-client-link.mjs); senão o cadastro
// mais recente com esse telefone. Nunca cria cliente aqui.
async function resolveClient(phone, contacts) {
  const linkedIds = [...new Set(contacts.map((contact) => contact.registration_id).filter(Boolean))];
  if (linkedIds.length) {
    const linked = await run(db().from("simulation_registrations").select("id, full_name, status, responsible_user_id, phone_normalized").in("id", linkedIds));
    const match = (linked || []).find((client) => clientMatchesContactPhone(client.phone_normalized, phone));
    if (match) return match;
  }
  const latestId = (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
  if (!latestId) return null;
  return run(db().from("simulation_registrations").select("id, full_name, status, responsible_user_id, phone_normalized").eq("id", latestId).maybeSingle());
}

async function cancelPendingAutoQueue(contactIds, reason) {
  if (!contactIds.length) return;
  await run(db().from("daily_goal_auto_queue")
    .update({ status: "canceled", skip_reason: reason, updated_at: new Date().toISOString() })
    .in("contact_id", contactIds).eq("status", "pending"));
}

async function logContactHistory(rows) {
  if (!rows.length) return;
  const { error } = await db().from("prospecting_history").insert(rows);
  if (error) console.warn("Falha ao registrar histórico da prospecção (resposta):", error.message);
}

// Cliente respondeu: a cadência de tentativas termina AQUI (sem 2ª/3ª
// tentativa, sem envio automático). A rodada da Meta Diária fica "converted"
// — a meta do dia continua batendo igual. O cliente passa para "Em atendimento"
// logo em seguida (ver processProspectingInboundReply); a pendência manual só
// existe como rede de segurança quando não há corretor responsável.
async function stopCadenceOnReply(contacts, clientId, brokerId) {
  const contactIds = contacts.map((contact) => contact.id);
  if (!contactIds.length) return;
  const now = new Date().toISOString();
  const rounds = await run(db().from("daily_goal_rounds").select("id, prospecting_contact_id, attempt_count").in("prospecting_contact_id", contactIds).eq("status", "active"));
  for (const round of rounds || []) {
    await run(db().from("daily_goal_rounds").update({ status: "converted", converted_attempt: round.attempt_count || 0, converted_at: now }).eq("id", round.id).eq("status", "active"));
  }
  await cancelPendingAutoQueue(contactIds, "lead_respondeu");
  await logContactHistory((rounds || []).map((round) => ({ contact_id: round.prospecting_contact_id, registration_id: clientId, user_id: brokerId || null, event_type: "daily_goal_converted", details: { attempt: round.attempt_count, reason: "client_replied_whatsapp" } })));
}

async function upsertAlert({ clientId, contactId, brokerId, sessionUserId, kind, messageAt, preview }) {
  const rows = await run(db().rpc("upsert_prospecting_reply_alert", {
    p_client_id: clientId,
    p_contact_id: contactId || null,
    p_broker_id: brokerId || null,
    p_session_user_id: sessionUserId || null,
    p_kind: kind,
    p_message_at: messageAt,
    p_preview: preview
  }));
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { alertId: row?.alert_id || null, created: Boolean(row?.created) };
}

async function notifyBroker(brokerId, { title, body, url = "/admin/simulacoes?prospectingReplies=1" }) {
  if (!brokerId) return;
  try {
    const { sendPushToUser } = await import("./push-subscriptions");
    await sendPushToUser(brokerId, { title, body, url, tag: `prospecting-reply:${brokerId}` });
  } catch (error) {
    console.warn("Falha ao avisar o corretor sobre a resposta da prospecção:", error?.message || error);
  }
}

async function pingScreens() {
  try {
    const { broadcastChatChanged } = await import("./whatsapp-chat");
    await broadcastChatChanged();
  } catch {
    // Best-effort: o contador também atualiza no polling de segurança.
  }
}

async function applyAutomaticOptOut({ client, contacts, phone, body, messageAt, waMessageId, userId }) {
  const now = new Date().toISOString();
  // Condicionado ao status lido: se alguém mudou o cliente no meio do
  // caminho, a mudança humana vale.
  const updated = await run(db().from("simulation_registrations")
    .update(clientDoNotContactPatch(now))
    .eq("id", client.id).eq("status", client.status)
    .select("id").maybeSingle());
  if (updated) {
    await recordClientStatusChange({ supabase: db(), clientId: client.id, previousStatus: client.status, newStatus: CLIENT_STATUS.DO_NOT_CONTACT, changedAt: now, changedBy: SYSTEM_ACTOR, source: "whatsapp_opt_out" });
  }

  // Todas as linhas da fila da mesma pessoa (telefone OU mesmo cadastro):
  // ninguém pode voltar a reivindicá-la nem a automação enviar de novo.
  // O corretor responsável e quem estava com o contato NÃO mudam.
  const contactIds = contacts.map((contact) => contact.id);
  if (contactIds.length) {
    await run(db().from("prospecting_contacts").update(contactDoNotContactPatch(now)).in("id", contactIds).neq("status", "do_not_contact"));
    const rounds = await run(db().from("daily_goal_rounds").select("id, prospecting_contact_id, attempt_count").in("prospecting_contact_id", contactIds).eq("status", "active"));
    if (rounds?.length) {
      await run(db().from("daily_goal_rounds").update({ status: "ended_no_conversion", ended_at: now }).in("id", rounds.map((round) => round.id)).eq("status", "active"));
    }
    await cancelPendingAutoQueue(contactIds, "opt_out_whatsapp");
    await logContactHistory([
      ...contacts.map((contact) => ({ contact_id: contact.id, registration_id: client.id, user_id: null, event_type: "do_not_contact", details: { source: "whatsapp_auto_opt_out", reasonKey: "client_requested" } })),
      ...(rounds || []).map((round) => ({ contact_id: round.prospecting_contact_id, registration_id: client.id, user_id: null, event_type: "daily_goal_round_ended", details: { attempt: round.attempt_count, reason: "whatsapp_opt_out" } }))
    ]);
  }

  // Pendência que já estivesse aberta (cliente mandou "oi" e depois "parar")
  // se resolve sozinha: o cliente já foi classificado.
  await run(db().from("prospecting_reply_alerts").update({ status: "resolved", resolution: "auto_opt_out", resolved_at: now, updated_at: now }).eq("client_id", client.id).eq("status", "open"));

  const { error: logError } = await db().from("daily_goal_do_not_contact_log").insert({
    client_id: client.id,
    contact_id: contacts[0]?.id || null,
    broker_id: client.responsible_user_id || null,
    reason_key: "client_requested",
    reason_text: "Opt-out automático: o cliente pediu pelo WhatsApp para parar o contato.",
    executed_by: null,
    origin: "whatsapp_auto_opt_out",
    message_text: replyPreview(body),
    message_at: messageAt,
    session_user_id: userId || null,
    wa_message_id: waMessageId || null
  });
  if (logError) console.warn("Falha ao registrar o opt-out automático no log:", logError.message);
  return { clientId: client.id, phoneLast4: phone.slice(-4) };
}

// Comportamento que já existia (2026-09-29) e continua igual: palavra exata de
// descadastro (PARAR/SAIR/CANCELAR...) marca as linhas da fila como "não
// contactar" e confirma pela mesma sessão que recebeu. Agora roda aqui, no
// consumidor da Prospecção, e não mais dentro da gravação do Chat.
async function applyLegacyKeywordOptOut({ contacts, phone, body, userId }) {
  if (!isOptOutMessage(body)) return false;
  const active = contacts.filter((contact) => contact.status !== "do_not_contact");
  if (!active.length) return false;
  const now = new Date().toISOString();
  await run(db().from("prospecting_contacts").update({ status: "do_not_contact", do_not_contact_at: now, updated_at: now }).in("id", active.map((contact) => contact.id)));
  if (userId) {
    try {
      const { sendIndividualMessage } = await import("./whatsapp-individual");
      await sendIndividualMessage(userId, { to: phone, text: OPT_OUT_CONFIRMATION });
    } catch (confirmError) {
      console.warn("Falha ao confirmar o descadastro (WhatsApp individual):", confirmError?.message || confirmError);
    }
  }
  return true;
}

// { userId, from, text, waMessageId, at, fromMe } -> { outcome, ... }
export async function processProspectingInboundReply({ userId = "", from = "", text = "", waMessageId = "", at = "", fromMe = false }) {
  // Mensagem do próprio corretor (app ou CRM) nunca é resposta do cliente.
  if (fromMe) return { outcome: "mensagem_do_corretor" };
  const phone = canonicalWhatsappPhone(from);
  if (!phone) return { outcome: "telefone_invalido" };
  const body = String(text || "").trim();
  if (!body) return { outcome: "mensagem_vazia" };
  // Mensagem de alguém da EQUIPE nunca é "resposta de cliente" (regra do
  // dono, 2026-10-02): sem pendência, conversão, opt-out nem pontuação.
  if (await findInternalTeamPhone(phone)) return { outcome: "numero_da_equipe" };
  const messageAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();
  const cleanWaMessageId = String(waMessageId || "").trim();

  if (!(await claimInboundEvent({ waMessageId: cleanWaMessageId, userId, phone, messageAt }))) {
    return { outcome: "duplicado" };
  }

  const candidates = phoneLookupCandidates(phone);
  const phoneContacts = await loadContacts(candidates);
  const client = await resolveClient(phone, phoneContacts);
  const contacts = client ? await loadContacts(candidates, client.id) : phoneContacts;

  // Qualquer resposta de verdade cancela os envios automáticos ainda
  // pendentes desse telefone (comportamento de 2026-09-29, mantido).
  await cancelPendingAutoQueue(phoneContacts.map((contact) => contact.id), "lead_respondeu");

  const action = decideProspectingReplyAction({ fromMe, clientId: client?.id || "", clientStatus: client?.status || "", contacts, messageAt, text: body });
  const legacyOptOut = await applyLegacyKeywordOptOut({ contacts, phone, body, userId });
  let outcome = action;

  if (action === REPLY_ACTION.OPT_OUT) {
    await applyAutomaticOptOut({ client, contacts, phone, body, messageAt, waMessageId: cleanWaMessageId, userId });
    await pingScreens();
  } else if (action === REPLY_ACTION.ALERT_REPLY) {
    const brokerId = pickAlertBroker({ responsibleUserId: client.responsible_user_id, contacts, sessionUserId: userId });
    await stopCadenceOnReply(contacts, client.id, brokerId);
    // Regra do dono, 2026-10-02 (substitui a pendência manual): a resposta
    // promove o cliente a "Em atendimento" sozinha, no nome do corretor
    // responsável (mesmo marco de atendimento da pontuação). Sem corretor
    // responsável (ou se o status mudou no meio do caminho) nada é promovido:
    // cai na pendência "Cliente respondeu — atualizar status" de antes, para a
    // resposta nunca se perder.
    const changes = await markClientsInServiceOnReply([client.id], { includeProspected: true });
    if (changes.length) {
      await run(db().from("prospecting_reply_alerts").update({ status: "resolved", resolution: "auto_in_service", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("client_id", client.id).eq("kind", ALERT_KIND.REPLY).eq("status", "open"));
      await notifyBroker(brokerId, { title: "Cliente respondeu — em atendimento", body: `${client.full_name || "Cliente"}: ${replyPreview(body)}`, url: "/admin/chat" });
      outcome = "in_service_auto";
    } else {
      const alert = await upsertAlert({ clientId: client.id, contactId: contacts[0]?.id, brokerId, sessionUserId: userId, kind: ALERT_KIND.REPLY, messageAt, preview: replyPreview(body) });
      if (alert.created) await notifyBroker(brokerId, { title: "Cliente respondeu — atualizar status", body: `${client.full_name || "Cliente"}: ${replyPreview(body)}` });
    }
    await pingScreens();
  } else if (action === REPLY_ACTION.ALERT_REACTIVATION) {
    const brokerId = pickAlertBroker({ responsibleUserId: client.responsible_user_id, contacts, sessionUserId: userId });
    const alert = await upsertAlert({ clientId: client.id, contactId: contacts[0]?.id, brokerId, sessionUserId: userId, kind: ALERT_KIND.REACTIVATION, messageAt, preview: replyPreview(body) });
    if (alert.created) await notifyBroker(brokerId, { title: "Cliente em Não contactar mandou mensagem", body: `${client.full_name || "Cliente"}: ${replyPreview(body)}` });
    await pingScreens();
  } else if (legacyOptOut) {
    outcome = "opt_out_fila";
  }

  await finishInboundEvent(cleanWaMessageId, outcome);
  return { outcome, clientId: client?.id || null };
}

// ---------------------------------------------------------------------------
// Pendências "Respostas da prospecção" (tela e contadores)
// ---------------------------------------------------------------------------

const ALERT_COLUMNS = "id, client_id, contact_id, broker_id, kind, message_count, first_message_at, last_message_at, last_message_preview";

// Pendências abertas visíveis para quem pergunta (mesmo escopo por
// responsável das demais pendências do CRM). Pendência cujo cliente já mudou
// de situação por outro caminho é encerrada aqui mesmo (resolução
// "status_changed") e não aparece.
export async function listOpenProspectingReplies(auth) {
  let query = db().from("prospecting_reply_alerts").select(ALERT_COLUMNS).eq("status", "open").order("last_message_at", { ascending: false }).limit(200);
  query = applyResponsibleUserScope(query, auth, "broker_id", "");
  const alerts = await run(query);
  if (!alerts?.length) return [];

  const clientIds = [...new Set(alerts.map((alert) => alert.client_id))];
  const brokerIds = [...new Set(alerts.map((alert) => alert.broker_id).filter(Boolean))];
  const [clients, brokers] = await Promise.all([
    run(db().from("simulation_registrations").select("id, full_name, phone_normalized, status, responsible_user_id").in("id", clientIds)),
    brokerIds.length ? run(db().from("admin_users").select("id, name").in("id", brokerIds)) : []
  ]);
  const clientById = new Map((clients || []).map((client) => [client.id, client]));
  const brokerName = new Map((brokers || []).map((broker) => [broker.id, broker.name]));

  const stale = alerts.filter((alert) => !isAlertStillValid(alert.kind, clientById.get(alert.client_id)?.status || ""));
  if (stale.length) {
    const now = new Date().toISOString();
    await run(db().from("prospecting_reply_alerts").update({ status: "resolved", resolution: "status_changed", resolved_at: now, updated_at: now }).in("id", stale.map((alert) => alert.id)).eq("status", "open"));
  }

  return alerts
    .filter((alert) => !stale.includes(alert))
    .map((alert) => {
      const client = clientById.get(alert.client_id);
      return {
        id: alert.id,
        kind: alert.kind,
        clientId: alert.client_id,
        clientName: client?.full_name || "Cliente",
        phone: client?.phone_normalized || "",
        clientStatus: client?.status || "",
        brokerId: alert.broker_id || "",
        brokerName: brokerName.get(alert.broker_id) || "",
        messageCount: alert.message_count,
        firstMessageAt: alert.first_message_at,
        lastMessageAt: alert.last_message_at,
        preview: alert.last_message_preview || ""
      };
    });
}

export async function countOpenProspectingReplies(auth) {
  return (await listOpenProspectingReplies(auth)).length;
}

const ACTIONS_BY_KIND = {
  [ALERT_KIND.REPLY]: new Set(["start_service", "do_not_contact"]),
  [ALERT_KIND.REACTIVATION]: new Set(["reactivate", "keep_do_not_contact"])
};

// Botões da pendência. Mudança de status pela MESMA função da ficha do
// cliente (updateSimulationRegistration: histórico de status, pontuação,
// permissão por responsável); "Não tem interesse" também passa pelo registro
// de motivo + trava anti-abuso de sempre (recordDoNotContactAudit).
export async function resolveProspectingReply(alertId, action, auth, payload = {}) {
  const alert = await run(db().from("prospecting_reply_alerts").select("id, client_id, contact_id, broker_id, kind, status").eq("id", alertId).maybeSingle());
  if (!alert) throw new Error("Pendência não encontrada.");
  if (alert.status !== "open") throw new Error("Esta pendência já foi resolvida.");
  if (!ACTIONS_BY_KIND[alert.kind]?.has(action)) throw new Error("Ação inválida para esta pendência.");

  const { getSimulationRegistration, updateSimulationRegistration } = await import("./simulation-registrations");
  // Lê com o escopo de quem clicou: corretor só resolve pendência de cliente seu.
  const registration = await getSimulationRegistration(alert.client_id, auth);
  if (!registration) throw new Error("Cliente não encontrado.");
  const adminEmail = getActingAdminEmail(auth);

  if (action === "start_service" || action === "reactivate") {
    await updateSimulationRegistration(alert.client_id, { status: CLIENT_STATUS.IN_SERVICE, adminEmail, statusSource: "prospecting_reply" }, auth);
  } else if (action === "do_not_contact") {
    const { recordDoNotContactAudit } = await import("./daily-goal-wallet");
    await recordDoNotContactAudit({
      clientId: alert.client_id,
      contactId: alert.contact_id || null,
      brokerId: registration.responsibleUserId || null,
      reasonKey: payload.reasonKey || "not_interested",
      reasonText: payload.reasonText || "",
      executedBy: auth.profile.id,
      origin: "prospecting_reply"
    });
    await updateSimulationRegistration(alert.client_id, { status: CLIENT_STATUS.DO_NOT_CONTACT, adminEmail, statusSource: "prospecting_reply" }, auth);
    const contacts = await loadContacts(phoneLookupCandidates(registration.phoneNormalized || ""), alert.client_id);
    const contactIds = contacts.map((contact) => contact.id);
    if (contactIds.length) {
      const now = new Date().toISOString();
      await run(db().from("prospecting_contacts").update(contactDoNotContactPatch(now, auth.profile.id)).in("id", contactIds).neq("status", "do_not_contact"));
      await cancelPendingAutoQueue(contactIds, "nao_tem_interesse");
    }
  }

  const now = new Date().toISOString();
  await run(db().from("prospecting_reply_alerts").update({ status: "resolved", resolution: action, resolved_by: auth.profile.id, resolved_at: now, updated_at: now }).eq("id", alert.id).eq("status", "open"));
  await pingScreens();
  return { ok: true, clientId: alert.client_id, action };
}

// Usado pela devolução automática da fila: cliente com pendência de resposta
// aberta NUNCA volta para a fila nem perde o responsável enquanto o corretor
// não classificar a resposta.
export async function listClientIdsWithOpenReplyAlert(clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const { data: rows, error } = await db().from("prospecting_reply_alerts").select("client_id").in("client_id", ids).eq("status", "open");
  if (error) {
    // Tabela ainda não migrada (ou falha pontual): não bloqueia a devolução
    // da fila de sempre — só perde a proteção extra desta vez.
    console.warn("Falha ao ler pendências de resposta da prospecção:", error.message);
    return new Set();
  }
  return new Set((rows || []).map((row) => row.client_id));
}
