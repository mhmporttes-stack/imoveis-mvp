import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findConversationByPhone, findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { SPONSORED_KIND, SPONSORED_LABEL, buildSponsoredOriginMetadata, isSponsoredAdReferral } from "./whatsapp-referral.mjs";

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
      notification_type: "automation",
      scheduled_at: new Date().toISOString()
    })));
  } catch (error) {
    console.warn("Falha ao avisar a gestão sobre o lead patrocinado:", error?.message || error);
  }
}

// Manda UM lead patrocinado para a roleta (idempotente). `conversation` = { id, contact_name, client_id }.
export async function routeSponsoredLead({ phone, contactName, referral, conversation, messageId = "" }) {
  const canonical = canonicalWhatsappPhone(phone);
  if (!canonical || !conversation?.id) return { skipped: "sem_conversa_ou_telefone" };
  if (conversation.client_id) return { skipped: "cliente_ja_vinculado" };

  const names = await resolveMetaAdNames(String(referral?.source_id || "").trim());
  const fullName = String(conversation.contact_name || contactName || "").trim().slice(0, 160) || "Cliente WhatsApp";
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

  // Aviso imediato ao corretor sorteado (a regra "NOVO LEAD" também envia push por conta própria).
  try {
    await db().from("crm_notifications").insert({
      recipient_user_id: result.broker_id,
      client_id: result.registration_id,
      title: "Novo lead do anúncio no WhatsApp",
      description: `${fullName} chegou por anúncio patrocinado e foi enviado(a) para você pela roleta. Abra o Chat e atenda.`,
      notification_type: "automation",
      scheduled_at: new Date().toISOString()
    });
  } catch (notifyError) {
    console.warn("Falha ao avisar o corretor do lead patrocinado:", notifyError?.message || notifyError);
  }
  return { registrationId: result.registration_id, brokerId: result.broker_id, created: true };
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
      const conversation = await findConversationByPhone(phone, "id, contact_name, client_id");
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

async function isTeamPhone(canonical) {
  try {
    // Só integrante ATIVO: o número de quem saiu da equipe (inativo) que volta a escrever é um contato normal.
    const { data } = await db().from("admin_users").select("phone").eq("status", "active").not("phone", "is", null);
    return (data || []).some((row) => canonicalWhatsappPhone(row.phone) === canonical);
  } catch {
    return false;
  }
}

export async function routeOrganicLead({ phone, contactName, conversation, messageId = "" }) {
  const canonical = canonicalWhatsappPhone(phone);
  if (!canonical || !conversation?.id) return { skipped: "sem_conversa_ou_telefone" };
  if (conversation.client_id) return { skipped: "cliente_ja_vinculado" };
  if (conversation.deleted_at) return { skipped: "conversa_excluida" };
  if (await isTeamPhone(canonical)) return { skipped: "numero_da_equipe" };

  const fullName = String(conversation.contact_name || contactName || "").trim().slice(0, 160) || "Cliente WhatsApp";

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
        acquisitionContext: {
          kind: ORGANIC_KIND,
          label: ORGANIC_LABEL,
          actor: "sistema",
          destination: "broker",
          metadata: { conversation_id: conversation.id, first_message_id: messageId || undefined }
        }
      });
      registrationId = registration?.id || null;
    }
    if (!registrationId) return { skipped: "cadastro_nao_criado" };
    await db().from("whatsapp_conversations").update({ client_id: registrationId, updated_at: new Date().toISOString() }).eq("id", conversation.id).is("client_id", null);
    return { registrationId, brokerId: conversation.assigned_user_id, created: !existing, alreadyExisted: Boolean(existing) };
  }
  const { data, error } = await db().rpc("whatsapp_get_or_create_roulette_client", {
    p_candidates: phoneLookupCandidates(canonical),
    p_full_name: fullName,
    p_phone: canonical,
    p_phone_normalized: canonical,
    p_context: {
      kind: ORGANIC_KIND,
      label: ORGANIC_LABEL,
      actor: "sistema",
      destination: "roulette",
      metadata: { conversation_id: conversation.id, first_message_id: messageId || undefined }
    },
    p_conversation_id: conversation.id,
    p_history_details: { source: "whatsapp", via: "contato_direto", conversationId: conversation.id, phoneLast4: canonical.slice(-4) }
  });
  if (error) throw error;

  const result = data || {};
  if (!result.registration_id) {
    console.error(JSON.stringify({ source: "whatsapp-organic-lead", event: "no_broker_available", conversationId: conversation.id }));
    return { skipped: "sem_corretor_disponivel" };
  }
  if (result.already_existed) return { registrationId: result.registration_id, alreadyExisted: true };

  try {
    await db().from("crm_notifications").insert({
      recipient_user_id: result.broker_id,
      client_id: result.registration_id,
      title: "Novo contato no WhatsApp",
      description: `${fullName} escreveu para o WhatsApp e foi cadastrado(a) e enviado(a) para você pela roleta. Abra o Chat e atenda.`,
      notification_type: "automation",
      scheduled_at: new Date().toISOString()
    });
  } catch (notifyError) {
    console.warn("Falha ao avisar o corretor do contato direto:", notifyError?.message || notifyError);
  }
  return { registrationId: result.registration_id, brokerId: result.broker_id, created: true };
}

const CONVERSATION_COLUMNS = "id, contact_name, client_id, assigned_user_id, deleted_at";

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
    .select(`${CONVERSATION_COLUMNS}, contact_phone, origin`)
    .is("client_id", null)
    .is("deleted_at", null)
    .neq("status", "finished")
    .gte("last_inbound_at", since)
    .order("last_inbound_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results = [];
  for (const conversation of data || []) {
    if (conversation.origin?.kind === "meta_ad") continue;
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
