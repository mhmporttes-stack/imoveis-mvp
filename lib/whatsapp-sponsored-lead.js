import "server-only";
import { findInternalTeamPhone } from "./internal-phones";
import { announceAlexaEvent } from "./alexa-service";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findConversationByPhone, findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { SPONSORED_KIND, SPONSORED_LABEL, buildSponsoredOriginMetadata, isSponsoredAdReferral, sanitizeContactFullName } from "./whatsapp-referral.mjs";
import { AD_WAITING_DISTRIBUTION, canReleaseAdWaitingClient, hasRepliedAfterAutomation } from "./whatsapp-ad-waiting-core.mjs";

// LEAD PATROCINADO (Click to WhatsApp): quem chega por anúncio da Meta e AINDA NÃO é cliente entra na
// ROLETA já existente — antes ele ficava só no Chat (o referral era guardado mas nada agia sobre ele) e
// só virava cliente quando alguém clicava "Adicionar ao CRM", que cadastrava para quem clicou, fora da roleta.
//
// Regras:
//  - só cliente NOVO (telefone em qualquer formato/9º dígito): cliente que já existe apenas tem a
//    conversa vinculada — não duplica, não volta à roleta, responsável preservado;
//  - o cliente, a escolha do corretor (roleta por presença), o histórico da roleta e a atribuição da
//    conversa ao MESMO corretor acontecem numa ÚNICA transação do banco, serializada por telefone
//    (webhook duplicado/simultâneo = um cliente, uma atribuição);
//  - contatos orgânicos (sem referral de anúncio) seguem a regra de sempre.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Nomes de campanha/conjunto/anúncio a partir do ID do anúncio (cache local da sync de Meta Ads).
// A Meta NÃO manda esses nomes no webhook — só quando o ID casa com um anúncio já sincronizado.
async function resolveMetaAdNames(sourceId) {
  if (!sourceId) return {};
  const names = { ad_id: sourceId };
  try {
    const supabase = db();
    const { data: ad } = await supabase.from("meta_ad_entities").select("ad_account_id, entity_id, name, parent_id").eq("entity_type", "ad").eq("entity_id", sourceId).limit(1).maybeSingle();
    if (!ad) return names;
    names.ad_name = ad.name;
    if (ad.parent_id) {
      const { data: adset } = await supabase.from("meta_ad_entities").select("entity_id, name, parent_id").eq("ad_account_id", ad.ad_account_id).eq("entity_type", "adset").eq("entity_id", ad.parent_id).limit(1).maybeSingle();
      if (adset) {
        names.adset_id = adset.entity_id;
        names.adset_name = adset.name;
        if (adset.parent_id) {
          const { data: campaign } = await supabase.from("meta_ad_entities").select("entity_id, name").eq("ad_account_id", ad.ad_account_id).eq("entity_type", "campaign").eq("entity_id", adset.parent_id).limit(1).maybeSingle();
          if (campaign) {
            names.campaign_id = campaign.entity_id;
            names.campaign_name = campaign.name;
          }
        }
      }
    }
  } catch (error) {
    console.warn("Falha ao resolver os nomes do anúncio da Meta:", error?.message || error);
  }
  return names;
}

async function notifyStaff(title, description, clientId = null) {
  try {
    const { data: staff } = await db().from("admin_users").select("id").in("role", ["admin", "manager"]).eq("status", "active");
    if (!staff?.length) return;
    await db().from("crm_notifications").insert(staff.map((user) => ({
      recipient_user_id: user.id,
      client_id: clientId,
      title,
      description,
      notification_type: "new_client",
      scheduled_at: new Date().toISOString()
    })));
  } catch (error) {
    console.warn("Falha ao avisar a gestão sobre o lead patrocinado:", error?.message || error);
  }
}

// Manda UM lead patrocinado para a roleta (idempotente). `conversation` = { id, contact_name, client_id }.
// Regra do dono (2026-10-08): o clique no anúncio NÃO entra na roleta. O fluxo só responde (saudação + formulário);
// a roleta roda quando o cliente ENVIA o formulário e `linkConversationToFormRegistration` põe a conversa no corretor.
const ROUTE_AT_CLICK = false;

export async function routeSponsoredLead({ phone, contactName, referral, conversation, messageId = "" }) {
  if (!ROUTE_AT_CLICK) return { skipped: "roleta_so_no_formulario" };
  const canonical = canonicalWhatsappPhone(phone);
  if (!canonical || !conversation?.id) return { skipped: "sem_conversa_ou_telefone" };
  if (conversation.client_id) return { skipped: "cliente_ja_vinculado" };
  if (conversation.private_at) return { skipped: "conversa_particular" };
  if (conversation.origin?.crm_auto_create_suppressed_at) return { skipped: "cadastro_excluido_pelo_dono" };
  if (await isTeamPhone(canonical)) return { skipped: "numero_da_equipe" };

  const names = await resolveMetaAdNames(String(referral?.source_id || "").trim());
  const fullName = sanitizeContactFullName(conversation.contact_name || contactName);
  const metadata = buildSponsoredOriginMetadata(referral, names, { conversation_id: conversation.id, first_message_id: messageId || undefined });

  const { data, error } = await db().rpc("whatsapp_get_or_create_roulette_client", {
    p_candidates: phoneLookupCandidates(canonical),
    p_full_name: fullName,
    p_phone: canonical,
    p_phone_normalized: canonical,
    p_context: { kind: SPONSORED_KIND, label: SPONSORED_LABEL, actor: "sistema", destination: "roulette", metadata },
    p_conversation_id: conversation.id,
    p_history_details: { source: "whatsapp_ad", via: "click_to_whatsapp", conversationId: conversation.id, phoneLast4: canonical.slice(-4), adId: names.ad_id || null, campaignName: names.campaign_name || null }
  });
  if (error) throw error;

  const result = data || {};
  if (!result.registration_id) {
    // Nenhum corretor disponível na roleta: a conversa fica no Chat (a gestão é avisada) — nunca some.
    console.error(JSON.stringify({ source: "whatsapp-sponsored-lead", event: "no_broker_available", conversationId: conversation.id }));
    await notifyStaff("Lead patrocinado sem corretor", "Um cliente chegou por anúncio no WhatsApp, mas não há corretor disponível na roleta. Atribua manualmente.");
    return { skipped: "sem_corretor_disponivel" };
  }
  if (result.already_existed) return { registrationId: result.registration_id, alreadyExisted: true };

  if (!result.broker_id) {
    // Ninguém on-line: o cliente já foi criado (fila de espera da roleta,
    // lib/lead-distribution.js reassignPendingRouletteLeads assume assim que
    // o primeiro corretor ficar on-line) — só avisa a gestão, sem corretor.
    await notifyStaff("Lead patrocinado aguardando corretor", `${fullName} chegou por anúncio no WhatsApp, mas ninguém está on-line agora. Será distribuído automaticamente assim que um corretor entrar.`, result.registration_id);
    return { registrationId: result.registration_id, brokerId: null, created: true, pending: true };
  }

  // Aviso imediato ao corretor sorteado (a regra "NOVO LEAD" também envia push por conta própria).
  try {
    await db().from("crm_notifications").insert({
      recipient_user_id: result.broker_id,
      client_id: result.registration_id,
      title: "Novo lead do anúncio no WhatsApp",
      description: `${fullName} chegou por anúncio patrocinado e foi enviado(a) para você pela roleta. Abra o Chat e atenda.`,
      notification_type: "new_client",
      scheduled_at: new Date().toISOString()
    });
  } catch (notifyError) {
    console.warn("Falha ao avisar o corretor do lead patrocinado:", notifyError?.message || notifyError);
  }
  // Alexa do escritório: "Novo cliente aguardando atendimento" para lead de anúncio patrocinado.
  // Best-effort: nunca lança nem atrasa o fluxo.
  await announceAlexaEvent("new_client", { clienteNome: fullName, responsibleUserId: result.broker_id });
  return { registrationId: result.registration_id, brokerId: result.broker_id, created: true };
}

// Cliente que chegou pelo anúncio e AGORA enviou o formulário: a conversa do número oficial passa a ser dele e do
// corretor que a roleta escolheu (aparece no Chat do corretor). `relink` = cliente que já existia e voltou por anúncio
// (cadastro novo): troca o vínculo. Best-effort: nunca derruba o cadastro.
export async function linkConversationToFormRegistration({ phone, registrationId, responsibleUserId = null, relink = false }) {
  try {
    const conversation = await findConversationByPhone(phone, "id, client_id, origin");
    if (!conversation?.id || !registrationId) return;
    if (conversation.client_id === registrationId) return;
    // Conversa ligada a um cadastro ARQUIVADO (a conversa fica oculta do Chat): o cliente voltou e preencheu o formulário,
    // então ela passa para o cadastro novo e reaparece no Chat do corretor.
    let linkedArchived = false;
    if (conversation.client_id && !relink) {
      const { data: linked } = await db().from("simulation_registrations").select("status").eq("id", conversation.client_id).maybeSingle();
      linkedArchived = linked?.status === "archived";
      if (!linkedArchived) return;
    }
    const patch = { client_id: registrationId, updated_at: new Date().toISOString() };
    if (linkedArchived || relink) {
      const { archived_hidden_at: _hidden, ...origin } = conversation.origin || {};
      Object.assign(patch, { deleted_at: null, deleted_by: null, origin });
    }
    if (responsibleUserId) patch.assigned_user_id = responsibleUserId;
    await db().from("whatsapp_conversations").update(patch).eq("id", conversation.id);
  } catch (error) {
    console.warn("Falha ao ligar a conversa do WhatsApp ao formulário:", error?.message || error);
  }
}

// Webhook: eventos NOVOS (já deduplicados por event_key) com referral de anúncio.
export async function processSponsoredLeads(events) {
  const byPhone = new Map();
  for (const event of events || []) {
    if (event.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    const referral = event.raw_payload?.message?.referral;
    if (!isSponsoredAdReferral(referral)) continue;
    if (!byPhone.has(event.sender_phone)) byPhone.set(event.sender_phone, { event, referral });
  }

  const results = [];
  for (const [phone, { event, referral }] of byPhone) {
    try {
      const conversation = await findConversationByPhone(phone, "id, contact_name, client_id, origin");
      results.push(await routeSponsoredLead({ phone, contactName: event.contact_name, referral, conversation, messageId: event.message_id }));
    } catch (error) {
      console.error("Falha ao enviar o lead patrocinado para a roleta:", error?.message || error);
      results.push({ error: String(error?.message || error).slice(0, 200) });
    }
  }
  return results;
}

// CONTATO DIRETO (sem anúncio): quem escreve para o número oficial e AINDA NÃO é cliente vira cliente
// automaticamente, pela MESMA roleta e função de banco do lead patrocinado (cliente + corretor por
// presença + histórico da roleta + conversa atribuída ao mesmo corretor, numa transação só).
//
// Regras:
//  - telefone que já é cliente (qualquer formato/9º dígito) só tem a conversa vinculada — não duplica;
//  - conversa que alguém já assumiu no Chat não é redistribuída (o botão "Adicionar ao CRM" continua
//    valendo para esse caso: o cliente vai para quem está atendendo);
//  - conversa excluída/finalizada e número de integrante da equipe nunca viram cliente sozinhos.
const ORGANIC_KIND = "whatsapp_organic";
const ORGANIC_LABEL = "WhatsApp — Contato direto";

// Número da equipe (cadastro ou WhatsApp conectado de usuário ativo): fonte
// única em lib/internal-phones.js.
async function isTeamPhone(canonical) {
  return Boolean(await findInternalTeamPhone(canonical));
}

async function originContextFor(conversation, messageId = "") {
  const base = { conversation_id: conversation.id, first_message_id: messageId || undefined };
  const referral = conversation.origin?.referral;
  if (!isSponsoredAdReferral(referral)) return { kind: ORGANIC_KIND, label: ORGANIC_LABEL, metadata: base };
  const names = await resolveMetaAdNames(String(referral?.source_id || "").trim());
  return { kind: SPONSORED_KIND, label: SPONSORED_LABEL, metadata: buildSponsoredOriginMetadata(referral, names, base) };
}

export async function routeOrganicLead({ phone, contactName, conversation, messageId = "" }) {
  const canonical = canonicalWhatsappPhone(phone);
  if (!canonical || !conversation?.id) return { skipped: "sem_conversa_ou_telefone" };
  if (conversation.client_id) return { skipped: "cliente_ja_vinculado" };
  if (conversation.private_at) return { skipped: "conversa_particular" };
  if (conversation.origin?.crm_auto_create_suppressed_at) return { skipped: "cadastro_excluido_pelo_dono" };
  if (conversation.deleted_at) return { skipped: "conversa_excluida" };
  if (await isTeamPhone(canonical)) return { skipped: "numero_da_equipe" };

  const fullName = sanitizeContactFullName(conversation.contact_name || contactName);
  // Conversa que veio de ANÚNCIO (referral na conversa): desde que a roleta deixou de rodar no clique (2026-10-08), o
  // cliente só era cadastrado aqui, como "Contato direto", e saía da aba Patrocinado. Mantém a origem de anúncio.
  const context = await originContextFor(conversation, messageId);

  // Conversa que alguém já assumiu no Chat: o cliente é cadastrado PARA QUEM ATENDE (não passa pela
  // roleta, senão a conversa trocaria de mãos no meio do atendimento).
  if (conversation.assigned_user_id) {
    const existing = (await findLatestRegistrationIdsByPhones([canonical])).get(canonical) || null;
    let registrationId = existing;
    if (!registrationId) {
      const { createDirectContactRegistration } = await import("./simulation-registrations");
      const registration = await createDirectContactRegistration({
        fullName,
        phone: canonical,
        responsibleUserId: conversation.assigned_user_id,
        acquisitionContext: { ...context, actor: "sistema", destination: "broker" }
      });
      registrationId = registration?.id || null;
    }
    if (!registrationId) return { skipped: "cadastro_nao_criado" };
    await db().from("whatsapp_conversations").update({ client_id: registrationId, updated_at: new Date().toISOString() }).eq("id", conversation.id).is("client_id", null);
    return { registrationId, brokerId: conversation.assigned_user_id, created: !existing, alreadyExisted: Boolean(existing) };
  }
  // Anúncio de WhatsApp (regra do dono, 2026-10-09 — WA-18): a mensagem que abre a conversa NÃO leva à roleta. O
  // cliente é cadastrado em "Atendimento automático" com o DONO e fica fora da roleta até responder depois das
  // mensagens automáticas (ou preencher o formulário). Já respondeu (ex.: o cadastro falhou antes): roleta, como sempre.
  if (context.kind === SPONSORED_KIND && !(await conversationHasReply(conversation.id))) {
    return parkAdLead({ canonical, fullName, conversation, context });
  }
  const { data, error } = await db().rpc("whatsapp_get_or_create_roulette_client", {
    p_candidates: phoneLookupCandidates(canonical),
    p_full_name: fullName,
    p_phone: canonical,
    p_phone_normalized: canonical,
    p_context: { ...context, actor: "sistema", destination: "roulette" },
    p_conversation_id: conversation.id,
    p_history_details: { source: context.kind === SPONSORED_KIND ? "whatsapp_ad" : "whatsapp", via: context.kind === SPONSORED_KIND ? "anuncio_mensagem" : "contato_direto", conversationId: conversation.id, phoneLast4: canonical.slice(-4) }
  });
  if (error) throw error;

  const result = data || {};
  if (!result.registration_id) {
    console.error(JSON.stringify({ source: "whatsapp-organic-lead", event: "no_broker_available", conversationId: conversation.id }));
    return { skipped: "sem_corretor_disponivel" };
  }
  if (result.already_existed) return { registrationId: result.registration_id, alreadyExisted: true };

  if (!result.broker_id) {
    // Ninguém on-line: o cliente já foi criado (fila de espera da roleta,
    // lib/lead-distribution.js reassignPendingRouletteLeads assume assim que
    // o primeiro corretor ficar on-line) — só avisa a gestão, sem corretor.
    await notifyStaff("Novo contato no WhatsApp aguardando corretor", `${fullName} escreveu para o WhatsApp, mas ninguém está on-line agora. Será distribuído automaticamente assim que um corretor entrar.`, result.registration_id);
    return { registrationId: result.registration_id, brokerId: null, created: true, pending: true };
  }

  try {
    await db().from("crm_notifications").insert({
      recipient_user_id: result.broker_id,
      client_id: result.registration_id,
      title: "Novo contato no WhatsApp",
      description: `${fullName} escreveu para o WhatsApp e foi cadastrado(a) e enviado(a) para você pela roleta. Abra o Chat e atenda.`,
      notification_type: "new_client",
      scheduled_at: new Date().toISOString()
    });
  } catch (notifyError) {
    console.warn("Falha ao avisar o corretor do contato direto:", notifyError?.message || notifyError);
  }
  // Alexa do escritório: contato direto no número oficial também avisa "Novo cliente aguardando atendimento"
  // (WhatsApp pessoal do corretor NÃO avisa). Best-effort: nunca lança nem atrasa o fluxo.
  await announceAlexaEvent("new_client", { clienteNome: fullName, responsibleUserId: result.broker_id });
  return { registrationId: result.registration_id, brokerId: result.broker_id, created: true };
}

const CONVERSATION_COLUMNS = "id, contact_name, client_id, assigned_user_id, deleted_at, origin, private_at";

// Webhook: mensagens NOVAS (já deduplicadas por event_key) de quem ainda não é cliente.
export async function processOrganicLeads(events) {
  const byPhone = new Map();
  for (const event of events || []) {
    if (event.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    if (event.message_type === "reaction") continue;
    if (!byPhone.has(event.sender_phone)) byPhone.set(event.sender_phone, event);
  }

  const results = [];
  for (const [phone, event] of byPhone) {
    try {
      const conversation = await findConversationByPhone(phone, CONVERSATION_COLUMNS);
      if (conversation?.client_id && isSponsoredAdReferral(conversation.origin?.referral)) {
        results.push(await releaseAdWaitingClientOnReply(conversation));
        continue;
      }
      results.push(await routeOrganicLead({ phone, contactName: event.contact_name, conversation, messageId: event.message_id }));
    } catch (error) {
      console.error("Falha ao cadastrar o contato direto do WhatsApp:", error?.message || error);
      results.push({ error: String(error?.message || error).slice(0, 200) });
    }
  }
  return results;
}

// Rede de segurança (cron de 1 min): conversa com mensagem do cliente nas últimas 24h que ainda não
// virou cliente (falha momentânea no webhook, ou já existia antes desta regra). O banco garante que
// nunca duplica. Anúncio patrocinado tem a sua própria reconciliação, abaixo.
export async function reconcileOrganicLeads({ limit = 10 } = {}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select(`${CONVERSATION_COLUMNS}, contact_phone`)
    // Só o número oficial: a conversa de um WhatsApp pessoal já tem o cliente
    // do corretor dono da linha (criado no recebimento) e nunca vai à roleta.
    .eq("session_key", "00000000-0000-0000-0000-000000000000")
    .is("client_id", null)
    .is("deleted_at", null)
    .neq("status", "finished")
    .gte("last_inbound_at", since)
    .order("last_inbound_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results = [];
  for (const conversation of data || []) {
    // Conversa de anúncio também passa aqui desde 2026-10-09 (WA-18): routeOrganicLead a cadastra com o dono (sem
    // resposta) ou pela roleta (já respondeu). Antes era pulada porque a roleta do anúncio tinha reconciliação própria.
    try {
      results.push(await routeOrganicLead({ phone: conversation.contact_phone, contactName: conversation.contact_name, conversation }));
    } catch (routeError) {
      console.error("Falha ao reconciliar o contato direto:", routeError?.message || routeError);
    }
  }
  return results;
}

// Rede de segurança (cron de 1 min): conversa de anúncio das últimas 24h que ainda não virou cliente
// (falha momentânea no webhook) volta a tentar. O banco garante que nunca duplica.
export async function reconcileSponsoredLeads({ limit = 10 } = {}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select("id, contact_phone, contact_name, client_id, origin, created_at")
    .eq("session_key", "00000000-0000-0000-0000-000000000000")
    .is("client_id", null)
    .is("deleted_at", null)
    .eq("origin->>kind", "meta_ad")
    .gte("created_at", since)
    .limit(limit);
  if (error) throw error;

  const results = [];
  for (const conversation of data || []) {
    const referral = conversation.origin?.referral;
    if (!isSponsoredAdReferral(referral)) continue;
    try {
      results.push(await routeSponsoredLead({ phone: conversation.contact_phone, contactName: conversation.contact_name, referral, conversation }));
    } catch (routeError) {
      console.error("Falha ao reconciliar o lead patrocinado:", routeError?.message || routeError);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLIENTE DO ANÚNCIO AGUARDANDO (regra do dono, 2026-10-09 — BUSINESS_RULES WA-18). Regras puras em
// lib/whatsapp-ad-waiting-core.mjs. Cadastro "segurado" = distribution_type AD_WAITING_DISTRIBUTION, responsável = dono,
// "Atendimento automático", sem pending_distribution_at: fora da roleta, da fila de espera e da REDISTRIBUIÇÃO.

async function ownerProfileId() {
  const { listAdminProfiles, isOwnerAdminEmail } = await import("./admin-profiles");
  return (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email) && profile.status === "active")?.id || "";
}

async function conversationHasReply(conversationId) {
  const { data, error } = await db()
    .from("whatsapp_messages")
    .select("direction, sender_type, message_type, status, message_at")
    .eq("conversation_id", conversationId)
    .neq("direction", "internal")
    .order("message_at", { ascending: true })
    .limit(300);
  if (error) throw error;
  return hasRepliedAfterAutomation(data || []);
}

// Cadastra o cliente do anúncio com o dono, fora da roleta (mesma função de banco do canal direto: cliente + conversa
// numa transação, serializada por telefone — nunca duplica). Depois troca a marca para "aguardando anúncio".
async function parkAdLead({ canonical, fullName, conversation, context }) {
  const ownerId = await ownerProfileId();
  if (!ownerId) return { skipped: "dono_nao_encontrado" };
  const { data, error } = await db().rpc("whatsapp_get_or_create_client_for_broker", {
    p_candidates: phoneLookupCandidates(canonical),
    p_full_name: fullName,
    p_phone: canonical,
    p_phone_normalized: canonical,
    p_broker_id: ownerId,
    p_context: { ...context, actor: "sistema", destination: "owner_waiting" },
    p_conversation_id: conversation.id,
    p_history_details: { source: "whatsapp_ad", via: "anuncio_aguardando_resposta", conversationId: conversation.id, phoneLast4: canonical.slice(-4) }
  });
  if (error) throw error;
  const result = data || {};
  if (!result.registration_id) return { skipped: "cadastro_nao_criado" };
  if (result.already_existed) return { registrationId: result.registration_id, alreadyExisted: true };
  const { error: markError } = await db()
    .from("simulation_registrations")
    .update({ distribution_type: AD_WAITING_DISTRIBUTION })
    .eq("id", result.registration_id)
    .eq("distribution_type", "direct_channel");
  if (markError) throw markError;
  return { registrationId: result.registration_id, ownerId, created: true, waiting: true };
}

// Webhook: mensagem nova numa conversa de anúncio que já tem cliente. Se o cliente está "segurado" e esta mensagem é
// uma RESPOSTA (depois das automáticas), vai para a roleta.
async function releaseAdWaitingClientOnReply(conversation) {
  const { data: client, error } = await db().from("simulation_registrations").select("id, status, distribution_type").eq("id", conversation.client_id).maybeSingle();
  if (error) throw error;
  if (!canReleaseAdWaitingClient(client, { via: "reply" })) return { skipped: "nao_aguardando" };
  if (!(await conversationHasReply(conversation.id))) return { skipped: "sem_resposta" };
  return releaseAdWaitingClient({ clientId: client.id, via: "reply" });
}

// O cliente está "segurado" (anúncio, aguardando resposta/formulário)? Usado pelo formulário antes de decidir.
export async function isAdWaitingRegistration(clientId) {
  if (!clientId) return false;
  const { data, error } = await db().from("simulation_registrations").select("distribution_type").eq("id", clientId).maybeSingle();
  if (error) throw error;
  return data?.distribution_type === AD_WAITING_DISTRIBUTION;
}

// Tira o cliente do "segurado": respondeu (via "reply") ou preencheu o formulário (via "form"). Formulário por link
// pessoal de corretor (`directBrokerId`) vai direto para esse corretor, como qualquer link pessoal; senão, roleta por
// presença (ninguém on-line: fica com o dono na fila de espera, ROL-2b). Idempotente: só quem ainda está segurado.
export async function releaseAdWaitingClient({ clientId, via = "reply", directBrokerId = "", directBrokerLink = false, roulettePick = null }) {
  const supabase = db();
  const { data: client, error } = await supabase
    .from("simulation_registrations")
    .select("id, full_name, client_code, status, distribution_type, responsible_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!canReleaseAdWaitingClient(client, { via })) return { skipped: "nao_aguardando" };
  const ownerId = client.responsible_user_id || null;
  const now = new Date().toISOString();

  if (directBrokerId) {
    const { data: moved, error: moveError } = await supabase
      .from("simulation_registrations")
      .update({ distribution_type: "", direct_broker_link: Boolean(directBrokerLink), responsible_user_id: directBrokerId, previous_responsible_user_id: ownerId, responsible_changed_at: now, pending_distribution_at: null })
      .eq("id", client.id)
      .eq("distribution_type", AD_WAITING_DISTRIBUTION)
      .select("id");
    if (moveError) throw moveError;
    if (!moved?.length) return { skipped: "ja_liberado" };
    await afterRelease({ client, brokerId: directBrokerId, ownerId, via, roulette: null });
    return { released: true, brokerId: directBrokerId };
  }

  // 1) Reserva: vira cliente da roleta na fila de espera (com o dono). Se algo falhar depois, a fila o entrega.
  const { data: claimed, error: claimError } = await supabase
    .from("simulation_registrations")
    .update({ distribution_type: "round_robin", pending_distribution_at: now, responsible_changed_at: now })
    .eq("id", client.id)
    .eq("distribution_type", AD_WAITING_DISTRIBUTION)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return { skipped: "ja_liberado" };

  // 2) Corretor on-line pela roleta (a mesma de sempre).
  // (o formulário já sorteou ao resolver o link: `roulettePick`, sem girar a fila duas vezes).
  const { assignRoundRobinLead } = await import("./lead-distribution");
  const roulette = roulettePick || await assignRoundRobinLead();
  if (!roulette.brokerId) {
    await afterRelease({ client, brokerId: null, ownerId, via, roulette });
    return { released: true, brokerId: null, waiting: true };
  }
  const { data: assigned, error: assignError } = await supabase
    .from("simulation_registrations")
    .update({ responsible_user_id: roulette.brokerId, previous_responsible_user_id: ownerId, pending_distribution_at: null, responsible_changed_at: new Date().toISOString() })
    .eq("id", client.id)
    .not("pending_distribution_at", "is", null)
    .select("id");
  if (assignError) throw assignError;
  if (!assigned?.length) return { released: true, deliveredByQueue: true };
  await afterRelease({ client, brokerId: roulette.brokerId, ownerId, via, roulette });
  return { released: true, brokerId: roulette.brokerId };
}

async function afterRelease({ client, brokerId, ownerId, via, roulette }) {
  const supabase = db();
  const label = via === "form" ? "preencheu o formulário" : "respondeu no WhatsApp";
  // A conversa do número oficial acompanha o cliente: vai para o corretor (ou fica sem ninguém na fila de espera).
  const { error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .update({ assigned_user_id: brokerId, updated_at: new Date().toISOString() })
    .eq("client_id", client.id)
    .eq("session_key", "00000000-0000-0000-0000-000000000000");
  if (conversationError) console.warn("Falha ao passar a conversa do anúncio ao corretor:", conversationError.message || conversationError);

  const { recordLeadDistributionHistory } = await import("./lead-distribution");
  const { logClientJourneyEvent } = await import("./client-journey");
  await Promise.allSettled([
    recordLeadDistributionHistory({
      registration: { id: client.id, fullName: client.full_name },
      eventType: "assigned",
      fromUserId: ownerId,
      toUserId: brokerId,
      details: { source: "whatsapp_ad", via: via === "form" ? "anuncio_formulario" : "anuncio_resposta", presenceTier: roulette?.tier || "", skipped: roulette?.skippedNames || [], waitingForBroker: !brokerId }
    }),
    logClientJourneyEvent({
      clientId: client.id,
      eventType: "responsible_assigned",
      actor: { email: "sistema", name: "Sistema", role: "automacao" },
      details: { source: via === "form" ? "anuncio_formulario" : "anuncio_resposta", brokerId: brokerId || null, waitingQueue: !brokerId }
    })
  ]);

  if (!brokerId) {
    await notifyStaff("Cliente do anúncio aguardando corretor", `${client.full_name || "Um cliente"} ${label}, mas ninguém está on-line agora. Será distribuído automaticamente assim que um corretor entrar.`, client.id);
    return;
  }
  try {
    await supabase.from("crm_notifications").insert({
      recipient_user_id: brokerId,
      client_id: client.id,
      title: "Novo lead do anúncio no WhatsApp",
      description: `${client.full_name || "Um cliente"} chegou por anúncio, ${label} e foi enviado(a) para você. Abra o Chat e atenda.`,
      notification_type: "new_client",
      scheduled_at: new Date().toISOString()
    });
    const { sendPushToUser } = await import("./push-subscriptions");
    await sendPushToUser(brokerId, {
      kind: "new_client",
      title: "Novo lead para você",
      body: `${String(client.full_name || "Cliente").slice(0, 60)} está aguardando atendimento.`,
      url: `/admin/simulacoes?query=${encodeURIComponent(client.client_code || client.full_name || "")}`
    });
  } catch (notifyError) {
    console.warn("Falha ao avisar o corretor do cliente do anúncio:", notifyError?.message || notifyError);
  }
}

// Rede de segurança (cron scheduled-activities): cliente segurado que respondeu ou preencheu, mas a liberação falhou.
export async function reconcileAdWaitingClients({ limit = 30 } = {}) {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("simulation_registrations")
    .select("id, last_form_submitted_at")
    .eq("distribution_type", AD_WAITING_DISTRIBUTION)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const results = [];
  for (const client of data || []) {
    try {
      // Preencheu o formulário mas a liberação falhou no envio: roleta (o link pessoal, se houve, não é recuperável aqui).
      if (client.last_form_submitted_at) {
        results.push(await releaseAdWaitingClient({ clientId: client.id, via: "form" }));
        continue;
      }
      const { data: conversation } = await db().from("whatsapp_conversations").select("id, client_id").eq("client_id", client.id)
        .eq("session_key", "00000000-0000-0000-0000-000000000000").is("deleted_at", null).limit(1).maybeSingle();
      if (!conversation?.id || !(await conversationHasReply(conversation.id))) continue;
      results.push(await releaseAdWaitingClient({ clientId: client.id, via: "reply" }));
    } catch (releaseError) {
      console.error("Falha ao reconciliar o cliente do anúncio aguardando:", releaseError?.message || releaseError);
    }
  }
  return results;
}
