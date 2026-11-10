import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates, canonicalWhatsappPhone } from "./phone-utils";
import { findConversationByPhone, findDoNotContactInboundBlock } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { isSponsoredAdReferral } from "./whatsapp-referral.mjs";
import { AD_WAITING_DISTRIBUTION } from "./whatsapp-ad-waiting-core.mjs";
import { getSiteBaseUrl } from "./admin-profiles";
import {
  LIVE_STATUSES, OFFICIAL_AD_FLOW_KIND, OFFICIAL_AD_FLOW_ROTATION_ID, OFFICIAL_AD_FLOW_SETTING_ID, OFFICIAL_AD_FLOW_TABLE, STATUSES, STEPS,
  buildFollowUpButtons, buildFormLink, buildGreetingMessage, buildLocationMessage, buildMapsUrl, buildNoOneAnsweredText, buildNudgeText, buildOfferWaitText, buildTransferNoticeText, buildValuesMessage,
  claimKey, decideInbound, decideStart, decideTimer, generateFormToken, isWithinTransferWindow, normalizeConfig,
  orderParticipants, reasonLabel, stepLabel
} from "./official-ad-flow-core.mjs";
import { buildTransferAlertText } from "./official-alert-core.mjs";

// FLUXO DO ANÚNCIO NO NÚMERO OFICIAL (dono, 2026-11-10 — BUSINESS_RULES WA-40). Regras puras em lib/official-ad-flow-core.mjs.
// DESLIGADO por padrão: sem linha em crm_settings (OFFICIAL_AD_FLOW_SETTING_ID) nada aqui age (o webhook e o cron só leem a
// configuração). Roda DEPOIS do cadastro do lead do anúncio (processOrganicLeads — o cliente já existe "segurado" com o dono,
// WA-18) e, enquanto a sessão está viva, segura as liberações por resposta/silêncio da WA-18 (`holdsByOfficialAdFlow`).
// Envio sempre por sendReservedAutomationMessage (reserva por mensagem: nunca duas vezes, falha nunca reenviada).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function isMissingTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /official_ad_flow_sessions/.test(String(error?.message || ""));
}

// ---------------------------------------------------------------------------------------------------------------------
// Configuração (crm_settings) — sem linha = desligado
// ---------------------------------------------------------------------------------------------------------------------

export async function loadOfficialAdFlowConfig() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", OFFICIAL_AD_FLOW_SETTING_ID).maybeSingle();
  if (error) throw error;
  return normalizeConfig(data?.setting_value);
}

async function loadRotation() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", OFFICIAL_AD_FLOW_ROTATION_ID).maybeSingle();
  if (error) throw error;
  return String(data?.setting_value?.lastPickedUserId || "");
}

async function saveRotation(userId) {
  const { error } = await db().from("crm_settings").upsert({ id: OFFICIAL_AD_FLOW_ROTATION_ID, setting_value: { lastPickedUserId: userId }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) console.error("Fluxo do anúncio: falha ao gravar o rodízio:", error.message || error);
}

/** Grava a configuração (só rota com guard de gestão). Participantes só de usuários que existem. */
export async function saveOfficialAdFlowConfig(input, auth) {
  const config = normalizeConfig(input);
  if (config.participants.length) {
    const { data, error } = await db().from("admin_users").select("id").in("id", config.participants.map((item) => item.userId));
    if (error) throw error;
    const known = new Set((data || []).map((row) => row.id));
    config.participants = config.participants.filter((item) => known.has(item.userId));
  }
  const { error } = await db().from("crm_settings").upsert({ id: OFFICIAL_AD_FLOW_SETTING_ID, setting_value: config, updated_at: new Date().toISOString(), updated_by: auth?.profile?.id || null }, { onConflict: "id" });
  if (error) throw error;
  return config;
}

/** Tela de configuração: config + candidatos (usuários ativos com WhatsApp) + último do rodízio. */
export async function getOfficialAdFlowSettingsView() {
  const [config, lastPickedUserId, usersResult] = await Promise.all([
    loadOfficialAdFlowConfig(),
    loadRotation().catch(() => ""),
    db().from("admin_users").select("id, name, role, status").in("role", ["admin", "manager", "broker", "associate"]).eq("status", "active").order("name")
  ]);
  if (usersResult.error) throw usersResult.error;
  const { listIndividualSessionStatuses } = await import("./whatsapp-individual");
  const statuses = await listIndividualSessionStatuses((usersResult.data || []).map((user) => user.id)).catch(() => new Map());
  return {
    config,
    lastPickedUserId,
    users: (usersResult.data || []).map((user) => ({ id: user.id, name: user.name, role: user.role, whatsappStatus: statuses.get(user.id) || null }))
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------------------------------------------------

async function loadLiveSession(phone) {
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("*").in("phone", phoneLookupCandidates(phone)).in("status", LIVE_STATUSES).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function hasRecentSession(phone, now) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("id").in("phone", phoneLookupCandidates(phone)).gte("created_at", since).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function updateSession(id, patch, onlyStatuses = null) {
  let query = db().from(OFFICIAL_AD_FLOW_TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (onlyStatuses) query = query.in("status", onlyStatuses);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

/** O cliente está sendo atendido pelo fluxo do anúncio? A WA-18 não o libera por resposta/silêncio enquanto isso. */
export async function holdsByOfficialAdFlow(clientId) {
  if (!clientId) return false;
  let config;
  try {
    config = await loadOfficialAdFlowConfig();
  } catch (error) {
    console.error("Fluxo do anúncio: falha ao ler a configuração:", error?.message || error);
    return false;
  }
  if (!config.enabled) return false;
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("id").eq("client_id", clientId).in("status", LIVE_STATUSES).limit(1);
  if (error) {
    if (!isMissingTable(error)) console.error("Fluxo do anúncio: falha ao consultar a sessão do cliente:", error.message || error);
    return false;
  }
  return Boolean(data?.length);
}

/** O cadastro veio por este fluxo? (ligado + sessão nos últimos 3 dias) — usado pela simulação automática e pelo envio. */
export async function isOfficialAdFlowRegistration(registration) {
  const phone = canonicalWhatsappPhone(registration?.phoneNormalized || registration?.phone);
  if (!phone) return false;
  const config = await loadOfficialAdFlowConfig();
  if (!config.enabled) return false;
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("id").in("phone", phoneLookupCandidates(phone)).gte("created_at", since).limit(1);
  if (error) {
    if (!isMissingTable(error)) throw error;
    return false;
  }
  return Boolean(data?.length);
}

/** Cadastro concluído pelo formulário: encerra a sessão viva (sem mais cutucada nem transferência). */
export async function finishOfficialAdFlowByPhone(phone, reason = "formulario_enviado") {
  const candidates = phoneLookupCandidates(phone);
  if (!candidates.length) return 0;
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).update({ status: STATUSES.finished, end_reason: reason, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("phone", candidates).in("status", LIVE_STATUSES).select("id");
  if (error) {
    if (!isMissingTable(error)) console.error("Fluxo do anúncio: falha ao encerrar depois do formulário:", error.message || error);
    return 0;
  }
  return data?.length || 0;
}

/** Imóveis sugeridos da apresentação (WA-40): por nome, na tabela de empreendimentos; só para quem veio pelo fluxo. */
export async function loadOfficialAdFlowSuggestedProperties(registration) {
  if (!(await isOfficialAdFlowRegistration(registration))) return [];
  const config = await loadOfficialAdFlowConfig();
  const result = [];
  for (const name of config.suggestedPropertyNames) {
    const found = await findPropertyByName(name);
    if (found) result.push({ propertyId: found.id, customName: found.name, imageUrl: photoUrl(found.photos_json), recommendationReason: "", benefits: [] });
    else console.warn(`Fluxo do anúncio: imóvel sugerido "${name}" não encontrado no cadastro de empreendimentos.`);
  }
  return result;
}

function photoUrl(photos) {
  const first = Array.isArray(photos) ? photos[0] : null;
  const value = typeof first === "string" ? first : first?.url || first?.src || first?.publicUrl || "";
  return /^https:\/\//i.test(String(value || "")) ? String(value) : "";
}

async function findPropertyByName(name) {
  const clean = String(name || "").replace(/[%_,()]/g, " ").trim();
  if (!clean) return null;
  const { data, error } = await db().from("properties").select("id, name, location, photos_json").ilike("name", `%${clean}%`).eq("is_published", true).order("display_order", { ascending: true }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

/** Contato do token do formulário (nome do perfil + telefone) para o formulário curto — mesmo contrato do `sms_t`. */
export async function readOfficialAdFlowContact(token) {
  if (!token) return null;
  const { data, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("profile_name, phone").eq("form_token", token).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.warn("Fluxo do anúncio: contato do token não resolvido:", error.message || error);
    return null;
  }
  return data ? { name: data.profile_name || "", phone: data.phone || "" } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Envio (Cloud API, com reserva)
// ---------------------------------------------------------------------------------------------------------------------

async function sendFlowMessage({ session, conversation, label, n = 1, built, extraMetadata = {} }) {
  const { sendReservedAutomationMessage } = await import("./whatsapp-form-reminder");
  const { sendWhatsappMessagePayload } = await import("./whatsapp-master");
  const url = built.link?.url || "";
  return sendReservedAutomationMessage({
    conversationId: conversation.id,
    claimKey: claimKey(session.id, label, n),
    text: built.text,
    metadata: { kind: OFFICIAL_AD_FLOW_KIND, step: label, session_id: session.id, buttons: built.buttons || [], ...(built.link ? { link: built.link } : {}), ...(built.imageUrl ? { image_url: built.imageUrl } : {}), ...extraMetadata },
    logLabel: "[fluxo-anuncio-oficial]",
    send: async () => {
      try {
        return await sendWhatsappMessagePayload({ to: conversation.contact_phone, message: built.message });
      } catch (error) {
        // A Meta RECUSOU o formato (ex.: imagem inacessível): o mesmo conteúdo em texto, com o link. Falha de rede nunca reenvia.
        if (!error?.metaRejected || !url) throw error;
        return sendWhatsappMessagePayload({ to: conversation.contact_phone, message: { type: "text", text: { body: `${built.text}\n${url}` } } });
      }
    }
  });
}

async function loadConversation(phone) {
  return findConversationByPhone(phone, "id, contact_phone, contact_name, client_id, private_at, deleted_at, origin, last_human_reply_at");
}

async function loadClient(clientId) {
  if (!clientId) return null;
  const { data, error } = await db().from("simulation_registrations").select("id, full_name, client_code, status, distribution_type, responsible_user_id, last_form_submitted_at, phone_normalized").eq("id", clientId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------------------------------------------------

async function locationContent(config) {
  const property = config.locationPropertyName ? await findPropertyByName(config.locationPropertyName).catch(() => null) : null;
  return {
    propertyName: property?.name || config.locationPropertyName || "",
    imageUrl: config.locationImageUrl || photoUrl(property?.photos_json),
    mapsUrl: buildMapsUrl({ mapsUrl: config.mapsUrl, query: [property?.name || config.locationPropertyName, property?.location].filter(Boolean).join(" ") })
  };
}

async function runStep(session, conversation, step, config, now) {
  if (step === STEPS.location) {
    const content = await locationContent(config);
    if (!content.mapsUrl) {
      // Sem endereço/mapa configurado não há o que mandar: o cliente vai para um associado em vez de ficar sem resposta.
      console.warn("Fluxo do anúncio: Localização sem mapa configurado — transferindo o cliente.");
      return requestTransfer(session, "texto_livre", config, now);
    }
    await sendFlowMessage({ session, conversation, label: "location", built: buildLocationMessage(content) });
    await sendFlowMessage({ session, conversation, label: "location-menu", built: buildFollowUpButtons(STEPS.location) });
  } else if (step === STEPS.values) {
    const { resolveFormLink } = await import("./whatsapp-flows");
    const { link } = await resolveFormLink(null); // segurado do anúncio: link público /s (formLinkResponsibleId, WA-18)
    await sendFlowMessage({ session, conversation, label: "values", built: buildValuesMessage(buildFormLink(link, session.form_token)) });
    await sendFlowMessage({ session, conversation, label: "values-menu", built: buildFollowUpButtons(STEPS.values) });
  }
  await updateSession(session.id, { step, step_entered_at: now.toISOString(), nudged_at: null, last_client_at: now.toISOString() }, LIVE_STATUSES);
  return { step };
}

// ---------------------------------------------------------------------------------------------------------------------
// Transferência
// ---------------------------------------------------------------------------------------------------------------------

async function requestTransfer(session, reason, config, now) {
  // Dia e noite: PERGUNTA ao próximo da roleta (oferta, lib/roulette-offer.js). Lista vazia → segurado com o dono (WA-18).
  return startOffer(session, reason, config, now, await loadConversation(session.phone));
}

async function sendNotice(session, conversation, label, text) {
  try {
    await sendFlowMessage({ session, conversation, label, built: textMessage(text) });
  } catch (error) {
    console.error("Fluxo do anúncio: falha ao avisar o cliente:", error?.message || error);
  }
}

// Pergunta ao próximo da roleta (sim/ok em até `offerTimeoutSec`), depois ao seguinte… Ninguém → exhaustAdFlowOffer.
async function startOffer(session, reason, config, now, conversation) {
  const enabled = config.participants.filter((item) => item.enabled);
  if (!enabled.length) return holdWithOwner(session, config, now, conversation); // lista vazia: segurado com o dono
  const order = orderParticipants({ participants: config.participants, eligibleIds: await offerableParticipantIds(config), lastPickedUserId: await loadRotation() });
  const claimed = await updateSession(session.id, { status: STATUSES.offering, transfer_reason: reason }, [STATUSES.active]);
  if (!claimed) return { skipped: "ja_tratada" };
  const client = await loadClient(session.client_id);
  const { startRouletteOffer } = await import("./roulette-offer");
  const result = await startRouletteOffer({
    kind: "ad_flow", clientId: session.client_id, refId: session.id, candidateOrder: order, timeoutSec: config.offerTimeoutSec, now,
    context: { clientName: client?.full_name || session.profile_name || "", stepLabel: stepLabel(session.step), reason }
  });
  if (conversation && !result.exhausted) await sendNotice(session, conversation, "notice-offer", buildOfferWaitText({ profileName: session.profile_name }));
  if (result.exhausted) await exhaustAdFlowOffer({ ref_id: session.id, client_id: session.client_id }, now);
  return { offering: true };
}

/** Quem pode receber a PERGUNTA: participante ligado e ativo, com WhatsApp conectado OU telefone cadastrado para receber o aviso. */
async function offerableParticipantIds(config) {
  const ids = config.participants.filter((item) => item.enabled).map((item) => item.userId);
  if (!ids.length) return [];
  const { data, error } = await db().from("admin_users").select("id, status, phone").in("id", ids);
  if (error) throw error;
  const active = (data || []).filter((row) => row.status === "active");
  const { listIndividualSessionStatuses } = await import("./whatsapp-individual");
  const statuses = await listIndividualSessionStatuses(active.map((row) => row.id));
  return active.filter((row) => statuses.get(row.id) === "connected" || String(row.phone || "").replace(/\D/g, "").length >= 10).map((row) => row.id);
}

/** Oferta ACEITA ("sim"/"ok" no prazo): mesmo caminho da transferência direta, para o corretor que respondeu. */
export async function completeAdFlowOffer(offer, brokerId, now = new Date()) {
  const { data: session, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("*").eq("id", offer.ref_id).maybeSingle();
  if (error) throw error;
  if (!session || session.status !== STATUSES.offering) return { transferred: false };
  const config = await loadOfficialAdFlowConfig();
  const conversation = await loadConversation(session.phone);
  const result = await finishTransferTo(session, brokerId, session.transfer_reason || "sem_resposta", config, now, conversation, [STATUSES.offering]);
  return { transferred: Boolean(result.transferred) };
}

/**
 * Ninguém aceitou a oferta. DE NOITE (fora de 07:00–20:00): aviso "a partir das 8h". DE DIA: sem mensagem (pendente de confirmação
 * do dono). Nos dois casos o cliente segue segurado com o dono e a WA-18 retoma (respondeu → roleta normal, com aviso normal ao
 * corretor da vez pelo CRM; sem resposta → silêncio de 3 h).
 */
export async function exhaustAdFlowOffer(offer, now = new Date()) {
  const { data: session, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("*").eq("id", offer.ref_id).maybeSingle();
  if (error) throw error;
  if (!session || session.status !== STATUSES.offering) return;
  if (!(await updateSession(session.id, { status: STATUSES.offerExhausted, end_reason: "oferta_sem_aceite", ended_at: now.toISOString() }, [STATUSES.offering]))) return;
  const config = await loadOfficialAdFlowConfig();
  if (isWithinTransferWindow(now, config)) return;
  const conversation = await loadConversation(session.phone);
  if (conversation) await sendNotice(session, conversation, "notice-no-one", buildNoOneAnsweredText({ profileName: session.profile_name, config }));
}

/** O cliente da oferta ainda está sem corretor (segurado com o dono, sem ninguém ter levado)? */
export async function isAdFlowOfferClientAvailable(offer) {
  const client = await loadClient(offer.client_id);
  return Boolean(client) && client.distribution_type === AD_WAITING_DISTRIBUTION && client.status !== "do_not_contact" && client.status !== "archived";
}

/** Resposta tardia DEPOIS da oferta esgotada: cliente ainda sem responsável → transfere a quem respondeu. */
export async function completeAdFlowOfferAfterEnd(offer, brokerId, now = new Date()) {
  if (!(await isAdFlowOfferClientAvailable(offer))) return { transferred: false };
  const { data: session, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("*").eq("id", offer.ref_id).maybeSingle();
  if (error) throw error;
  if (!session || session.status !== STATUSES.offerExhausted) return { transferred: false };
  const config = await loadOfficialAdFlowConfig();
  const conversation = await loadConversation(session.phone);
  const result = await finishTransferTo(session, brokerId, session.transfer_reason || "sem_resposta", config, now, conversation, [STATUSES.offerExhausted]);
  return { transferred: Boolean(result.transferred) };
}

// Lista de participantes vazia: o cliente continua segurado com o dono (WA-18); o fluxo termina e a WA-18 segue como sempre.
async function holdWithOwner(session, config, now, conversation) {
  if (await updateSession(session.id, { status: STATUSES.held, end_reason: "sem_participantes", ended_at: now.toISOString() }, LIVE_STATUSES) && conversation) {
    await sendNotice(session, conversation, "notice-held", buildTransferNoticeText({ profileName: session.profile_name, noParticipants: true }));
  }
  return { held: true };
}

// Transferência confirmada: 1) reserva da sessão (nunca duas transferências); 2) cliente → corretor, pelo caminho único da WA-18 (atribuição, histórico da
// roleta, conversa do Oficial e aviso/push no padrão existente); 3) aviso ao cliente e ao corretor.
async function finishTransferTo(session, pick, reason, config, now, conversation, fromStatuses) {
  const claimed = await updateSession(session.id, { status: STATUSES.transferred, transfer_reason: reason, transferred_to: pick, transferred_at: now.toISOString(), ended_at: now.toISOString(), end_reason: "transferido" }, fromStatuses);
  if (!claimed) return { skipped: "ja_tratada" };
  const { releaseAdWaitingClient } = await import("./whatsapp-sponsored-lead");
  const released = await releaseAdWaitingClient({ clientId: session.client_id, via: "official_flow", directBrokerId: pick });
  if (!released?.released) {
    await updateSession(session.id, { status: STATUSES.stopped, end_reason: `cliente_nao_liberado:${released?.skipped || "?"}` });
    return { skipped: released?.skipped || "nao_liberado" };
  }
  await saveRotation(pick);
  if (conversation) await sendNotice(session, conversation, "notice-transfer", buildTransferNoticeText({ profileName: session.profile_name }));
  await alertTransferredBroker(session, pick, reason);
  return { transferred: true, brokerId: pick };
}

async function alertTransferredBroker(session, brokerId, reason) {
  try {
    const client = await loadClient(session.client_id);
    const text = buildTransferAlertText({
      clientName: client?.full_name || session.profile_name,
      phone: session.phone,
      stepLabel: stepLabel(session.step),
      reasonLabel: reasonLabel(reason),
      cardUrl: `${getSiteBaseUrl()}/admin/simulacoes?query=${encodeURIComponent(client?.client_code || client?.full_name || session.phone)}`
    });
    const { sendOfficialAlert } = await import("./official-alert");
    // Sino + push do "Novo lead para você" já saem em releaseAdWaitingClient (afterRelease): aqui só o WhatsApp, adicional.
    await sendOfficialAlert({ userId: brokerId, text, clientId: session.client_id, crm: false });
  } catch (error) {
    console.error("Fluxo do anúncio: falha ao avisar o corretor pelo Oficial:", error?.message || error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhook: mensagens novas do cliente
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Chamado pelo webhook do Oficial DEPOIS do cadastro do lead (processOrganicLeads). Devolve o Set de telefones que o fluxo
 * tratou — o webhook os tira dos Fluxos de grafo, da palavra-chave e da resposta fora do horário.
 */
export async function processOfficialAdFlowInbound(events = [], now = new Date()) {
  const handled = new Set();
  const inbound = (events || []).filter((event) => event.event_type === "message" && event.direction === "inbound" && event.sender_phone);
  if (!inbound.length) return handled;
  const config = await loadOfficialAdFlowConfig();
  if (!config.enabled) return handled;
  for (const event of inbound) {
    try {
      if (await handleInbound(event, config, now)) handled.add(event.sender_phone);
    } catch (error) {
      if (isMissingTable(error)) console.error("Fluxo do anúncio ligado, mas a tabela official_ad_flow_sessions não existe (migration pendente).");
      else console.error("Fluxo do anúncio: falha ao processar a mensagem:", error?.message || error);
    }
  }
  return handled;
}

async function handleInbound(event, config, now) {
  const phone = event.sender_phone;
  const message = event.raw_payload?.message || {};
  const replyId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || "";
  const live = await loadLiveSession(phone);
  if (live) {
    if (live.status === STATUSES.offering) return true; // já pediu a equipe: aguarda um associado
    const decision = decideInbound({ replyId, messageType: event.message_type || message.type });
    if (decision.action === "ignore") return true;
    const conversation = await loadConversation(phone);
    if (!conversation) return false;
    if (decision.action === "step") await runStep(live, conversation, decision.step, config, now);
    else await requestTransfer(live, decision.reason, config, now);
    return true;
  }
  if (!isSponsoredAdReferral(message.referral)) return false;
  const conversation = await loadConversation(phone);
  if (!conversation?.id) return false;
  const [client, team, doNotContactReason, recent] = await Promise.all([
    loadClient(conversation.client_id),
    findInternalTeamPhone(phone),
    findDoNotContactInboundBlock(phone, conversation.client_id || null),
    hasRecentSession(phone, now)
  ]);
  const decision = decideStart({ config, hasAdReferral: true, client, conversation, isTeamPhone: Boolean(team), doNotContactReason, hasRecentSession: recent }, AD_WAITING_DISTRIBUTION);
  if (!decision.start) {
    console.info(JSON.stringify({ source: "official-ad-flow", event: "not_started", reason: decision.reason, messageId: event.message_id }));
    return false;
  }
  const profileName = event.contact_name || conversation.contact_name || "";
  const { data: session, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).insert({
    phone: canonicalWhatsappPhone(phone) || phone,
    conversation_id: conversation.id,
    client_id: client.id,
    profile_name: String(profileName).slice(0, 120),
    step: STEPS.greeted,
    status: STATUSES.active,
    step_entered_at: now.toISOString(),
    last_client_at: now.toISOString(),
    form_token: generateFormToken()
  }).select("*").single();
  if (error?.code === "23505") return true; // outra entrega do mesmo webhook já iniciou
  if (error) throw error;
  await sendFlowMessage({ session, conversation, label: "greeting", built: buildGreetingMessage(profileName, now) });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cron (whatsapp-flows): cutucada, transferência por silêncio, transferência pendente
// ---------------------------------------------------------------------------------------------------------------------

export async function processOfficialAdFlowTimers({ now = new Date(), limit = 40 } = {}) {
  const config = await loadOfficialAdFlowConfig();
  if (!config.enabled) return { skipped: "desligado" };
  const { data: sessions, error } = await db().from(OFFICIAL_AD_FLOW_TABLE).select("*").in("status", LIVE_STATUSES).order("step_entered_at", { ascending: true }).limit(limit);
  if (error) {
    if (isMissingTable(error)) return { skipped: "sem_tabela" };
    throw error;
  }
  const counts = { nudged: 0, transferred: 0, pending: 0, stopped: 0, finished: 0, errors: 0 };
  for (const session of sessions || []) {
    try {
      const outcome = await runTimer(session, config, now);
      if (outcome in counts) counts[outcome] += 1;
    } catch (timerError) {
      counts.errors += 1;
      console.error("Fluxo do anúncio: falha no temporizador:", timerError?.message || timerError);
    }
  }
  return counts;
}

async function runTimer(session, config, now) {
  const conversation = await loadConversation(session.phone);
  const client = await loadClient(session.client_id);
  const stop = async (reason, status = STATUSES.stopped) => {
    await updateSession(session.id, { status, end_reason: reason, ended_at: now.toISOString() }, LIVE_STATUSES);
    return status === STATUSES.finished ? "finished" : "stopped";
  };
  if (!conversation || !client || conversation.private_at || conversation.deleted_at) return stop("conversa_ou_cliente_indisponivel");
  if (client.status === "do_not_contact" || client.status === "archived") return stop("fora_do_fluxo");
  if (client.last_form_submitted_at && new Date(client.last_form_submitted_at) > new Date(session.created_at)) return stop("formulario_enviado", STATUSES.finished);
  if (client.distribution_type !== AD_WAITING_DISTRIBUTION) return stop("cliente_fora_do_segurado");

  const humanSpoke = Boolean(conversation.last_human_reply_at && new Date(conversation.last_human_reply_at) > new Date(session.created_at));
  if (session.status === STATUSES.offering) return "idle"; // a oferta (lib/roulette-offer.js) cuida do prazo
  const decision = decideTimer({ session, now, config, humanSpoke });
  if (decision.action === "stop") return stop(decision.reason);
  if (decision.action === "nudge") {
    await sendFlowMessage({ session, conversation, label: "nudge", built: textMessage(buildNudgeText(session.profile_name, session.step)) });
    await updateSession(session.id, { nudged_at: now.toISOString() }, [STATUSES.active]);
    return "nudged";
  }
  if (decision.action === "transfer") {
    const result = await requestTransfer(session, decision.reason, config, now);
    return result.transferred ? "transferred" : "pending";
  }
  return "idle";
}
