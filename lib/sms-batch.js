import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { buildCampaignLink, createCampaign, rowToCampaign, CAMPAIGN_DESTINATION, CAMPAIGN_KIND } from "./campaigns";
import { recordClientStatusChange } from "./client-status-history";
import { clientDoNotContactPatch, contactDoNotContactPatch } from "./do-not-contact-core.mjs";
import { getTimeGreeting } from "./daily-report";
import { findInternalTeamPhone } from "./internal-phones";
import { phoneLookupCandidates } from "./phone-utils";
import { isManualAttemptHistory } from "./cold-list-core.mjs";
import { listManualReservedContactIds } from "./prospecting-manual-lists";
import {
  SMS_BATCH_CAMPAIGN_NAME,
  SMS_BATCH_COLD_NOTICE,
  SMS_BATCH_DEFAULT_LIMIT,
  SMS_BATCH_DEFAULT_TEMPLATE,
  SMS_BATCH_DEFAULT_TEMPLATE_2,
  SMS_BATCH_HISTORY_EVENT,
  SMS_BATCH_HISTORY_EVENT_2,
  SMS_BATCH_LIMIT_SETTING_ID,
  SMS_BATCH_RECENT_ATTEMPT_DAYS,
  SMS_BATCH_TEMPLATE_2_SETTING_ID,
  SMS_BATCH_TEMPLATE_SETTING_ID,
  SMS_EVENT,
  SMS_SKIP_REASON,
  buildSmsHrefs,
  buildSmsMetrics,
  groupSmsConversations,
  maskSmsPhone,
  normalizeSmsLimit,
  planSmsBatch,
  renderSmsText,
  smsFirstName,
  smsRemainingToday,
  smsSecondSkipReason,
  smsSkipReason,
  spDayStartIso,
  validateSmsTemplate
} from "./sms-batch-core.mjs";

// Lote de SMS (dono, 2026-11-02) — leitura/gravação. Regras puras em lib/sms-batch-core.mjs; migration
// 20261102120000_sms_batch_sends.sql (tabela sms_batch_sends: cada SMS enviado conta como TENTATIVA de contato).
// Só admin geral e gestor (guards nas páginas/rotas). Não toca em Meta Diária, pontuação nem ranking.

export class SmsBatchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function db() {
  const client = hasSupabaseAdminConfig ? getSupabaseAdminClient() : null;
  if (!client) throw new SmsBatchError("Supabase administrativo não configurado.", 503);
  return client;
}

const SCHEMA_MESSAGE = "A tabela do Lote de SMS ainda não existe no banco (migration 20261102120000_sms_batch_sends.sql pendente).";

function check(result) {
  if (result.error) {
    if (result.error.code === "42P01" || result.error.code === "PGRST205") throw new SmsBatchError(SCHEMA_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = check(await buildQuery().range(from, from + 999));
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));

// --- Configuração (crm_settings) -----------------------------------------------------------------------------------

export async function getSmsBatchSettings() {
  const rows = check(await db().from("crm_settings").select("id, setting_value").in("id", [SMS_BATCH_TEMPLATE_SETTING_ID, SMS_BATCH_TEMPLATE_2_SETTING_ID, SMS_BATCH_LIMIT_SETTING_ID]));
  const byId = new Map((rows || []).map((row) => [row.id, row.setting_value]));
  const template = String(byId.get(SMS_BATCH_TEMPLATE_SETTING_ID)?.template || "").trim() || SMS_BATCH_DEFAULT_TEMPLATE;
  const template2 = String(byId.get(SMS_BATCH_TEMPLATE_2_SETTING_ID)?.template || "").trim() || SMS_BATCH_DEFAULT_TEMPLATE_2;
  return { template, template2, limit: normalizeSmsLimit(byId.get(SMS_BATCH_LIMIT_SETTING_ID)?.limit ?? SMS_BATCH_DEFAULT_LIMIT) };
}

export async function saveSmsBatchSettings(input, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getSmsBatchSettings();
  const template = input?.template === undefined ? current.template : String(input.template).trim();
  const template2 = input?.template2 === undefined ? current.template2 : String(input.template2).trim();
  const problem = validateSmsTemplate(template) || validateSmsTemplate(template2, { second: true });
  if (problem) throw new SmsBatchError(problem);
  const limit = input?.limit === undefined ? current.limit : normalizeSmsLimit(input.limit);
  const now = new Date().toISOString();
  const by = auth?.profile?.id || null;
  const stamp = by ? { updated_at: now, updated_by: by } : { updated_at: now };
  check(await db().from("crm_settings").upsert([
    { id: SMS_BATCH_TEMPLATE_SETTING_ID, setting_value: { template }, ...stamp },
    { id: SMS_BATCH_TEMPLATE_2_SETTING_ID, setting_value: { template: template2 }, ...stamp },
    { id: SMS_BATCH_LIMIT_SETTING_ID, setting_value: { limit }, ...stamp }
  ], { onConflict: "id" }));
  return { template, template2, limit };
}

// --- Campanha de origem "SMS" (reaproveita o Gerador de Links: /c/<código>, visualizações, origem permanente, tag) ---

export async function ensureSmsCampaign() {
  const find = async () => {
    const rows = check(await db().from("campaigns").select("*").eq("name", SMS_BATCH_CAMPAIGN_NAME).eq("kind", CAMPAIGN_KIND.CUSTOM).is("deleted_at", null).order("created_at", { ascending: true }).limit(1));
    return rows?.[0] ? rowToCampaign(rows[0]) : null;
  };
  const campaign = (await find()) || (await createCampaign({ name: SMS_BATCH_CAMPAIGN_NAME, destinationType: CAMPAIGN_DESTINATION.ROULETTE }));
  return { id: campaign.id, link: buildCampaignLink(campaign) };
}

// --- Elegibilidade: fatos do banco + regra pura ---------------------------------------------------------------------

const CONTACT_COLUMNS = "id, name, phone_normalized, status, assigned_user_id, owner_user_id, last_broker_id, last_attempt_at, registration_id, created_at";

// Junta, para uma página de contatos da fila, tudo o que a regra pura (smsSkipReason) precisa saber.
async function attachFacts(rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const phones = [...new Set(rows.flatMap((row) => phoneLookupCandidates(row.phone_normalized)))];
  const reserved = await listManualReservedContactIds();
  const [rounds, history, clients, conversations, sent] = await Promise.all([
    Promise.all(chunk(ids, 200).map(async (part) => check(await db().from("daily_goal_rounds").select("prospecting_contact_id").in("prospecting_contact_id", part)))),
    Promise.all(chunk(ids, 200).map(async (part) => check(await db().from("prospecting_history").select("contact_id, event_type, details").in("contact_id", part).in("event_type", ["claimed", "prospecting_started", "bulk_assigned", "returned", "auto_returned", "daily_goal_round_hibernated"])))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("simulation_registrations").select("phone_normalized").in("phone_normalized", part)))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("whatsapp_conversations").select("contact_phone").in("contact_phone", part)))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("sms_batch_sends").select("phone_normalized").in("phone_normalized", part))))
  ]);
  const roundIds = new Set(rounds.flat().map((row) => row.prospecting_contact_id));
  const triedIds = new Set(history.flat().filter((row) => (["claimed", "prospecting_started"].includes(row.event_type) ? isManualAttemptHistory(row) : true)).map((row) => row.contact_id));
  const clientPhones = new Set(clients.flat().map((row) => row.phone_normalized));
  const conversationPhones = new Set(conversations.flat().map((row) => row.contact_phone));
  const smsPhones = new Set(sent.flat().map((row) => row.phone_normalized));
  const inSet = (set, phone) => phoneLookupCandidates(phone).some((candidate) => set.has(candidate));
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    name: row.name || "",
    phone: row.phone_normalized,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    ownerUserId: row.owner_user_id,
    lastBrokerId: row.last_broker_id,
    lastAttemptAt: row.last_attempt_at,
    registrationId: row.registration_id,
    createdAt: row.created_at,
    reserved: reserved.has(row.id),
    hasRound: roundIds.has(row.id),
    hasManualAttempt: triedIds.has(row.id),
    isClientPhone: inSet(clientPhones, row.phone_normalized),
    hasConversation: inSet(conversationPhones, row.phone_normalized),
    smsSent: inSet(smsPhones, row.phone_normalized),
    isInternalPhone: Boolean(await findInternalTeamPhone(row.phone_normalized))
  })));
}

// Pré-filtro no banco (só barateia a busca; a decisão é sempre de smsSkipReason): Base da Imobiliária, disponível,
// sem ninguém atendendo e sem tentativa gravada. Mais antigos na base primeiro.
function baseQuery() {
  return db().from("prospecting_contacts").select(CONTACT_COLUMNS)
    .eq("status", "available").is("owner_user_id", null).is("assigned_user_id", null)
    .is("last_broker_id", null).is("last_attempt_at", null).is("registration_id", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true });
}

const PAGE = 400;
const MAX_PAGES = 15;

async function pickBatch(room) {
  const items = [];
  const skipped = {};
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES && items.length < room; page += 1) {
    const rows = check(await baseQuery().range(page * PAGE, page * PAGE + PAGE - 1)) || [];
    if (!rows.length) break;
    const candidates = await attachFacts(rows);
    // O mesmo telefone em páginas diferentes não pode entrar duas vezes: planSmsBatch deduplica dentro da página;
    // aqui, entre páginas.
    const plan = planSmsBatch(candidates, { limit: room - items.length, sentToday: 0 });
    for (const item of plan.items) {
      const key = phoneLookupCandidates(item.phone).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    for (const [reason, count] of Object.entries(plan.skipped)) skipped[reason] = (skipped[reason] || 0) + count;
    if (rows.length < PAGE) break;
  }
  return { items, skipped };
}

async function countSentSince(sinceIso) {
  const result = await db().from("sms_batch_sends").select("id", { count: "exact", head: true }).eq("event", SMS_EVENT.FIRST).gte("created_at", sinceIso);
  check(result);
  return result.count || 0;
}

// --- Tela ---------------------------------------------------------------------------------------------------------

export async function loadSmsBatch(auth) {
  assertGeneralAdminOrManager(auth);
  const [settings, campaign] = await Promise.all([getSmsBatchSettings(), ensureSmsCampaign()]);
  const sentToday = await countSentSince(spDayStartIso());
  const room = smsRemainingToday(settings.limit, sentToday);
  const [batch, eventRows, metrics] = await Promise.all([
    room ? pickBatch(room) : Promise.resolve({ items: [], skipped: {} }),
    // Todos os envios (a 2ª mensagem espera por tempo indeterminado): 1ª, 2ª e SAIR, com o contato da fila.
    fetchAll(() => db().from("sms_batch_sends").select("id, phone_normalized, event, created_at, contact_id, contact:prospecting_contacts(name, status)").order("created_at", { ascending: true })),
    loadSmsBatchMetrics(campaign.id)
  ]);
  // [Saudação] pela função única do projeto (horário de São Paulo), no momento em que a lista é montada.
  const greeting = getTimeGreeting();
  const items = batch.items.map((item) => {
    const text = renderSmsText(settings.template, { name: item.name, link: campaign.link, greeting });
    const hrefs = buildSmsHrefs(item.phone, text);
    return { id: item.id, name: item.name, firstName: smsFirstName(item.name), phoneMasked: maskSmsPhone(item.phone), text, href: hrefs.primary, fallbackHref: hrefs.fallback };
  });
  const grouped = groupSmsConversations(eventRows.map((row) => ({ ...row, name: row.contact?.name || "", contactStatus: row.contact?.status || "" })));
  const present = (entry) => ({ id: entry.sendId, name: entry.name, phoneMasked: maskSmsPhone(entry.phone), sentAt: entry.sentAt, secondAt: entry.secondAt, state: entry.state });
  const awaiting = grouped.awaiting.map((entry) => {
    const text = renderSmsText(settings.template2, { name: entry.name, link: campaign.link, greeting });
    const hrefs = buildSmsHrefs(entry.phone, text);
    return { ...present(entry), href: hrefs.primary, fallbackHref: hrefs.fallback };
  });
  return {
    settings,
    link: campaign.link,
    notice: SMS_BATCH_COLD_NOTICE,
    progress: { sentToday, limit: settings.limit, remaining: room },
    items,
    skipped: batch.skipped,
    awaiting,
    done: grouped.done.slice(0, 100).map(present),
    metrics,
    loadedAt: new Date().toISOString()
  };
}

// --- Ações --------------------------------------------------------------------------------------------------------

// Toque em "Enviar SMS" confirmado: grava o envio (tentativa de contato). Reconfere a elegibilidade no servidor.
export async function markSmsSent(contactId, auth) {
  assertGeneralAdminOrManager(auth);
  const id = String(contactId || "").trim();
  if (!id) throw new SmsBatchError("Contato inválido.");
  const row = check(await db().from("prospecting_contacts").select(CONTACT_COLUMNS).eq("id", id).maybeSingle());
  if (!row) throw new SmsBatchError("Contato não encontrado.", 404);
  const [candidate] = await attachFacts([row]);
  const reason = smsSkipReason(candidate);
  if (reason === SMS_SKIP_REASON.SMS_SENT) return { alreadySent: true };
  if (reason) throw new SmsBatchError("Este contato não está mais disponível para o Lote de SMS.", 409);

  const campaign = await ensureSmsCampaign();
  const now = new Date();
  const nowIso = now.toISOString();
  const sent = check(await db().from("sms_batch_sends").insert({ phone_normalized: row.phone_normalized, contact_id: row.id, event: SMS_EVENT.FIRST, campaign_id: campaign.id, sent_by: auth?.profile?.id || null, created_at: nowIso }).select("id").single());
  // Conta como tentativa e sai da Prospecção por 30 dias (mesmo padrão da tentativa recente). Sem corretor: não é
  // atividade de ninguém, não mexe em Meta Diária/pontuação/ranking.
  const availableAfter = new Date(now.getTime() + SMS_BATCH_RECENT_ATTEMPT_DAYS * 86400000).toISOString();
  check(await db().from("prospecting_contacts").update({ status: "recent_attempt", last_attempt_at: nowIso, available_after: availableAfter, updated_at: nowIso }).eq("id", row.id).eq("status", "available").select("id"));
  check(await db().from("prospecting_history").insert({ contact_id: row.id, registration_id: null, user_id: null, event_type: SMS_BATCH_HISTORY_EVENT, details: { sentBy: auth?.profile?.id || null, sendId: sent.id } }));
  return { sendId: sent.id, sentAt: nowIso };
}

// Fatos para a regra pura da 2ª mensagem (smsSecondSkipReason), lidos do banco.
async function secondMessageFacts(firstSend) {
  const phones = phoneLookupCandidates(firstSend.phone_normalized);
  const [events, contact, clients] = await Promise.all([
    db().from("sms_batch_sends").select("event").in("phone_normalized", phones).then(check),
    firstSend.contact_id ? db().from("prospecting_contacts").select("status").eq("id", firstSend.contact_id).maybeSingle().then(check) : Promise.resolve(null),
    db().from("simulation_registrations").select("status").in("phone_normalized", phones).then(check)
  ]);
  const has = (event) => (events || []).some((row) => row.event === event);
  return {
    firstSent: firstSend.event === SMS_EVENT.FIRST,
    secondSent: has(SMS_EVENT.SECOND),
    optedOut: has(SMS_EVENT.OPT_OUT),
    doNotContact: contact?.status === "do_not_contact" || (clients || []).some((row) => row.status === "do_not_contact")
  };
}

// Toque em "Enviar 2ª mensagem" confirmado: só depois da 1ª, uma vez por telefone, nunca para SAIR/Não contactar.
// `sendId` = a linha da 1ª mensagem (sms_batch_sends).
export async function markSmsSecondSent(sendId, auth) {
  assertGeneralAdminOrManager(auth);
  const first = check(await db().from("sms_batch_sends").select("id, phone_normalized, contact_id, event, campaign_id").eq("id", String(sendId || "")).maybeSingle());
  if (!first) throw new SmsBatchError("Envio não encontrado.", 404);
  const reason = smsSecondSkipReason(await secondMessageFacts(first));
  if (reason === SMS_SKIP_REASON.SECOND_SENT) return { alreadySent: true };
  if (reason) throw new SmsBatchError("A 2ª mensagem não pode mais ser enviada a este contato.", 409);

  const nowIso = new Date().toISOString();
  const inserted = await db().from("sms_batch_sends").insert({ phone_normalized: first.phone_normalized, contact_id: first.contact_id, event: SMS_EVENT.SECOND, campaign_id: first.campaign_id, sent_by: auth?.profile?.id || null, created_at: nowIso }).select("id").single();
  // Banco ainda sem a migration 20261102140000 (o check de 'event' só aceita sent/opt_out).
  if (inserted.error?.code === "23514") throw new SmsBatchError("A 2ª mensagem ainda não está liberada no banco (migration 20261102140000_sms_batch_second.sql pendente).", 503);
  const sent = check(inserted);
  if (first.contact_id) check(await db().from("prospecting_history").insert({ contact_id: first.contact_id, registration_id: null, user_id: null, event_type: SMS_BATCH_HISTORY_EVENT_2, details: { sentBy: auth?.profile?.id || null, sendId: sent.id } }));
  return { sendId: sent.id, sentAt: nowIso };
}

const UNDO_WINDOW_MS = 10 * 60 * 1000;

// "Desfazer" logo após marcar (o SMS não chegou a ser enviado): apaga o registro; na 1ª ainda devolve o contato à fila.
export async function undoSmsSent(sendId, auth) {
  assertGeneralAdminOrManager(auth);
  const send = check(await db().from("sms_batch_sends").select("id, contact_id, event, created_at").eq("id", String(sendId || "")).maybeSingle());
  if (!send) return { undone: false };
  if (send.event !== SMS_EVENT.FIRST && send.event !== SMS_EVENT.SECOND) throw new SmsBatchError("Só um envio pode ser desfeito.");
  if (Date.now() - new Date(send.created_at).getTime() > UNDO_WINDOW_MS) throw new SmsBatchError("O prazo para desfazer passou.", 409);
  check(await db().from("sms_batch_sends").delete().eq("id", send.id));
  if (send.contact_id && send.event === SMS_EVENT.FIRST) {
    // Só devolve se o contato continua exatamente como o envio o deixou.
    check(await db().from("prospecting_contacts").update({ status: "available", last_attempt_at: null, available_after: null, updated_at: new Date().toISOString() }).eq("id", send.contact_id).eq("status", "recent_attempt").eq("last_attempt_at", send.created_at).select("id"));
    check(await db().from("prospecting_history").insert({ contact_id: send.contact_id, registration_id: null, user_id: null, event_type: "sms_batch_undone", details: { sendId: send.id } }));
  }
  return { undone: true };
}

// "Respondeu SAIR": Não contactar pelo caminho único (do-not-contact-core), em TODAS as linhas irmãs do telefone
// (fila de prospecção por telefone/cadastro e qualquer cadastro de cliente com o telefone). Mantém a atribuição.
export async function markSmsOptOut(sendId, auth) {
  assertGeneralAdminOrManager(auth);
  const send = check(await db().from("sms_batch_sends").select("id, phone_normalized, contact_id").eq("id", String(sendId || "")).maybeSingle());
  if (!send) throw new SmsBatchError("Envio não encontrado.", 404);
  const now = new Date().toISOString();
  const phones = phoneLookupCandidates(send.phone_normalized);

  const byPhone = check(await db().from("prospecting_contacts").select("id, registration_id").in("phone_normalized", phones));
  const registrationIds = new Set((byPhone || []).map((row) => row.registration_id).filter(Boolean));
  const own = send.contact_id ? check(await db().from("prospecting_contacts").select("id, registration_id").eq("id", send.contact_id).maybeSingle()) : null;
  if (own?.registration_id) registrationIds.add(own.registration_id);
  const siblingContacts = new Map((byPhone || []).map((row) => [row.id, row]));
  if (own) siblingContacts.set(own.id, own);
  if (registrationIds.size) {
    for (const row of check(await db().from("prospecting_contacts").select("id, registration_id").in("registration_id", [...registrationIds])) || []) siblingContacts.set(row.id, row);
  }
  const contactIds = [...siblingContacts.keys()];
  if (contactIds.length) {
    check(await db().from("prospecting_contacts").update(contactDoNotContactPatch(now, auth?.profile?.id || null)).in("id", contactIds).neq("status", "do_not_contact").select("id"));
    check(await db().from("prospecting_history").insert(contactIds.map((contactId) => ({ contact_id: contactId, registration_id: siblingContacts.get(contactId)?.registration_id || null, user_id: null, event_type: "do_not_contact", details: { source: "sms_batch_opt_out", reasonKey: "client_requested" } }))));
  }

  const clientRows = new Map();
  const byPhoneClients = check(await db().from("simulation_registrations").select("id, status").in("phone_normalized", phones));
  const byIdClients = registrationIds.size ? check(await db().from("simulation_registrations").select("id, status").in("id", [...registrationIds])) : [];
  for (const row of [...(byPhoneClients || []), ...(byIdClients || [])]) clientRows.set(row.id, row);
  const clients = [...clientRows.values()];
  for (const client of (clients || []).filter((row) => row.status !== "do_not_contact")) {
    const updated = check(await db().from("simulation_registrations").update(clientDoNotContactPatch(now)).eq("id", client.id).eq("status", client.status).select("id").maybeSingle());
    if (updated) {
      await recordClientStatusChange({ supabase: db(), clientId: client.id, previousStatus: client.status, newStatus: "do_not_contact", changedAt: now, changedBy: auth?.user?.email || "sistema", source: "sms_batch_opt_out" });
    }
  }

  check(await db().from("sms_batch_sends").insert({ phone_normalized: send.phone_normalized, contact_id: send.contact_id, event: SMS_EVENT.OPT_OUT, sent_by: auth?.profile?.id || null, created_at: now }));
  return { ok: true, contacts: contactIds.length, clients: (clients || []).length };
}
