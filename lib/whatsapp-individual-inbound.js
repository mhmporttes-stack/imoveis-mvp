import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { markClientsInServiceOnReply } from "./whatsapp-client-status";
import { findInternalTeamPhone } from "./internal-phones";
import { isAutomationEchoForBroker, registerHumanContact } from "./whatsapp-human-contact";
import { isFormReminderEcho } from "./whatsapp-form-reminder";
import { sendPushToUser } from "./push-subscriptions";
import { broadcastChatChanged, getUnreadMessageCountForBroker } from "./whatsapp-chat";
import { chatTypeForIndividualMedia } from "./whatsapp-message-actions.mjs";
import { isChatPushSuppressed, isWhatsappAccessBlocked } from "./whatsapp-access";
import { safeDownloadName } from "./whatsapp-media-utils.mjs";
import { isLidPlaceholder, lidPlaceholderFromJid } from "./whatsapp-lid-placeholder.mjs";
import { applyAutoPrivacy, isAutoPrivate } from "./whatsapp-auto-private";

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

const MEDIA_PREVIEW = { image: "[Imagem]", video: "[Vídeo]", gif: "[GIF]", sticker: "[Figurinha]", audio: "[Áudio]", document: "[Documento]" };

function previewForMessage(body, mediaKind) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 140);
  return MEDIA_PREVIEW[mediaKind] || "[Mensagem]";
}

// Mídia vinda do microsserviço (já guardada no Storage privado por URL
// assinada, ver app/api/webhooks/whatsapp-individual/media-upload) ->
// colunas da mensagem. O formato de metadata.media é o MESMO da mídia
// recebida pelo número oficial (status/bucket/path/mime/size/name), então a
// rota autenticada de mídia do Chat serve as duas sem diferença.
function mediaColumns(media, waMessageId) {
  if (!media?.kind) return { messageType: "text", metadataMedia: null, gif: false };
  const messageType = chatTypeForIndividualMedia(media.kind);
  const mime = String(media.mime || "").slice(0, 120);
  const stored = media.status === "stored" && media.bucket && media.path;
  return {
    messageType,
    gif: media.kind === "gif",
    metadataMedia: stored
      ? { status: "stored", bucket: media.bucket, path: media.path, mime, size: Number(media.size) || 0, source: "whatsapp_individual",
          name: safeDownloadName(media.fileName, `${media.kind}-${String(waMessageId || "").slice(0, 8)}`, mime),
          storedAt: new Date().toISOString(), attempts: 1, ptt: Boolean(media.ptt) }
      : { status: "failed", source: "whatsapp_individual", mime, error: String(media.error || "Mídia não recebida do WhatsApp.").slice(0, 300), attempts: 1, lastAttemptAt: new Date().toISOString() }
  };
}

function messageMetadata({ cleanWaMessageId, quotedId, quotedText, remoteJid, media }) {
  const metadata = {};
  if (cleanWaMessageId) metadata.wa_message_id = cleanWaMessageId;
  const quoted = String(quotedId || "").trim();
  if (quoted) metadata.reply_to_wa_id = quoted;
  // Trecho da mensagem citada vindo do próprio WhatsApp (fallback quando a original não está guardada).
  const preview = String(quotedText || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (quoted && preview) metadata.reply_to_preview = preview;
  if (remoteJid) metadata.remote_jid = String(remoteJid).slice(0, 120);
  if (media.metadataMedia) metadata.media = media.metadataMedia;
  if (media.gif) metadata.gif = true;
  return metadata;
}

const CONVERSATION_COLUMNS = "id, contact_name, client_id, assigned_user_id, deleted_at, origin, last_message_at, account_channel, session_key, session_slot, private_at, history_cutoff_at";
const OFFICIAL_SESSION_KEY = "00000000-0000-0000-0000-000000000000";

async function findSessionConversation(candidates, sessionKey, sessionSlot = 1) {
  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("contact_phone", candidates)
    .eq("session_key", sessionKey)
    .eq("session_slot", sessionSlot)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// A conversa é identificada por (telefone do contato + SESSÃO que conversa com
// ele): o mesmo cliente falando com o WhatsApp de dois corretores tem duas
// conversas, e a mensagem de um número nunca entra na do outro. Nunca procura
// só pelo telefone. Desde 2026-10-08 a sessão é (dono, número 1/2): o mesmo
// cliente falando com os dois números do MESMO corretor também tem duas conversas.
//
// Continuidade do lead: se este corretor ainda não tem conversa com o contato
// mas a conversa do número oficial (sem sessão) já está ATRIBUÍDA a ele, ela
// passa a ser a conversa do WhatsApp pessoal dele (mesmo histórico, mesmo
// cliente) em vez de abrir uma segunda.
async function findOrCreateConversation(phone, userId, sessionSlot = 1) {
  if (!userId) return null;
  // Número ainda não identificado (LID): só a própria conversa-marcador "lid:<id>" desta sessão.
  const candidates = isLidPlaceholder(phone) ? [phone] : phoneLookupCandidates(phone);
  const own = await findSessionConversation(candidates, userId, sessionSlot);
  if (own) return own;

  const { data: adoptable, error: adoptableError } = await db()
    .from("whatsapp_conversations")
    .select("id")
    .in("contact_phone", candidates)
    .eq("session_key", OFFICIAL_SESSION_KEY)
    .eq("assigned_user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (adoptableError) throw adoptableError;
  if (adoptable?.[0]) {
    const { data: adopted, error: adoptError } = await db()
      .from("whatsapp_conversations")
      .update({ session_key: userId, session_slot: sessionSlot, updated_at: new Date().toISOString() })
      .eq("id", adoptable[0].id)
      .eq("session_key", OFFICIAL_SESSION_KEY)
      .select(CONVERSATION_COLUMNS)
      .maybeSingle();
    if (adoptError && adoptError.code !== "23505") throw adoptError;
    if (adopted) return adopted;
    const raced = await findSessionConversation(candidates, userId, sessionSlot);
    if (raced) return raced;
  }

  const { error: upsertError } = await db()
    .from("whatsapp_conversations")
    .upsert({ contact_phone: phone, session_key: userId, session_slot: sessionSlot }, { onConflict: "contact_phone,session_key,session_slot", ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  return findSessionConversation(candidates, userId, sessionSlot);
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
async function recordBrokerAppMessage({ userId, sessionSlot = 1, conversation, phone, body, messageAt, cleanWaMessageId, media, metadata }) {
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) {
    return { conversationId: conversation.id, duplicate: true };
  }

  // Eco da mensagem que a AUTOMAÇÃO da Meta Diária acabou de mandar por esta sessão: não foi o corretor
  // digitando no celular — não entra como mensagem da pessoa nem conta como contato humano (decisão do
  // dono, 2026-10-03). Mensagens automáticas nunca ganham linha em whatsapp_messages (daily_goal_auto_queue).
  if (await isAutomationEchoForBroker({ userId, waMessageId: cleanWaMessageId, body, messageAt })) {
    return { conversationId: conversation.id, skipped: "eco_automacao" };
  }
  // Eco do lembrete automático do formulário (lib/whatsapp-form-reminder.js, 2026-10-09): idem — a linha da automação
  // já está no Chat; o eco não vira mensagem do corretor nem contato humano.
  if (await isFormReminderEcho({ conversationId: conversation.id, body })) {
    return { conversationId: conversation.id, skipped: "eco_lembrete_formulario" };
  }

  const { data: broker } = await db().from("admin_users").select("name, email, linked_broker_id").eq("id", userId).maybeSingle();

  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: userId,
    sent_by_name: broker?.name || "",
    channel: "whatsapp_individual",
    session_user_id: userId,
    session_slot: sessionSlot,
    message_type: media.messageType,
    body: body || null,
    metadata,
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
    p_preview: previewForMessage(body, media.gif ? "gif" : media.messageType),
    p_mark_in_service: true
  });
  if (rpcError) throw rpcError;

  // Contato humano (P-11) — a MESMA função do Chat do CRM: marca a conversa e o cliente (último contato +
  // status do Chat), com a autoria de quem enviou (o dono desta sessão). Conversa sem cliente ligado: procura
  // pelo telefone e só vincula com um único candidato claro (CLI-4).
  await registerHumanContact({
    conversation: { ...conversation, contact_phone: phone },
    actor: { userId, email: broker?.email || "", linkedBrokerId: broker?.linked_broker_id || null },
    at: messageAt,
    message: { direction: "outbound", senderType: "user", status: "sent", messageType: media.messageType, metadata },
    phoneFallback: !isLidPlaceholder(phone)
  });
  try {
    const { endLiveFlowSession } = await import("./whatsapp-flows");
    if (!isLidPlaceholder(phone)) await endLiveFlowSession(phone, "atendente_assumiu");
  } catch (flowError) {
    console.warn("Falha ao encerrar o fluxo automático (mensagem via app oficial):", flowError?.message || flowError);
  }

  // Conversa sem responsável: quem está com o WhatsApp conectado no celular
  // e respondeu é o responsável, sem ambiguidade. Conversa fora do Chat
  // (excluída / cliente arquivado) não é atribuída a ninguém.
  if (!conversation.assigned_user_id && !conversation.deleted_at) {
    await db().from("whatsapp_conversations").update({ assigned_user_id: userId, updated_at: new Date().toISOString() }).eq("id", conversation.id);
  }
  // Sem card de cliente no WhatsApp pessoal -> Particular automático (WA-26, dono 2026-10-10).
  await applyAutoPrivacy(conversation.id).catch((autoError) => console.warn("Falha no Particular automático:", autoError?.message || autoError));

  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

// { userId, from, text, waMessageId, at, contactName, fromMe, media?, quotedId?, remoteJid? }
// -> { conversationId, duplicate, skipped }. Texto, legenda e mídia (foto,
// vídeo, GIF, figurinha, áudio, documento), com a citação (resposta).
export async function projectIndividualInboundMessage({ userId, sessionSlot = 1, from, text, waMessageId = "", at = "", contactName = "", fromMe = false, media = null, quotedId = "", quotedText = "", remoteJid = "" }) {
  // "lid:<id>" = conversa do corretor com contato cujo número o WhatsApp ainda não informou (só mensagem do corretor).
  // Antes de criar "Número não identificado": o LID já apareceu nesta sessão (mensagens antigas guardam o remote_jid)?
  // Então é um contato conhecido — usa o telefone da conversa existente (o mapa do serviço se perde ao reiniciar).
  const knownPhone = isLidPlaceholder(from) ? await findKnownPhoneForLid({ userId, sessionSlot, lidJid: remoteJid || `${String(from).slice(4)}@lid` }) : "";
  const placeholder = isLidPlaceholder(from) && !knownPhone ? String(from) : "";
  const phone = placeholder || knownPhone || canonicalWhatsappPhone(from);
  if (!phone) return { skipped: "telefone_invalido" };
  const body = String(text || "").trim();
  const mediaInfo = mediaColumns(media, waMessageId);
  if (!body && mediaInfo.messageType === "text") return { skipped: "mensagem_vazia" };
  // Mensagem com telefone conhecido numa conversa endereçada por LID: se havia conversa-marcador desse LID, junta antes.
  if (!placeholder && userId && lidPlaceholderFromJid(remoteJid)) {
    await mergeLidConversation({ userId, sessionSlot, lidJid: remoteJid, phone }).catch((mergeError) => {
      console.warn("Falha ao juntar conversa sem número (LID):", mergeError?.message || mergeError);
    });
  }

  const conversation = await findOrCreateConversation(phone, userId, sessionSlot);
  if (!conversation?.id) return { skipped: "conversa_nao_criada" };

  const messageAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();
  const cleanWaMessageId = String(waMessageId || "").trim();
  const metadata = messageMetadata({ cleanWaMessageId, quotedId, quotedText, remoteJid, media: mediaInfo });

  if (fromMe) {
    if (!userId) return { skipped: "sem_corretor" };
    return recordBrokerAppMessage({ userId, sessionSlot, conversation, phone, body, messageAt, cleanWaMessageId, media: mediaInfo, metadata });
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
    session_slot: sessionSlot,
    message_type: mediaInfo.messageType,
    body: body || null,
    metadata,
    status: "received",
    message_at: messageAt
  });
  if (insertError) {
    // 23505 = violação do índice único parcial (mesma mensagem reentregue no
    // exato instante de uma corrida concorrente) — trata como duplicata, não como falha.
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }
  // O cliente escreveu: tudo o que mandamos antes por este número chegou (recibo perdido não deixa 1 tique para sempre).
  await cascadeOutboundStatus({ conversationId: conversation.id, upTo: messageAt, status: "delivered", userId: userId || null, slot: sessionSlot }).catch(() => {});

  // Conversa com alguém da EQUIPE (regra do dono, 2026-10-02): continua no
  // Chat, mas nunca vira cliente — não vincula a um card (nem ao card de
  // TESTE que essa pessoa tenha feito por formulário), não muda status, não
  // cria cadastro. O telefone já chega resolvido (LID -> senderPn/mapa).
  // Conversa PARTICULAR (regra do dono, 2026-10-09): contato pessoal — nunca vincula nem cria cliente.
  const privateContact = Boolean(conversation.private_at);
  // Sem número ainda ("lid:<id>"): não dá para procurar cliente nem equipe por telefone.
  const internalContact = privateContact || Boolean(placeholder) || await findInternalTeamPhone(phone);
  const clientId = internalContact ? null : (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_inbound", {
    p_conversation_id: conversation.id,
    p_count: 1,
    p_at: messageAt,
    p_preview: previewForMessage(body, mediaInfo.gif ? "gif" : mediaInfo.messageType),
    p_name: contactName || null,
    p_client_id: clientId,
    p_origin: null
  });
  if (rpcError) throw rpcError;
  // Cliente ARQUIVADO (regra do dono, 2026-10-02): a função do banco mantém a
  // conversa fora do Chat mesmo com mensagem nova — então ninguém é avisado.
  // Sem card de cliente no WhatsApp pessoal -> Particular automático (WA-26, dono 2026-10-10).
  await applyAutoPrivacy(conversation.id).catch((autoError) => console.warn("Falha no Particular automático:", autoError?.message || autoError));
  const { data: afterApply } = await db().from("whatsapp_conversations").select("deleted_at, private_at").eq("id", conversation.id).maybeSingle();
  // Particular também não avisa (contato pessoal, fora do atendimento).
  const hiddenConversation = Boolean(afterApply?.deleted_at) || privateContact || Boolean(afterApply?.private_at);

  if (clientId) {
    try {
      await markClientsInServiceOnReply([clientId]);
    } catch (statusError) {
      console.warn("Falha ao atualizar o status do cliente que respondeu (WhatsApp individual):", statusError?.message || statusError);
    }
  }

  // Mesma regra do canal oficial: só notifica quem já atende a conversa — e
  // só se for o dono do WhatsApp que recebeu (regra WA-11, 2026-10-02): a
  // mensagem chegou no número pessoal de alguém; quem atende a conversa por
  // outro número nem vê essa mensagem no Chat, então o push (nome + texto)
  // não pode ir para ele.
  // Acesso WhatsApp bloqueado (2026-10-04): nada de push com nome/texto de conversa para quem não vê o Chat.
  // 2026-10-11 (pedido do dono: número de não lidas no ícone do Chat no celular): conversa do WhatsApp pessoal SEM
  // atribuição (52 de 155 conversas de cliente) nunca avisava — sem push, o ícone do app não mudava. Quem recebe é sempre
  // o dono do número (userId); só não avisa se a conversa estiver atribuída a OUTRA pessoa.
  if (!hiddenConversation && (!conversation.assigned_user_id || conversation.assigned_user_id === userId) && !(await isWhatsappAccessBlocked(userId)) && !(await isChatPushSuppressed(userId))) {
    try {
      // "unreadCount" faltava aqui (bug real, 2026-09-29): o service worker só
      // atualiza o ícone do app quando o push traz esse número (ver
      // syncAppBadge em public/sw.js) — sem ele, o push chegava normalmente
      // mas o badge do ícone nunca era tocado. Como o canal individual virou
      // o caminho principal depois do número oficial banido, o ícone parou de
      // atualizar pra quase todo mundo. Mesma conta usada pelo canal oficial
      // (lib/whatsapp-chat.js).
      const unreadCount = await getUnreadMessageCountForBroker(userId);
      await sendPushToUser(userId, {
        title: contactName || phone,
        body: previewForMessage(body, mediaInfo.gif ? "gif" : mediaInfo.messageType),
        url: "/admin/chat",
        tag: `whatsapp-chat:${userId}`,
        unreadCount
      });
    } catch (pushError) {
      console.warn("Falha ao enviar push de mensagem nova (WhatsApp individual):", pushError?.message || pushError);
    }
  }

  // Contato ainda sem cliente vinculado: cria/vincula direto para o corretor
  // dono da sessão que recebeu a mensagem (nunca sorteia — a mensagem já
  // chegou no WhatsApp pessoal dele).
  if (!conversation.client_id && userId && !internalContact) {
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

  // Cancelar envios automáticos pendentes, opt-out e a pendência "Cliente
  // respondeu" NÃO ficam mais aqui (2026-10-02): são do consumidor da
  // Prospecção (lib/prospecting-reply.js), que o webhook chama de forma
  // independente desta gravação no Chat — uma falha aqui não impede aquilo.

  await broadcastChatChanged();
  return { conversationId: conversation.id, ...(internalContact ? { internalTeam: true } : {}) };
}

// Reação, edição e "apagar para todos" feitos no WhatsApp (pelo cliente ou
// pelo corretor no app do celular) — sincroniza a mensagem ORIGINAL do Chat.
// Nunca é "resposta" do cliente (não passa pela Prospecção nem soma não lida).
// { userId, kind, from, fromMe, waMessageId, targetId, emoji?, newText?, at }
export async function projectIndividualChatAction({ userId, sessionSlot = 1, kind, from, fromMe = false, waMessageId = "", targetId = "", emoji = "", newText = "", at = "" }) {
  const phone = isLidPlaceholder(from) ? String(from) : canonicalWhatsappPhone(from);
  const cleanTarget = String(targetId || "").trim();
  if (!phone || !cleanTarget || !userId) return { skipped: "dados_invalidos" };
  const actionAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();

  const { data: target, error } = await db()
    .from("whatsapp_messages")
    .select("id, conversation_id, direction, body, message_type, metadata, whatsapp_conversations!inner(contact_phone)")
    .eq("channel", "whatsapp_individual")
    .eq("session_user_id", userId)
    .eq("session_slot", sessionSlot)
    .eq("metadata->>wa_message_id", cleanTarget)
    .maybeSingle();
  if (error) throw error;
  // Mensagem original fora do CRM (ex.: anterior à conexão) — nada a sincronizar.
  if (!target) return { skipped: "mensagem_original_nao_encontrada" };
  if (!phoneLookupCandidates(phone).includes(target.whatsapp_conversations?.contact_phone)) return { skipped: "conversa_diferente" };

  if (kind === "reaction") {
    const cleanWaMessageId = String(waMessageId || "").trim();
    const { data: broker } = fromMe && userId ? await db().from("admin_users").select("name").eq("id", userId).maybeSingle() : { data: null };
    const { error: insertError } = await db().from("whatsapp_messages").insert({
      conversation_id: target.conversation_id,
      direction: fromMe ? "outbound" : "inbound",
      sender_type: fromMe ? "user" : "customer",
      sender_user_id: fromMe ? userId || null : null,
      sent_by_name: fromMe ? broker?.name || "" : null,
      channel: "whatsapp_individual",
      session_user_id: userId || null,
      session_slot: sessionSlot,
      message_type: "reaction",
      body: emoji || null,
      metadata: { ...(cleanWaMessageId ? { wa_message_id: cleanWaMessageId } : {}), reaction_target_wa_id: cleanTarget },
      status: fromMe ? "sent" : "received",
      sent_at: fromMe ? actionAt : null,
      message_at: actionAt
    });
    if (insertError && insertError.code !== "23505") throw insertError;
    await broadcastChatChanged();
    return { conversationId: target.conversation_id, reaction: true };
  }

  // Só quem enviou a mensagem pode editar/apagar para todos no WhatsApp:
  // edição/exclusão do cliente vale para mensagem do cliente; do corretor
  // (pelo app) vale para mensagem da equipe.
  if ((target.direction === "outbound") !== Boolean(fromMe)) return { skipped: "autor_diferente" };

  const metadata = { ...(target.metadata || {}) };
  if (kind === "edit") {
    const text = String(newText || "").trim();
    if (!text) return { skipped: "texto_vazio" };
    if (metadata.original_body === undefined) metadata.original_body = target.body || "";
    metadata.edited_at = actionAt;
    const { error: updateError } = await db().from("whatsapp_messages").update({ body: text, metadata }).eq("id", target.id);
    if (updateError) throw updateError;
  } else if (kind === "revoke") {
    if (metadata.revoked_at) return { conversationId: target.conversation_id, duplicate: true };
    if (metadata.original_body === undefined) metadata.original_body = target.body || "";
    metadata.revoked_at = actionAt;
    metadata.revoked_by = fromMe ? "team" : "customer";
    const { error: updateError } = await db().from("whatsapp_messages").update({ body: null, metadata }).eq("id", target.id);
    if (updateError) throw updateError;
  } else {
    return { skipped: "tipo_desconhecido" };
  }
  await broadcastChatChanged();
  return { conversationId: target.conversation_id, [kind]: true };
}

// Confirmação de entrega/leitura de uma mensagem que o corretor mandou pela
// sessão individual (as "setinhas" do WhatsApp) — ver sessions.js:
// onMessagesUpdate. Acha a mensagem pelo mesmo wa_message_id usado no
// dedupe/idempotência (metadata->>wa_message_id).
// Telefone de um LID já visto nesta sessão/número: mensagens gravadas guardam metadata.remote_jid ("<id>@lid") na
// conversa do telefone real. Devolve "" se nunca apareceu.
export async function findKnownPhoneForLid({ userId, sessionSlot = 1, lidJid }) {
  const placeholder = lidPlaceholderFromJid(lidJid);
  if (!userId || !placeholder) return "";
  const jid = `${placeholder.slice(4)}@lid`;
  const { data, error } = await db().from("whatsapp_messages")
    .select("conversation_id, whatsapp_conversations!inner(contact_phone)")
    .eq("channel", "whatsapp_individual").eq("session_user_id", userId).eq("session_slot", sessionSlot)
    .eq("metadata->>remote_jid", jid)
    .order("message_at", { ascending: false }).limit(10);
  if (error) throw error;
  const phone = (data || []).map((row) => row.whatsapp_conversations?.contact_phone).find((value) => value && !isLidPlaceholder(value));
  return phone || "";
}

// Rede de segurança (cron): conversa "Número não identificado" cujo LID já pertence a uma conversa com telefone nesta
// mesma sessão -> junta (duplicata criada quando o serviço reiniciou e esqueceu o par LID -> telefone).
export async function reconcileLidPlaceholders() {
  const { data, error } = await db().from("whatsapp_conversations").select("session_key, session_slot, contact_phone")
    .like("contact_phone", "lid:%").limit(200);
  if (error) throw error;
  let merged = 0;
  for (const row of data || []) {
    const lidJid = `${String(row.contact_phone).slice(4)}@lid`;
    const phone = await findKnownPhoneForLid({ userId: row.session_key, sessionSlot: row.session_slot || 1, lidJid }).catch(() => "");
    if (!phone) continue;
    const result = await mergeLidConversation({ userId: row.session_key, sessionSlot: row.session_slot || 1, lidJid, phone }).catch(() => null);
    if (result?.merged) merged += 1;
  }
  return { merged };
}

// Junta a conversa-marcador "lid:<id>" (mensagens enviadas pelo corretor antes de o número ser conhecido) à conversa
// do telefone real desta mesma sessão/número: move mensagens e histórico, recalcula a prévia e apaga o marcador.
export async function mergeLidConversation({ userId, sessionSlot = 1, lidJid, phone }) {
  const placeholder = lidPlaceholderFromJid(lidJid);
  const realPhone = canonicalWhatsappPhone(phone);
  if (!userId || !placeholder || !realPhone || isLidPlaceholder(realPhone)) return { merged: false };
  const { data: source, error } = await db().from("whatsapp_conversations").select(CONVERSATION_COLUMNS)
    .eq("contact_phone", placeholder).eq("session_key", userId).eq("session_slot", sessionSlot).maybeSingle();
  if (error) throw error;
  if (!source) return { merged: false };
  const target = await findOrCreateConversation(realPhone, userId, sessionSlot);
  if (!target?.id || target.id === source.id) return { merged: false };

  for (const table of ["whatsapp_messages", "whatsapp_conversation_audit", "whatsapp_flow_sessions", "attendance_guide_progress", "whatsapp_reply_alerts"]) {
    const { error: moveError } = await db().from(table).update({ conversation_id: target.id }).eq("conversation_id", source.id);
    if (moveError && table === "whatsapp_messages") throw moveError;
  }
  const { data: latest } = await db().from("whatsapp_messages").select("direction, body, message_type, message_at")
    .eq("conversation_id", target.id).neq("direction", "internal").order("message_at", { ascending: false }).limit(1).maybeSingle();
  const patch = { updated_at: new Date().toISOString() };
  if (latest && (!target.last_message_at || new Date(latest.message_at) >= new Date(target.last_message_at))) {
    patch.last_message_at = latest.message_at;
    patch.last_message_direction = latest.direction;
    patch.last_message_preview = previewForMessage(latest.body || "", latest.message_type || "text");
  }
  // Particular marcada à mão passa junto; a automática (sem card) é recalculada abaixo por applyAutoPrivacy.
  if (source.private_at && !isAutoPrivate(source) && !target.private_at) patch.private_at = source.private_at;
  if (!target.contact_name && source.contact_name) patch.contact_name = source.contact_name;
  if (!target.assigned_user_id && source.assigned_user_id) patch.assigned_user_id = source.assigned_user_id;
  // Liga ao cliente pelo telefone agora conhecido (nunca Particular nem número da equipe).
  if (!target.client_id && !((source.private_at && !isAutoPrivate(source)) || (target.private_at && !isAutoPrivate(target))) && !(await findInternalTeamPhone(realPhone))) {
    const clientId = (await findLatestRegistrationIdsByPhones([realPhone])).get(realPhone) || null;
    if (clientId) patch.client_id = clientId;
  }
  await db().from("whatsapp_conversations").update(patch).eq("id", target.id);
  await db().from("whatsapp_conversations").delete().eq("id", source.id);
  await applyAutoPrivacy(target.id).catch(() => {});
  await broadcastChatChanged();
  return { merged: true, conversationId: target.id };
}

// Telefones candidatos para descobrir o LID de uma mensagem que o corretor mandou PELO CELULAR a um contato novo
// (caso Anderson/Bencke, 2026-10-10: a simulação enviada pelo WhatsApp dela nunca chegou ao Chat). Clientes recentes
// (14 dias) cujo responsável é este corretor (ou o corretor do associado) + conversas recentes deste número ainda sem
// mensagem. O microsserviço confere no WhatsApp qual telefone tem aquele LID; nada é enviado a ninguém.
export async function listLidCandidatePhones(userId, sessionSlot = 1, lidJid = "") {
  if (!userId) return [];
  const known = lidJid ? await findKnownPhoneForLid({ userId, sessionSlot, lidJid }).catch(() => "") : "";
  if (known) return [known.replace(/\D/g, "")];
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: profile } = await db().from("admin_users").select("linked_broker_id").eq("id", userId).maybeSingle();
  const owners = [userId, profile?.linked_broker_id].filter(Boolean);
  const [clients, conversations] = await Promise.all([
    db().from("simulation_registrations").select("phone_normalized, updated_at")
      .in("responsible_user_id", owners).gte("updated_at", since).is("private_contact_at", null)
      .order("updated_at", { ascending: false }).limit(40),
    db().from("whatsapp_conversations").select("contact_phone, created_at")
      .eq("session_key", userId).eq("session_slot", sessionSlot).is("last_message_at", null).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(20)
  ]);
  const phones = [
    ...(conversations.data || []).map((row) => row.contact_phone),
    ...(clients.data || []).map((row) => row.phone_normalized)
  ].map((phone) => String(phone || "").replace(/\D/g, "")).filter((phone) => phone.length >= 12);
  return [...new Set(phones)].slice(0, 40);
}

// Avança (nunca regride) o status das mensagens ENVIADAS de uma conversa/número até um instante:
// "delivered" só mexe em "sent"; "read" mexe em "sent" e "delivered".
export async function cascadeOutboundStatus({ conversationId, upTo, status, userId = null, slot = 1 }) {
  if (!conversationId || !upTo || (status !== "delivered" && status !== "read")) return 0;
  const now = new Date().toISOString();
  const patch = status === "read" ? { status: "read", read_at: now } : { status: "delivered", delivered_at: now };
  let query = db().from("whatsapp_messages").update(patch)
    .eq("conversation_id", conversationId).eq("direction", "outbound").eq("channel", "whatsapp_individual")
    .in("status", status === "read" ? ["sent", "delivered"] : ["sent"])
    .lte("message_at", upTo);
  if (userId) query = query.eq("session_user_id", userId).eq("session_slot", slot || 1);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data || []).length;
}

export async function projectIndividualMessageStatus({ userId = "", sessionSlot = 1, waMessageId, status }) {
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
  let statusQuery = db()
    .from("whatsapp_messages")
    .update(patch)
    .eq("channel", "whatsapp_individual")
    .eq("metadata->>wa_message_id", cleanWaMessageId)
    .neq("status", "read");
  // O recibo chega na sessão que ENVIOU: só atualiza a cópia dessa sessão
  // (a mesma mensagem entre dois colegas existe uma vez em cada sessão).
  // (2026-10-08: e o número — os dois números do mesmo corretor também são sessões diferentes.)
  if (userId) statusQuery = statusQuery.eq("session_user_id", userId).eq("session_slot", sessionSlot);
  const { data, error } = await statusQuery.select("id, conversation_id, message_at, session_user_id, session_slot").maybeSingle();
  if (error) throw error;
  if (data?.id) {
    // Recibo de uma mensagem vale para as ANTERIORES da mesma conversa/número (como no WhatsApp: abrir a conversa lê
    // tudo) — muitos recibos se perdem no WhatsApp pessoal (1.817 presas em "enviada" em 7 dias, 2026-10-10).
    await cascadeOutboundStatus({ conversationId: data.conversation_id, upTo: data.message_at, status, userId: data.session_user_id, slot: data.session_slot }).catch(() => {});
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
export async function projectIndividualHistoryBatch(userId, items, { sessionSlot = 1 } = {}) {
  if (!userId || !Array.isArray(items) || !items.length) return { processed: 0 };

  const byPhone = new Map();
  const knownByLid = new Map();
  for (const item of items) {
    // Contato sem telefone (LID) no histórico (2026-10-11): usa o telefone já conhecido desse LID nesta sessão ou entra
    // como "Número não identificado" (WA-25) — antes era descartado e o histórico da semana vinha quase vazio.
    let phone = "";
    if (isLidPlaceholder(item?.from)) {
      const placeholder = String(item.from);
      if (!knownByLid.has(placeholder)) {
        knownByLid.set(placeholder, await findKnownPhoneForLid({ userId, sessionSlot, lidJid: item.remoteJid || `${placeholder.slice(4)}@lid` }).catch(() => ""));
      }
      phone = knownByLid.get(placeholder) || placeholder;
    } else {
      phone = canonicalWhatsappPhone(item?.from);
    }
    const body = String(item?.text || "").trim();
    const media = item?.media && typeof item.media === "object" && item.media.kind ? item.media : null;
    if (!phone || (!body && !media)) continue;
    const messageAt = item.at && !Number.isNaN(new Date(item.at).getTime()) ? new Date(item.at).toISOString() : new Date().toISOString();
    const cleanWaMessageId = String(item.waMessageId || "").trim();
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push({ body, messageAt, cleanWaMessageId, fromMe: Boolean(item.fromMe), media, quotedId: item.quotedId || "", quotedText: item.quotedText || "", remoteJid: item.remoteJid || "", contactName: String(item.contactName || "").trim() });
  }

  let processed = 0;
  for (const [phone, group] of byPhone) {
    group.sort((a, b) => new Date(a.messageAt) - new Date(b.messageAt));
    try {
      processed += await importHistoryForPhone(userId, phone, group, sessionSlot);
    } catch (error) {
      console.error(`Falha ao importar histórico do WhatsApp individual (${phone}):`, error?.message || error);
    }
  }
  return { processed };
}

async function importHistoryForPhone(userId, phone, allItems, sessionSlot = 1) {
  const conversation = await findOrCreateConversation(phone, userId, sessionSlot);
  if (!conversation?.id) return 0;
  // Contato destrancado do Particular (2026-10-10): o passado anterior ao destrancamento não volta para o Chat.
  const cutoff = conversation.history_cutoff_at ? new Date(conversation.history_cutoff_at).getTime() : 0;
  const group = cutoff ? allItems.filter((item) => new Date(item.messageAt).getTime() >= cutoff) : allItems;
  if (!group.length) return 0;

  if (!conversation.client_id && !conversation.private_at && !isLidPlaceholder(phone)) {
    // Conversa com alguém da EQUIPE (regra do dono, 2026-10-02): continua no
  // Chat, mas nunca vira cliente — não vincula a um card (nem ao card de
  // TESTE que essa pessoa tenha feito por formulário), não muda status, não
  // cria cadastro. O telefone já chega resolvido (LID -> senderPn/mapa).
  const internalContact = await findInternalTeamPhone(phone);
  const clientId = internalContact ? null : (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
    if (clientId) await db().from("whatsapp_conversations").update({ client_id: clientId }).eq("id", conversation.id).is("client_id", null);
  }

  // Foto e áudio vêm já guardados no Storage (mesmo formato da mensagem ao vivo); texto continua como sempre.
  const rows = group.map((item) => {
    const mediaInfo = mediaColumns(item.media, item.cleanWaMessageId);
    item.mediaKind = mediaInfo.messageType === "text" ? "" : mediaInfo.messageType;
    return {
      conversation_id: conversation.id,
      direction: item.fromMe ? "outbound" : "inbound",
      sender_type: item.fromMe ? "user" : "customer",
      sender_user_id: item.fromMe ? userId : null,
      channel: "whatsapp_individual",
      session_user_id: userId,
      session_slot: sessionSlot,
      message_type: mediaInfo.messageType,
      body: item.body || null,
      metadata: { ...messageMetadata({ cleanWaMessageId: item.cleanWaMessageId, quotedId: item.quotedId, quotedText: item.quotedText, remoteJid: item.remoteJid, media: mediaInfo }), history: true },
      status: item.fromMe ? "sent" : "received",
      sent_at: item.fromMe ? item.messageAt : null,
      message_at: item.messageAt
    };
  });

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
    patch.last_message_preview = previewForMessage(last.body, last.mediaKind);
    patch.last_message_direction = last.fromMe ? "outbound" : "inbound";
    patch.last_message_at = last.messageAt;
  }
  // Mesma regra do canal ao vivo: saída sempre atualiza a conta; entrada só
  // define se a conversa ainda não tinha nenhuma conta registrada.
  if (lastOutbound || !conversation.account_channel) {
    patch.account_channel = "whatsapp_individual";
    patch.account_user_id = userId;
  }
  // Nome do contato (pushName) quando a conversa ainda não tem — sem isso aparecia só o número.
  const named = [...group].reverse().find((item) => !item.fromMe && item.contactName);
  if (!conversation.contact_name && named) patch.contact_name = named.contactName;
  await db().from("whatsapp_conversations").update(patch).eq("id", conversation.id);
  // Mesma regra do canal ao vivo: sem card de cliente (ou card arquivado) = Particular (WA-26/26a).
  await applyAutoPrivacy(conversation.id).catch((autoError) => console.warn("Falha no Particular automático (histórico):", autoError?.message || autoError));

  return inserted;
}

// ---------------------------------------------------------------------------
// GRUPOS (pedido do dono, 2026-10-11): aba "Grupos" dentro de Particular, SÓ para o dono (isArchivedChatViewer).
// Conversa própria por grupo + número (contact_phone = "group:<id>", private_at, origin.group). Nunca vira cliente,
// nunca conta não lida do corretor (unread_count fica 0), não manda push nem passa por Prospecção/automação.
// Removido pelo dono (origin.group_removed): mensagens novas são ignoradas e a mídia não é mais baixada.
// ---------------------------------------------------------------------------
export function isGroupKey(value) {
  return /^group:[\d-]{5,60}$/.test(String(value || ""));
}

async function findGroupConversation(groupKey, userId, sessionSlot) {
  const { data, error } = await db().from("whatsapp_conversations").select("id, contact_name, deleted_at, origin, last_message_at")
    .eq("contact_phone", groupKey).eq("session_key", userId).eq("session_slot", sessionSlot).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function isGroupRemoved({ userId, sessionSlot = 1, groupKey }) {
  if (!userId || !isGroupKey(groupKey)) return false;
  const row = await findGroupConversation(groupKey, userId, sessionSlot);
  return Boolean(row?.origin?.group_removed);
}

export async function projectGroupMessage({ userId, sessionSlot = 1, from, kind = "message", text = "", waMessageId = "", at = "", fromMe = false, media = null, quotedId = "", remoteJid = "", groupName = "", senderName = "", senderPhone = "" }) {
  const groupKey = String(from || "");
  if (!userId || !isGroupKey(groupKey)) return { skipped: "grupo_invalido" };
  if (kind !== "message") return { skipped: "evento_de_grupo_ignorado" };
  let conversation = await findGroupConversation(groupKey, userId, sessionSlot);
  if (conversation?.origin?.group_removed) return { ignored: true };
  const name = String(groupName || "").trim().slice(0, 120);
  if (!conversation) {
    const now = new Date().toISOString();
    const { error } = await db().from("whatsapp_conversations").upsert({
      contact_phone: groupKey, session_key: userId, session_slot: sessionSlot, contact_name: name || "Grupo",
      private_at: now, unread_count: 0, account_channel: "whatsapp_individual", account_user_id: userId,
      origin: { group: true, group_jid: String(remoteJid || "").slice(0, 120) }
    }, { onConflict: "contact_phone,session_key,session_slot", ignoreDuplicates: true });
    if (error) throw error;
    conversation = await findGroupConversation(groupKey, userId, sessionSlot);
    if (!conversation) return { skipped: "conversa_nao_criada" };
  }
  const body = String(text || "").trim();
  const cleanWaMessageId = String(waMessageId || "").trim();
  const mediaInfo = mediaColumns(media, cleanWaMessageId);
  if (!body && mediaInfo.messageType === "text") return { skipped: "mensagem_vazia" };
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) return { conversationId: conversation.id, duplicate: true };
  const messageAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();
  const metadata = { ...messageMetadata({ cleanWaMessageId, quotedId, remoteJid, media: mediaInfo }), group: true };
  if (!fromMe) {
    const cleanSender = String(senderName || "").trim().slice(0, 80);
    const cleanSenderPhone = String(senderPhone || "").replace(/\D/g, "").slice(0, 20);
    if (cleanSender) metadata.group_sender_name = cleanSender;
    if (cleanSenderPhone) metadata.group_sender_phone = cleanSenderPhone;
  }
  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: fromMe ? "outbound" : "inbound",
    sender_type: fromMe ? "user" : "customer",
    sender_user_id: fromMe ? userId : null,
    channel: "whatsapp_individual",
    session_user_id: userId,
    session_slot: sessionSlot,
    message_type: mediaInfo.messageType,
    body: body || null,
    metadata,
    status: fromMe ? "sent" : "received",
    sent_at: fromMe ? messageAt : null,
    message_at: messageAt
  });
  if (insertError) {
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }
  const patch = { updated_at: new Date().toISOString(), unread_count: 0 };
  if (!conversation.last_message_at || new Date(messageAt) >= new Date(conversation.last_message_at)) {
    const who = !fromMe && metadata.group_sender_name ? `${metadata.group_sender_name}: ` : "";
    patch.last_message_preview = `${who}${previewForMessage(body, mediaInfo.messageType === "text" ? "" : media?.kind)}`.slice(0, 140);
    patch.last_message_direction = fromMe ? "outbound" : "inbound";
    patch.last_message_at = messageAt;
  }
  if (name && name !== conversation.contact_name) patch.contact_name = name;
  await db().from("whatsapp_conversations").update(patch).eq("id", conversation.id);
  // Sem aviso em tempo real: grupo grande geraria recarga da tela de TODOS a cada mensagem — a aba do dono se
  // atualiza pelo ciclo normal de 30 s.
  return { conversationId: conversation.id };
}
