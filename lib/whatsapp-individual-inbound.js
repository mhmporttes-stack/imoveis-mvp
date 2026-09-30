import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { markClientsInServiceOnReply } from "./whatsapp-client-status";
import { markConversationHumanReply } from "./whatsapp-attendance";
import { sendPushToUser } from "./push-subscriptions";
import { broadcastChatChanged, getUnreadMessageCountForBroker } from "./whatsapp-chat";
import { isOptOutMessage } from "./daily-goal-auto-core.mjs";
import { sendIndividualMessage } from "./whatsapp-individual";

// Mensagem recebida pela sessão INDIVIDUAL (Baileys, WhatsApp pessoal do
// corretor) — projeta no MESMO Chat (whatsapp_conversations/whatsapp_messages)
// que o número oficial usa, só marcando channel/session_user_id diferentes.
// client_id do CRM continua sendo a identidade principal: aqui só decide em
// QUAL conversa a mensagem entra.
//
// Contato NOVO (ainda sem client_id): diferente do número oficial (que
// sorteia na roleta geral), aqui o cliente é SEMPRE do corretor dono da
// sessão — a mensagem chegou no celular pessoal dele, não faz sentido
// mandar para outro corretor por sorteio.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function previewForText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140) || "[Mensagem]";
}

const CONVERSATION_COLUMNS = "id, contact_name, client_id, assigned_user_id, deleted_at, origin, last_message_at, account_channel";

async function findOrCreateConversation(phone) {
  const candidates = phoneLookupCandidates(phone);
  const { data: existing, error } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("contact_phone", candidates)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  if (existing?.[0]) return existing[0];

  const { error: upsertError } = await db()
    .from("whatsapp_conversations")
    .upsert({ contact_phone: phone }, { onConflict: "contact_phone", ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data: refetched, error: refetchError } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("contact_phone", candidates)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (refetchError) throw refetchError;
  return refetched?.[0] || null;
}

async function alreadyRecorded(conversationId, cleanWaMessageId) {
  if (!cleanWaMessageId) return false;
  const { data } = await db()
    .from("whatsapp_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("channel", "whatsapp_individual")
    .eq("metadata->>wa_message_id", cleanWaMessageId)
    .maybeSingle();
  return Boolean(data?.id);
}

// Mensagem que o corretor mandou pelo APLICATIVO OFICIAL do WhatsApp (não
// pelo Chat) — o WhatsApp ecoa pra cá por ser um dispositivo conectado.
// Só REGISTRA (já foi enviada de verdade): mesma atualização de
// última-mensagem/ordem/status que sendChatMessage faz, sem reenviar nada.
// Reaproveita whatsapp_chat_apply_outbound (mesma função do envio pelo
// Chat) — não inventa lógica nova.
async function recordBrokerAppMessage({ userId, conversation, phone, body, messageAt, cleanWaMessageId }) {
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) {
    return { conversationId: conversation.id, duplicate: true };
  }

  const { data: broker } = await db().from("admin_users").select("name").eq("id", userId).maybeSingle();

  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: userId,
    sent_by_name: broker?.name || "",
    channel: "whatsapp_individual",
    session_user_id: userId,
    message_type: "text",
    body,
    metadata: cleanWaMessageId ? { wa_message_id: cleanWaMessageId } : {},
    status: "sent",
    sent_at: messageAt,
    message_at: messageAt
  });
  if (insertError) {
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }

  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: conversation.id,
    p_at: messageAt,
    p_preview: previewForText(body),
    p_mark_in_service: true
  });
  if (rpcError) throw rpcError;

  await markConversationHumanReply(conversation.id);
  try {
    const { endLiveFlowSession } = await import("./whatsapp-flows");
    await endLiveFlowSession(phone, "atendente_assumiu");
  } catch (flowError) {
    console.warn("Falha ao encerrar o fluxo automático (mensagem via app oficial):", flowError?.message || flowError);
  }

  // Conversa sem responsável: quem está com o WhatsApp conectado no celular
  // e respondeu é o responsável, sem ambiguidade.
  if (!conversation.assigned_user_id) {
    await db().from("whatsapp_conversations").update({ assigned_user_id: userId, updated_at: new Date().toISOString() }).eq("id", conversation.id);
  }

  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

// { userId, from, text, waMessageId, at, contactName, fromMe } -> { conversationId, duplicate, skipped }
export async function projectIndividualInboundMessage({ userId, from, text, waMessageId = "", at = "", contactName = "", fromMe = false }) {
  const phone = canonicalWhatsappPhone(from);
  if (!phone) return { skipped: "telefone_invalido" };
  const body = String(text || "").trim();
  if (!body) return { skipped: "mensagem_vazia" };

  const conversation = await findOrCreateConversation(phone);
  if (!conversation?.id) return { skipped: "conversa_nao_criada" };

  const messageAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();
  const cleanWaMessageId = String(waMessageId || "").trim();

  if (fromMe) {
    if (!userId) return { skipped: "sem_corretor" };
    return recordBrokerAppMessage({ userId, conversation, phone, body, messageAt, cleanWaMessageId });
  }

  // Idempotência: o microsserviço pode reentregar o mesmo evento (retry de
  // rede) — o índice único parcial (channel, metadata->>'wa_message_id')
  // garante isso no banco; aqui só evita trabalho repetido (RPC, push, roleta).
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) {
    return { conversationId: conversation.id, duplicate: true };
  }

  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: "inbound",
    sender_type: "customer",
    channel: "whatsapp_individual",
    session_user_id: userId || null,
    message_type: "text",
    body,
    metadata: cleanWaMessageId ? { wa_message_id: cleanWaMessageId } : {},
    status: "received",
    message_at: messageAt
  });
  if (insertError) {
    // 23505 = violação do índice único parcial (mesma mensagem reentregue no
    // exato instante de uma corrida concorrente) — trata como duplicata, não como falha.
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }

  const clientId = (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_inbound", {
    p_conversation_id: conversation.id,
    p_count: 1,
    p_at: messageAt,
    p_preview: previewForText(body),
    p_name: contactName || null,
    p_client_id: clientId,
    p_origin: null
  });
  if (rpcError) throw rpcError;

  if (clientId) {
    try {
      await markClientsInServiceOnReply([clientId]);
    } catch (statusError) {
      console.warn("Falha ao atualizar o status do cliente que respondeu (WhatsApp individual):", statusError?.message || statusError);
    }
  }

  // Mesma regra do canal oficial: só notifica quem já atende a conversa.
  if (conversation.assigned_user_id) {
    try {
      // "unreadCount" faltava aqui (bug real, 2026-09-29): o service worker só
      // atualiza o ícone do app quando o push traz esse número (ver
      // syncAppBadge em public/sw.js) — sem ele, o push chegava normalmente
      // mas o badge do ícone nunca era tocado. Como o canal individual virou
      // o caminho principal depois do número oficial banido, o ícone parou de
      // atualizar pra quase todo mundo. Mesma conta usada pelo canal oficial
      // (lib/whatsapp-chat.js).
      const unreadCount = await getUnreadMessageCountForBroker(conversation.assigned_user_id);
      await sendPushToUser(conversation.assigned_user_id, {
        title: contactName || phone,
        body: previewForText(body),
        url: "/admin/chat",
        tag: `whatsapp-chat:${conversation.assigned_user_id}`,
        unreadCount
      });
    } catch (pushError) {
      console.warn("Falha ao enviar push de mensagem nova (WhatsApp individual):", pushError?.message || pushError);
    }
  }

  // Contato ainda sem cliente vinculado: cria/vincula direto para o corretor
  // dono da sessão que recebeu a mensagem (nunca sorteia — a mensagem já
  // chegou no WhatsApp pessoal dele).
  if (!conversation.client_id && userId) {
    try {
      const { sanitizeContactFullName } = await import("./whatsapp-referral.mjs");
      const fullName = sanitizeContactFullName(contactName);
      const { error: assignError } = await db().rpc("whatsapp_get_or_create_client_for_broker", {
        p_candidates: phoneLookupCandidates(phone),
        p_full_name: fullName,
        p_phone: phone,
        p_phone_normalized: phone,
        p_broker_id: userId,
        p_context: {
          kind: "whatsapp_individual",
          label: "Contato direto no WhatsApp pessoal do corretor",
          actor: "sistema",
          destination: "corretor_dono_da_sessao"
        },
        p_conversation_id: conversation.id,
        p_history_details: { source: "whatsapp_individual", via: "contato_direto", conversationId: conversation.id, phoneLast4: phone.slice(-4) }
      });
      if (assignError) throw assignError;
    } catch (leadError) {
      console.error("Falha ao atribuir o contato direto do WhatsApp individual ao corretor:", leadError?.message || leadError);
    }
  }

  // Automação da Meta Diária (2026-09-29): qualquer resposta de verdade do
  // lead cancela os envios automáticos ainda pendentes dele — a partir daí é
  // um humano quem segue a conversa, nunca mais um disparo automático. Se o
  // texto for um pedido explícito de descadastro (PARAR/SAIR/CANCELAR...),
  // marca do_not_contact e confirma pela mesma sessão que recebeu a mensagem.
  await handleAutoQueueOnInboundReply(phone, body, userId);

  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

async function handleAutoQueueOnInboundReply(phone, body, userId) {
  try {
    const candidates = phoneLookupCandidates(phone);
    const { data: contacts, error } = await db().from("prospecting_contacts").select("id, status").in("phone_normalized", candidates);
    if (error) throw error;
    if (!contacts?.length) return;

    const contactIds = contacts.map((row) => row.id);
    const { error: cancelError } = await db().from("daily_goal_auto_queue")
      .update({ status: "canceled", skip_reason: "lead_respondeu", updated_at: new Date().toISOString() })
      .in("contact_id", contactIds).eq("status", "pending");
    if (cancelError) throw cancelError;

    if (!isOptOutMessage(body)) return;

    const activeIds = contacts.filter((row) => row.status !== "do_not_contact").map((row) => row.id);
    if (!activeIds.length) return;
    const now = new Date().toISOString();
    const { error: optOutError } = await db().from("prospecting_contacts")
      .update({ status: "do_not_contact", do_not_contact_at: now, updated_at: now })
      .in("id", activeIds);
    if (optOutError) throw optOutError;

    if (userId) {
      try {
        await sendIndividualMessage(userId, { to: phone, text: "Combinado! Você não vai mais receber mensagens automáticas nossas. Se precisar de algo, é só chamar por aqui. 🙂" });
      } catch (confirmError) {
        console.warn("Falha ao confirmar o descadastro (WhatsApp individual):", confirmError?.message || confirmError);
      }
    }
  } catch (error) {
    console.warn("Falha ao processar opt-out/cancelamento da fila automática (WhatsApp individual):", error?.message || error);
  }
}

// Confirmação de entrega/leitura de uma mensagem que o corretor mandou pela
// sessão individual (as "setinhas" do WhatsApp) — ver sessions.js:
// onMessagesUpdate. Acha a mensagem pelo mesmo wa_message_id usado no
// dedupe/idempotência (metadata->>wa_message_id).
export async function projectIndividualMessageStatus({ waMessageId, status }) {
  const cleanWaMessageId = String(waMessageId || "").trim();
  const now = new Date().toISOString();

  // server_ack (1 tique — chegou no servidor do WhatsApp) só importa pra
  // confirmar a fila da automação da Meta Diária (abaixo); o Chat nunca
  // mostrou esse estado intermediário, só delivered/read, então não mexe em
  // whatsapp_messages aqui.
  if (cleanWaMessageId && status === "server_ack") {
    const { data: queueRow, error: queueError } = await db()
      .from("daily_goal_auto_queue")
      .update({ delivered_at: now, updated_at: now })
      .eq("wa_message_id", cleanWaMessageId)
      .is("delivered_at", null)
      .select("id")
      .maybeSingle();
    if (queueError) throw queueError;
    return queueRow?.id ? { autoQueueId: queueRow.id } : { skipped: "item_nao_encontrado" };
  }

  if (!cleanWaMessageId || (status !== "delivered" && status !== "read")) return { skipped: "dados_invalidos" };

  const patch = { status };
  if (status === "delivered") patch.delivered_at = now;
  if (status === "read") { patch.delivered_at = patch.delivered_at || now; patch.read_at = now; }

  // "read" nunca regride pra "delivered" se já tiver chegado depois (mensagem
  // reentregue fora de ordem) — só avança o status, nunca volta.
  const { data, error } = await db()
    .from("whatsapp_messages")
    .update(patch)
    .eq("channel", "whatsapp_individual")
    .eq("metadata->>wa_message_id", cleanWaMessageId)
    .neq("status", "read")
    .select("id, conversation_id")
    .maybeSingle();
  if (error) throw error;
  if (data?.id) {
    await broadcastChatChanged();
    return { messageId: data.id };
  }

  // Não achou no Chat — tenta a fila da automação da Meta Diária (mensagens
  // automáticas nunca ganham linha em whatsapp_messages, só em
  // daily_goal_auto_queue). É a ÚNICA confirmação real de entrega que esse
  // fluxo tem hoje: sem isso, "sent" só significa que o Baileys devolveu um
  // ID, não que o WhatsApp confirmou o recebimento (achado real, 2026-09-30).
  const { data: queueRow, error: queueError } = await db()
    .from("daily_goal_auto_queue")
    .update({ delivered_at: patch.delivered_at, updated_at: now })
    .eq("wa_message_id", cleanWaMessageId)
    .is("delivered_at", null)
    .select("id")
    .maybeSingle();
  if (queueError) throw queueError;
  if (queueRow?.id) return { autoQueueId: queueRow.id };

  return { skipped: "mensagem_nao_encontrada_ou_ja_lida" };
}

// Histórico trazido do celular ao conectar (WhatsApp Web-like, pedido
// explícito do dono — inclusive conversas pessoais do corretor, cientes que
// isso é diferente do fluxo de mensagem NOVA acima). Só POPULA a conversa
// (mensagens + preview/ordem/conta) — nunca cria cliente novo no CRM, nunca
// manda notificação push, nunca soma não lida (é histórico, não novidade).
// { userId, from, text, waMessageId, at, contactName, fromMe }[] -> { processed }
export async function projectIndividualHistoryBatch(userId, items) {
  if (!userId || !Array.isArray(items) || !items.length) return { processed: 0 };

  const byPhone = new Map();
  for (const item of items) {
    const phone = canonicalWhatsappPhone(item?.from);
    const body = String(item?.text || "").trim();
    if (!phone || !body) continue;
    const messageAt = item.at && !Number.isNaN(new Date(item.at).getTime()) ? new Date(item.at).toISOString() : new Date().toISOString();
    const cleanWaMessageId = String(item.waMessageId || "").trim();
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push({ body, messageAt, cleanWaMessageId, fromMe: Boolean(item.fromMe) });
  }

  let processed = 0;
  for (const [phone, group] of byPhone) {
    group.sort((a, b) => new Date(a.messageAt) - new Date(b.messageAt));
    try {
      processed += await importHistoryForPhone(userId, phone, group);
    } catch (error) {
      console.error(`Falha ao importar histórico do WhatsApp individual (${phone}):`, error?.message || error);
    }
  }
  return { processed };
}

async function importHistoryForPhone(userId, phone, group) {
  const conversation = await findOrCreateConversation(phone);
  if (!conversation?.id) return 0;

  if (!conversation.client_id) {
    const clientId = (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
    if (clientId) await db().from("whatsapp_conversations").update({ client_id: clientId }).eq("id", conversation.id).is("client_id", null);
  }

  const rows = group.map((item) => ({
    conversation_id: conversation.id,
    direction: item.fromMe ? "outbound" : "inbound",
    sender_type: item.fromMe ? "user" : "customer",
    sender_user_id: item.fromMe ? userId : null,
    channel: "whatsapp_individual",
    session_user_id: userId,
    message_type: "text",
    body: item.body,
    metadata: item.cleanWaMessageId ? { wa_message_id: item.cleanWaMessageId, history: true } : { history: true },
    status: item.fromMe ? "sent" : "received",
    sent_at: item.fromMe ? item.messageAt : null,
    message_at: item.messageAt
  }));

  let inserted = 0;
  const { error: bulkError } = await db().from("whatsapp_messages").insert(rows);
  if (!bulkError) {
    inserted = rows.length;
  } else {
    // Provável conflito de dedupe (histórico reenviado numa reconexão) —
    // insere uma por uma pra não perder as que não colidem.
    for (const row of rows) {
      const { error } = await db().from("whatsapp_messages").insert(row);
      if (!error) inserted += 1;
      else if (error.code !== "23505") console.warn("Falha ao importar mensagem do histórico:", error.message);
    }
  }
  if (!inserted) return 0;

  const last = group[group.length - 1];
  const lastOutbound = [...group].reverse().find((item) => item.fromMe);
  const patch = { updated_at: new Date().toISOString() };
  if (!conversation.last_message_at || new Date(last.messageAt) >= new Date(conversation.last_message_at)) {
    patch.last_message_preview = previewForText(last.body);
    patch.last_message_direction = last.fromMe ? "outbound" : "inbound";
    patch.last_message_at = last.messageAt;
  }
  // Mesma regra do canal ao vivo: saída sempre atualiza a conta; entrada só
  // define se a conversa ainda não tinha nenhuma conta registrada.
  if (lastOutbound || !conversation.account_channel) {
    patch.account_channel = "whatsapp_individual";
    patch.account_user_id = userId;
  }
  await db().from("whatsapp_conversations").update(patch).eq("id", conversation.id);

  return inserted;
}
