import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { AdminPermissionError, isAssociateProfile, isBrokerProfile, isGeneralAdminAuth, isManagerProfile } from "./admin-profiles";
import { buildCampaignLink, createCampaign, rowToCampaign, CAMPAIGN_DESTINATION, CAMPAIGN_KIND } from "./campaigns";
import { logClientJourneyEvent } from "./client-journey";
import { recordClientStatusChange } from "./client-status-history";
import { clientDoNotContactPatch, contactDoNotContactPatch } from "./do-not-contact-core.mjs";
import { getTimeGreeting } from "./daily-report";
import { findInternalTeamPhone } from "./internal-phones";
import { phoneComparisonKey, phoneLookupCandidates } from "./phone-utils";
import { isManualAttemptHistory } from "./cold-list-core.mjs";
import { getOfficePresenceSettings } from "./office-presence";
import { SMS_BATCH_OFFICE_ONLY_CODE, SMS_BATCH_OFFICE_ONLY_MESSAGE, smsOfficeDecision } from "./sms-batch-office-core.mjs";
import { listNoWhatsapp, loadWaCacheRows, openWaCheck } from "./sms-batch-whatsapp";
import { ensureWhatsapp, waCheckSummary } from "./sms-batch-wa-check.mjs";
import { listManualReservedContactIds } from "./prospecting-manual-lists";
import { isMissingReservationsTable, listActiveReservations, listBrokerReservedContactIds, releaseSmsReservation, reserveSmsContacts } from "./sms-batch-reservations.mjs";
import {
  SMS_BATCH_BROKER_TEMPLATE_SETTING_ID,
  SMS_BATCH_CAMPAIGN_NAME,
  SMS_BATCH_COLD_NOTICE,
  SMS_BATCH_DEFAULT_LIMIT,
  SMS_BATCH_DEFAULT_TEMPLATE,
  SMS_BATCH_DEFAULT_TEMPLATE_2,
  SMS_BATCH_DEFAULT_TEMPLATE_BROKER,
  SMS_BATCH_HISTORY_EVENT,
  SMS_BATCH_HISTORY_EVENT_2,
  SMS_BATCH_LIMIT_SETTING_ID,
  SMS_BATCH_RECENT_ATTEMPT_DAYS,
  SMS_BATCH_TEMPLATE_2_SETTING_ID,
  SMS_BATCH_TEMPLATE_SETTING_ID,
  SMS_BROKER_ORIGIN_EVENT,
  SMS_EVENT,
  SMS_SKIP_REASON,
  buildSmsHrefs,
  buildSmsMetrics,
  groupSmsConversations,
  inSmsPeriod,
  isSmsBrokerCampaign,
  maskSmsPhone,
  normalizeSmsLimit,
  planSmsBatch,
  renderSmsText,
  resolveSmsPeriod,
  resolveWaCache,
  scopeSmsEvents,
  smsBatchScope,
  smsFirstName,
  smsRemainingToday,
  smsSecondSkipReason,
  smsSkipReason,
  spDayKey,
  spDayStartIso,
  validateSmsTemplate
} from "./sms-batch-core.mjs";

// Lote de SMS (dono, 2026-11-02) — leitura/gravação. Regras puras em lib/sms-batch-core.mjs; migration
// 20261102120000_sms_batch_sends.sql (tabela sms_batch_sends: cada SMS enviado conta como TENTATIVA de contato).
// Dois lotes (dono, 2026-11-02): o da EQUIPE (admin geral e gestor, roleta como sempre) e o do CORRETOR (até 50/dia de contatos
// RESERVADOS só para ele por 24 h; o link é a campanha "SMS - Lote da base" daquele corretor: quem se cadastra é atribuído
// direto a ele, sem roleta). Escopo decidido no servidor (scopeOf). Não toca em Meta Diária, pontuação nem ranking.

export class SmsBatchError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.status = status;
    if (code) this.code = code;
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
  const rows = check(await db().from("crm_settings").select("id, setting_value").in("id", [SMS_BATCH_TEMPLATE_SETTING_ID, SMS_BATCH_TEMPLATE_2_SETTING_ID, SMS_BATCH_BROKER_TEMPLATE_SETTING_ID, SMS_BATCH_LIMIT_SETTING_ID]));
  const byId = new Map((rows || []).map((row) => [row.id, row.setting_value]));
  const template = String(byId.get(SMS_BATCH_TEMPLATE_SETTING_ID)?.template || "").trim() || SMS_BATCH_DEFAULT_TEMPLATE;
  const template2 = String(byId.get(SMS_BATCH_TEMPLATE_2_SETTING_ID)?.template || "").trim() || SMS_BATCH_DEFAULT_TEMPLATE_2;
  const templateBroker = String(byId.get(SMS_BATCH_BROKER_TEMPLATE_SETTING_ID)?.template || "").trim() || SMS_BATCH_DEFAULT_TEMPLATE_BROKER;
  return { template, template2, templateBroker, limit: normalizeSmsLimit(byId.get(SMS_BATCH_LIMIT_SETTING_ID)?.limit ?? SMS_BATCH_DEFAULT_LIMIT) };
}

export async function saveSmsBatchSettings(input, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getSmsBatchSettings();
  const template = input?.template === undefined ? current.template : String(input.template).trim();
  const template2 = input?.template2 === undefined ? current.template2 : String(input.template2).trim();
  const templateBroker = input?.templateBroker === undefined ? current.templateBroker : String(input.templateBroker).trim();
  const problem = validateSmsTemplate(template) || validateSmsTemplate(template2, { second: true }) || validateSmsTemplate(templateBroker);
  if (problem) throw new SmsBatchError(problem);
  const limit = input?.limit === undefined ? current.limit : normalizeSmsLimit(input.limit);
  const now = new Date().toISOString();
  const by = auth?.profile?.id || null;
  const stamp = by ? { updated_at: now, updated_by: by } : { updated_at: now };
  check(await db().from("crm_settings").upsert([
    { id: SMS_BATCH_TEMPLATE_SETTING_ID, setting_value: { template }, ...stamp },
    { id: SMS_BATCH_TEMPLATE_2_SETTING_ID, setting_value: { template: template2 }, ...stamp },
    { id: SMS_BATCH_BROKER_TEMPLATE_SETTING_ID, setting_value: { template: templateBroker }, ...stamp },
    { id: SMS_BATCH_LIMIT_SETTING_ID, setting_value: { limit }, ...stamp }
  ], { onConflict: "id" }));
  return { template, template2, templateBroker, limit };
}

// --- Quem usa qual lote (revalidado em TODA leitura e ação) ------------------------------------------------------------

// "team" = admin geral/gestor; "broker" = corretor (inclusive admin em "Alterar conta" como corretor: o perfil efetivo manda);
// associado e qualquer outro perfil: sem acesso.
function scopeOf(auth) {
  const profile = auth?.profile;
  const scope = smsBatchScope({ isGeneralAdmin: isGeneralAdminAuth(auth), isManager: isManagerProfile(profile), isBroker: isBrokerProfile(profile), isAssociate: isAssociateProfile(profile) });
  if (!scope || (scope === "broker" && !profile?.id)) throw new AdminPermissionError("O Lote de SMS não está disponível para este perfil.");
  return scope;
}

// --- Corretor só na imobiliária (PRO-18e, dono, 2026-11-02) ------------------------------------------------------------
// Chamada pela rota ANTES de qualquer leitura/ação. Só o corretor é verificado: o IP da requisição de agora precisa ser de uma
// rede cadastrada da imobiliária (mesma lista da ROL-2f). Sem rede cadastrada não há como verificar e nada é bloqueado.
// Fora da imobiliária só 'sent'/'sent-2' (SMS já enviado, fila do aparelho) são aceitos; a lista e as demais ações dão 403.
// Devolve a decisão (`recordOnly` = fora da imobiliária, aceito só para registrar).
export async function assertSmsBatchOffice(auth, ip, action = "load") {
  const scope = scopeOf(auth);
  const networks = scope === "broker" ? (await getOfficePresenceSettings()).networks : [];
  const decision = smsOfficeDecision({ scope, networks, ip, action });
  if (!decision.allowed) throw new SmsBatchError(SMS_BATCH_OFFICE_ONLY_MESSAGE, 403, SMS_BATCH_OFFICE_ONLY_CODE);
  return decision;
}

// --- Campanha de origem "SMS" (reaproveita o Gerador de Links: /c/<código>, visualizações, origem permanente, tag) ---

async function findSmsCampaign(brokerId) {
  let query = db().from("campaigns").select("*").eq("name", SMS_BATCH_CAMPAIGN_NAME).eq("kind", CAMPAIGN_KIND.CUSTOM).is("deleted_at", null);
  query = brokerId ? query.eq("broker_id", brokerId) : query.is("broker_id", null);
  const rows = check(await query.order("created_at", { ascending: true }).limit(1));
  return rows?.[0] ? rowToCampaign(rows[0]) : null;
}

// Lote da equipe: campanha pela roleta (sem corretor). Lote do corretor: UMA campanha por corretor, com destino fixo nele
// (campanha com corretor fixo atribui direto, sem roleta — resolveExternalLinkAssignment); mesmo nome, então a tag e a origem
// continuam "SMS - Lote da base".
export async function ensureSmsCampaign(brokerId = null) {
  let campaign = await findSmsCampaign(brokerId);
  if (!campaign) {
    try {
      campaign = await createCampaign(brokerId
        ? { name: SMS_BATCH_CAMPAIGN_NAME, destinationType: CAMPAIGN_DESTINATION.BROKER, brokerId }
        : { name: SMS_BATCH_CAMPAIGN_NAME, destinationType: CAMPAIGN_DESTINATION.ROULETTE });
    } catch (error) {
      // Dois toques ao mesmo tempo: o índice único (campaigns_sms_batch_broker_unique) barra o 2º; usa o que o 1º criou.
      if (error?.code !== "23505") throw error;
      campaign = await findSmsCampaign(brokerId);
      if (!campaign) throw error;
    }
  }
  return { id: campaign.id, link: buildCampaignLink(campaign) };
}

// Todas as campanhas "SMS - Lote da base": [{ id, broker_id }] (broker_id null = a da equipe).
async function listSmsCampaigns() {
  return check(await db().from("campaigns").select("id, broker_id").eq("name", SMS_BATCH_CAMPAIGN_NAME).eq("kind", CAMPAIGN_KIND.CUSTOM).is("deleted_at", null)) || [];
}

// Linha do tempo do cliente: "Veio por SMS do corretor X" (cadastro novo) ou, se o cliente já existia, o registro de que
// o atendimento atual foi MANTIDO (nunca reatribui). `campaign` no formato de rowToCampaign (traz brokerName). Melhor esforço.
export async function recordSmsBrokerOrigin({ campaign, clientId, existing = false, responsibleUserId = "" } = {}) {
  if (!clientId || !isSmsBrokerCampaign(campaign)) return;
  const name = campaign.brokerName || "corretor";
  await logClientJourneyEvent({
    clientId,
    eventType: SMS_BROKER_ORIGIN_EVENT,
    actor: { email: "sistema", name: "Sistema", role: "automacao" },
    details: {
      text: existing ? `Preencheu o cadastro pelo SMS do corretor ${name}. O cliente já existia: o atendimento atual foi mantido (sem reatribuir).` : `Veio por SMS do corretor ${name}.`,
      campaignId: campaign.id,
      brokerId: campaign.brokerId,
      existing: Boolean(existing),
      ...(existing && responsibleUserId ? { responsibleUserId } : {})
    }
  });
}

// --- Elegibilidade: fatos do banco + regra pura ---------------------------------------------------------------------

const CONTACT_COLUMNS = "id, name, phone_normalized, status, assigned_user_id, owner_user_id, last_broker_id, last_attempt_at, registration_id, created_at";

const RESERVATIONS_MESSAGE = "O Lote de SMS dos corretores ainda não está liberado no banco (migration 20261102160000_sms_batch_reservations.sql pendente).";

// Reservas válidas dos contatos: Map(contact_id -> broker_id). Tabela ainda sem migration: o Lote da equipe segue como
// antes (sem reservas); o do corretor recusa com aviso (`required`).
async function readReservations(ids, required) {
  try {
    const rows = await listActiveReservations(db(), ids);
    return new Map(rows.map((row) => [row.contact_id, row.broker_id]));
  } catch (error) {
    if (!isMissingReservationsTable(error)) throw error;
    if (required) throw new SmsBatchError(RESERVATIONS_MESSAGE, 503);
    return new Map();
  }
}

// Junta, para uma página de contatos da fila, tudo o que a regra pura (smsSkipReason) precisa saber.
// `viewerBrokerId`: o corretor que está vendo — a reserva DELE não bloqueia; a de outro corretor (ou qualquer uma, no lote da
// equipe) bloqueia. `wa`: contexto da checagem de WhatsApp (sem ele só lê a cache; nada é consultado).
async function attachFacts(rows, { viewerBrokerId = null, wa = null } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const phones = [...new Set(rows.flatMap((row) => phoneLookupCandidates(row.phone_normalized)))];
  const reserved = await listManualReservedContactIds();
  const [rounds, history, clients, conversations, sent, reservations, waRows] = await Promise.all([
    Promise.all(chunk(ids, 200).map(async (part) => check(await db().from("daily_goal_rounds").select("prospecting_contact_id").in("prospecting_contact_id", part)))),
    Promise.all(chunk(ids, 200).map(async (part) => check(await db().from("prospecting_history").select("contact_id, event_type, details").in("contact_id", part).in("event_type", ["claimed", "prospecting_started", "bulk_assigned", "returned", "auto_returned", "daily_goal_round_hibernated"])))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("simulation_registrations").select("phone_normalized").in("phone_normalized", part)))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("whatsapp_conversations").select("contact_phone").in("contact_phone", part)))),
    Promise.all(chunk(phones, 300).map(async (part) => check(await db().from("sms_batch_sends").select("phone_normalized").in("phone_normalized", part)))),
    readReservations(ids, Boolean(viewerBrokerId)),
    loadWaCacheRows(db(), rows.map((row) => row.phone_normalized), wa)
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
    brokerReserved: reservations.has(row.id) && reservations.get(row.id) !== viewerBrokerId,
    hasRound: roundIds.has(row.id),
    hasManualAttempt: triedIds.has(row.id),
    isClientPhone: inSet(clientPhones, row.phone_normalized),
    hasConversation: inSet(conversationPhones, row.phone_normalized),
    smsSent: inSet(smsPhones, row.phone_normalized),
    // true/false = checagem de WhatsApp vigente (30 dias); undefined = ainda sem checagem (entra; é consultado se couber).
    hasWhatsapp: resolveWaCache(waRows, row.phone_normalized),
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

// Páginas pequenas: na base real o 50º contato elegível aparece nas primeiras ~110 linhas, então a 1ª página já basta e as
// consultas de elegibilidade (telefones, rodadas, histórico) ficam curtas. Mesmo teto de varredura de antes (6.000 contatos).
const PAGE = 150;
const MAX_PAGES = 40;
// Tempo máximo de varredura: a tela abre com o que achou (lote menor) em vez de estourar o limite da função.
const SCAN_BUDGET_MS = 8000;

// `excludeIds`: contatos que o corretor já tem reservados (não entram de novo como "novos").
async function pickBatch(room, { viewerBrokerId = null, excludeIds = new Set(), wa } = {}) {
  const items = [];
  const skipped = {};
  const seen = new Set();
  const deadline = Date.now() + SCAN_BUDGET_MS;
  // O tempo gasto consultando o WhatsApp (com espaço de 1–2 s entre consultas) não conta no tempo de varredura da base.
  for (let page = 0; page < MAX_PAGES && items.length < room && Date.now() < deadline + wa.spentMs && !wa.exhausted; page += 1) {
    const rows = check(await baseQuery().range(page * PAGE, page * PAGE + PAGE - 1)) || [];
    if (!rows.length) break;
    const candidates = await attachFacts(rows.filter((row) => !excludeIds.has(row.id)), { viewerBrokerId, wa });
    // Elegibilidade só em smsSkipReason (planSmsBatch): inclui "sem_whatsapp" de checagens já guardadas. O mesmo telefone em
    // páginas diferentes não pode entrar duas vezes (aqui, entre páginas). Quem ainda não foi checado é consultado um a um,
    // em ordem, só até completar a vaga: sem WhatsApp = sai e a vaga vai para o próximo.
    const plan = planSmsBatch(candidates, { limit: candidates.length, sentToday: 0 });
    for (const item of plan.items) {
      if (items.length >= room) break;
      const key = phoneLookupCandidates(item.phone).join("|");
      if (seen.has(key)) continue;
      await ensureWhatsapp(wa, item);
      const reason = smsSkipReason(item);
      if (reason) {
        skipped[reason] = (skipped[reason] || 0) + 1;
        continue;
      }
      if (item.waPending) break; // faltou tempo/teto da rodada: a tela continua na seguinte
      seen.add(key);
      items.push(item);
    }
    for (const [reason, count] of Object.entries(plan.skipped)) skipped[reason] = (skipped[reason] || 0) + count;
    if (rows.length < PAGE) break;
  }
  return { items, skipped };
}

// Lote do corretor: primeiro o que ele já tem reservado e continua elegível (reserva que deixou de valer é solta), depois
// completa com contatos novos RESERVADOS para ele (a chave primária da reserva impede dois corretores com o mesmo contato).
async function pickBrokerBatch(brokerId, room, wa) {
  const skipped = {};
  if (!room) return { items: [], skipped };
  let ownIds;
  try {
    ownIds = await listBrokerReservedContactIds(db(), brokerId);
  } catch (error) {
    if (isMissingReservationsTable(error)) throw new SmsBatchError(RESERVATIONS_MESSAGE, 503);
    throw error;
  }
  const own = [];
  if (ownIds.length) {
    const rows = [];
    for (const part of chunk(ownIds, 200)) rows.push(...(check(await db().from("prospecting_contacts").select(CONTACT_COLUMNS).in("id", part)) || []));
    const order = new Map(ownIds.map((id, index) => [id, index]));
    rows.sort((a, b) => order.get(a.id) - order.get(b.id));
    const candidates = await attachFacts(rows, { viewerBrokerId: brokerId, wa });
    const stale = [];
    for (const candidate of candidates) {
      let reason = smsSkipReason(candidate);
      // Reservado ainda sem checagem de WhatsApp (raro: normalmente já foi checado ao ser escolhido): confere agora.
      if (!reason) {
        await ensureWhatsapp(wa, candidate);
        reason = smsSkipReason(candidate);
        if (!reason && candidate.waPending) continue; // sem tempo nesta rodada: fica reservado, entra na seguinte
      }
      if (reason) {
        stale.push(candidate.id);
        skipped[reason] = (skipped[reason] || 0) + 1;
      } else own.push(candidate);
    }
    // Contato reservado que deixou de ser elegível (virou cliente, foi tentado, sumiu...) sai da reserva.
    const found = new Set(rows.map((row) => row.id));
    for (const id of [...stale, ...ownIds.filter((id) => !found.has(id))]) await releaseSmsReservation(db(), id, brokerId);
  }
  const items = [...planSmsBatch(own, { limit: room, sentToday: 0 }).items];
  const need = room - items.length;
  if (need > 0) {
    // Folga de 20 candidatos: alguns podem ser reservados por outro corretor no meio do caminho.
    const fresh = await pickBatch(need + 20, { viewerBrokerId: brokerId, excludeIds: new Set(ownIds), wa });
    for (const [reason, count] of Object.entries(fresh.skipped)) skipped[reason] = (skipped[reason] || 0) + count;
    const got = new Set(await reserveSmsContacts({ client: db(), brokerId, contactIds: fresh.items.map((item) => item.id), limit: need }));
    items.push(...fresh.items.filter((item) => got.has(item.id)));
  }
  return { items, skipped };
}

// 1ª + link + linha em branco + 2ª num único SMS (o iPhone separa o link e as partes sozinho): as duas mensagens saem num toque.
function bothHrefs(phone, text, text2) {
  const both = buildSmsHrefs(phone, `${text}\n\n${text2}`);
  return { bothHref: both.primary, bothFallbackHref: both.fallback };
}

// --- Medição -------------------------------------------------------------------------------------------------------

async function countSentSince(sinceIso, { campaignId = "", excludeCampaignIds = [] } = {}) {
  // Número inválido marcado hoje devolve a vaga: os 50 do dia são só de números que existem.
  const [sent, invalid] = await Promise.all([countEventSince(SMS_EVENT.FIRST, sinceIso, { campaignId, excludeCampaignIds }), countEventSince(SMS_EVENT.INVALID, sinceIso, { campaignId, excludeCampaignIds }).then(async (n) => n + (await countEventSince(SMS_EVENT.INACTIVE, sinceIso, { campaignId, excludeCampaignIds })))]);
  return Math.max(0, sent - invalid);
}

async function countEventSince(event, sinceIso, { campaignId = "", excludeCampaignIds = [] } = {}) {
  let query = db().from("sms_batch_sends").select("id", { count: "exact", head: true }).eq("event", event).gte("created_at", sinceIso);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  // Lote da equipe: não conta o que os corretores enviaram (cada corretor tem a própria cota).
  else if (excludeCampaignIds.length) query = query.not("campaign_id", "in", `(${excludeCampaignIds.join(",")})`);
  const result = await query;
  check(result);
  return result.count || 0;
}

const SIM_SENT_EVENTS = ["presentation_sent", "simulation_auto_sent"];

// Uma busca para todas as campanhas "SMS" (por corretor e da equipe); depois, cada visão filtra pelas suas campanhas.
async function loadMetricRows(campaignIds) {
  if (!campaignIds.length) return { sends: [], views: [], origins: [], duplicates: [], simulationClientIds: new Set() };
  const [sends, views, originRows, duplicates] = await Promise.all([
    fetchAll(() => db().from("sms_batch_sends").select("campaign_id, event, created_at, phone_normalized").in("campaign_id", campaignIds).in("event", [SMS_EVENT.FIRST, SMS_EVENT.SECOND, SMS_EVENT.INVALID, SMS_EVENT.INACTIVE]).order("created_at", { ascending: true })),
    fetchAll(() => db().from("campaign_link_views").select("campaign_id, created_at").in("campaign_id", campaignIds).order("created_at", { ascending: true })),
    fetchAll(() => db().from("client_origins").select("campaign_id, client_id, created_at").in("campaign_id", campaignIds).order("created_at", { ascending: true })),
    fetchAll(() => db().from("campaign_link_duplicate_submissions").select("campaign_id, created_at").in("campaign_id", campaignIds).order("created_at", { ascending: true }))
  ]);
  // Cadastro cujo cliente foi APAGADO do CRM (teste, por exemplo) não conta nos resultados (dono, 2026-11-02).
  const originClientIds = [...new Set(originRows.map((row) => row.client_id).filter(Boolean))];
  const existing = new Set();
  for (const part of chunk(originClientIds, 200)) {
    for (const row of check(await db().from("simulation_registrations").select("id").in("id", part)) || []) existing.add(row.id);
  }
  const origins = originRows.filter((row) => row.client_id && existing.has(row.client_id));
  // Simulação enviada = apresentação enviada (pelo corretor) ou envio automático, a clientes que vieram destes links.
  const clientIds = [...new Set(origins.map((row) => row.client_id).filter(Boolean))];
  const simulationClientIds = new Set();
  const journeyParts = await Promise.all(chunk(clientIds, 200).map(async (part) => check(await db().from("client_journey_events").select("client_id").in("client_id", part).in("event_type", SIM_SENT_EVENTS)) || []));
  for (const row of journeyParts.flat()) simulationClientIds.add(row.client_id);
  return { sends, views, origins, duplicates, simulationClientIds };
}

// `period` (resolveSmsPeriod, dias de São Paulo): só o que caiu nele. Número inválido/inativo marcado DEPOIS do período ainda
// tira o envio do período (a chave do telefone vale para a campanha toda, não só para o período).
function metricsFor(rows, campaignIds, period = null) {
  const ids = new Set(campaignIds);
  const mine = (list) => list.filter((row) => ids.has(row.campaign_id));
  const origins = mine(rows.origins).filter((row) => inSmsPeriod(row, period));
  // Número inválido (SMS não entregue) sai da contagem de enviados — a métrica só mede o que chegou.
  const invalidKeys = new Set(mine(rows.sends).filter((row) => (row.event === SMS_EVENT.INVALID || row.event === SMS_EVENT.INACTIVE)).map((row) => phoneComparisonKey(row.phone_normalized)));
  const delivered = mine(rows.sends).filter((row) => row.event !== SMS_EVENT.INVALID && row.event !== SMS_EVENT.INACTIVE && !invalidKeys.has(phoneComparisonKey(row.phone_normalized)));
  const metrics = buildSmsMetrics({
    sends: delivered.filter((row) => row.event === SMS_EVENT.FIRST),
    sends2: delivered.filter((row) => row.event === SMS_EVENT.SECOND),
    views: mine(rows.views),
    // Cadastros preenchidos = clientes novos + reenvios do formulário por este link (mesma conta do Gerador de Links).
    signups: [...origins, ...mine(rows.duplicates)]
  }, { days: 14, period });
  metrics.total.simulations = new Set(origins.map((row) => row.client_id).filter((id) => id && rows.simulationClientIds.has(id))).size;
  return metrics;
}

// --- Tela ---------------------------------------------------------------------------------------------------------

// `options.brokerId` (só equipe): restringe os resultados a UM corretor.
// `options.brokerId` também aceita "team" = só o lote oficial da equipe/dono ("O meu", sem corretor).
// `options.period` { preset, from, to } (dono, 2026-11-02): período dos resultados, validado aqui (resolveSmsPeriod) — vale para
// os cartões do topo, "Por corretor", "Por dia" e "Quem preencheu o formulário"; sem ele, tudo como antes.
export async function loadSmsBatch(auth, options = {}) {
  const scope = scopeOf(auth);
  const period = resolveSmsPeriod(options.period || {});
  if (period.error) throw new SmsBatchError(period.error, 400);
  const brokerId = scope === "broker" ? auth.profile.id : null;
  const [settings, campaign, smsCampaigns] = await Promise.all([getSmsBatchSettings(), ensureSmsCampaign(brokerId), listSmsCampaigns()]);
  const brokerCampaigns = smsCampaigns.filter((row) => row.broker_id);
  const brokerCampaignIds = brokerCampaigns.map((row) => row.id);
  const sentToday = await countSentSince(spDayStartIso(), brokerId ? { campaignId: campaign.id } : { excludeCampaignIds: brokerCampaignIds });
  // "Carregar mais 50" (dono, 2026-11-02): extra do dia (São Paulo), por lote (equipe ou corretor), somado à meta diária.
  const extraToday = await readExtraToday(brokerId).catch(() => 0);
  const room = smsRemainingToday(settings.limit, Math.max(0, sentToday - extraToday));
  // Checagem de WhatsApp (só consulta; nunca bloqueia: sem sessão/tabela/serviço a lista sai como antes). Só abre sessão
  // quando há vaga a preencher.
  // Checagem de WhatsApp DESLIGADA por padrão (dono, 2026-11-02: a validação de número é pelo botão "Número não existe/não ativo");
  // ligar só com SMS_BATCH_WA_CHECK=1. Desligada = a lista sai direto, sem consultar o WhatsApp (mais rápida).
  const wa = await openWaCheck(db(), { enabled: room > 0 && process.env.SMS_BATCH_WA_CHECK === "1", disabledReason: process.env.SMS_BATCH_WA_CHECK === "1" ? "" : "desligada" });

  const fetchEvents = async () => {
    const select = "id, phone_normalized, event, created_at, contact_id, campaign_id, contact:prospecting_contacts(name, status)";
    if (!brokerId) {
      // Equipe: tudo o que não é de corretor (os envios dos corretores aparecem só nos resultados).
      return scopeSmsEvents(await fetchAll(() => db().from("sms_batch_sends").select(select).order("created_at", { ascending: true })), { mode: "team", brokerCampaignIds });
    }
    const own = await fetchAll(() => db().from("sms_batch_sends").select(select).eq("campaign_id", campaign.id).order("created_at", { ascending: true }));
    const phones = [...new Set(own.map((row) => row.phone_normalized))];
    const optOuts = [];
    for (const part of chunk(phones, 300)) optOuts.push(...(check(await db().from("sms_batch_sends").select(select).in("phone_normalized", part).eq("event", SMS_EVENT.OPT_OUT)) || []));
    return scopeSmsEvents([...own, ...optOuts], { mode: "campaign", campaignId: campaign.id });
  };
  const metricCampaignIds = [...new Set([campaign.id, ...smsCampaigns.map((row) => row.id)])];
  const [batch, eventRows, metricRows] = await Promise.all([
    room ? (brokerId ? pickBrokerBatch(brokerId, room, wa) : pickBatch(room, { wa })) : Promise.resolve({ items: [], skipped: {} }),
    fetchEvents(),
    loadMetricRows(brokerId ? [campaign.id] : metricCampaignIds)
  ]);

  // [Saudação] pela função única do projeto (horário de São Paulo), no momento em que a lista é montada.
  const greeting = getTimeGreeting();
  const firstTemplate = brokerId ? settings.templateBroker : settings.template;
  const items = batch.items.map((item) => {
    const text = renderSmsText(firstTemplate, { name: item.name, link: campaign.link, greeting, broker: brokerId ? auth.profile.name : "" });
    const hrefs = buildSmsHrefs(item.phone, text);
    // 2ª mensagem já pronta no cartão: ao enviar a 1ª, o cartão passa para "Aguardando 2ª" na hora, sem recarregar a lista.
    const text2 = renderSmsText(settings.template2, { name: item.name, link: campaign.link, greeting });
    const hrefs2 = buildSmsHrefs(item.phone, text2);
    return { id: item.id, name: item.name, firstName: smsFirstName(item.name), phoneMasked: maskSmsPhone(item.phone), text, href: hrefs.primary, fallbackHref: hrefs.fallback, secondHref: hrefs2.primary, secondFallbackHref: hrefs2.fallback, ...bothHrefs(item.phone, text, text2) };
  });
  const grouped = groupSmsConversations(eventRows.map((row) => ({ ...row, name: row.contact?.name || "", contactStatus: row.contact?.status || "" })));
  const present = (entry) => ({ invalidReason: entry.invalidReason, id: entry.sendId, name: entry.name, phoneMasked: maskSmsPhone(entry.phone), sentAt: entry.sentAt, secondAt: entry.secondAt, state: entry.state });
  const awaiting = grouped.awaiting.map((entry) => {
    const text = renderSmsText(settings.template2, { name: entry.name, link: campaign.link, greeting });
    const hrefs = buildSmsHrefs(entry.phone, text);
    // Reenvio da 1ª (SMS não entregue): mesmo texto da 1ª, sem registrar novo envio.
    const firstText = renderSmsText(firstTemplate, { name: entry.name, link: campaign.link, greeting, broker: brokerId ? auth.profile.name : "" });
    const resend = buildSmsHrefs(entry.phone, firstText);
    return { ...present(entry), href: hrefs.primary, fallbackHref: hrefs.fallback, resendHref: resend.primary, resendFallbackHref: resend.fallback };
  });

  // Equipe: visão total (todos os lotes) com cartão por corretor; filtro por corretor sem quebrar a total.
  let brokers = [];
  let metrics;
  let metricsLabel = brokerId ? "Meus resultados" : "Todos os lotes";
  let signupCampaignIds;
  if (brokerId) {
    metrics = metricsFor(metricRows, [campaign.id], period);
    signupCampaignIds = new Set([campaign.id]);
  } else {
    const names = new Map();
    const ids = brokerCampaigns.map((row) => row.broker_id);
    if (ids.length) for (const row of check(await db().from("admin_users").select("id, name").in("id", ids)) || []) names.set(row.id, row.name || "");
    brokers = brokerCampaigns.map((row) => {
      const total = metricsFor(metricRows, [row.id], period).total;
      return { id: row.broker_id, name: names.get(row.broker_id) || "Corretor", sent: total.sent, sent2: total.sent2, clicks: total.clicks, signups: total.signups, simulations: total.simulations, rate: total.rate };
    }).sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name, "pt-BR"));
    // Lote: "" = todos; "team" = o lote oficial da equipe/dono (sem corretor); id = o lote de um corretor.
    const chosenIds = options.brokerId === "team" ? [campaign.id] : options.brokerId ? brokerCampaigns.filter((row) => row.broker_id === options.brokerId).map((row) => row.id) : [];
    metrics = metricsFor(metricRows, chosenIds.length ? chosenIds : metricCampaignIds, period);
    signupCampaignIds = new Set(chosenIds.length ? chosenIds : metricCampaignIds);
    if (options.brokerId === "team") metricsLabel = "O meu (lote da equipe)";
    else if (chosenIds.length) metricsLabel = brokers.find((row) => row.id === options.brokerId)?.name || "Corretor";
  }
  // Lista de quem preencheu o formulário por estes links (clientes novos), com o telefone e o link para abrir o cliente.
  let signups = [];
  try {
    const signupOrigins = metricRows.origins.filter((row) => signupCampaignIds.has(row.campaign_id) && inSmsPeriod(row, period)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
    const signupClients = new Map();
    for (const part of chunk(signupOrigins.map((row) => row.client_id).filter(Boolean), 200)) {
      for (const client of check(await db().from("simulation_registrations").select("id, full_name, phone, client_code").in("id", part)) || []) signupClients.set(client.id, client);
    }
    signups = signupOrigins.map((row) => {
      const client = signupClients.get(row.client_id);
      return client ? { id: client.id, name: client.full_name || "Sem nome", phone: client.phone || "", at: row.created_at, href: `/admin/simulacoes?query=${encodeURIComponent(client.client_code || client.phone || client.full_name || "")}&clientId=${client.id}` } : null;
    }).filter(Boolean);
  } catch (signupError) {
    console.warn("Lote de SMS: lista de cadastros não carregou:", signupError?.message || signupError);
  }
  return {
    scope: brokerId ? "broker" : "team",
    signups,
    settings,
    link: campaign.link,
    notice: SMS_BATCH_COLD_NOTICE,
    progress: { sentToday, limit: settings.limit + extraToday, remaining: room },
    items,
    skipped: batch.skipped,
    awaiting,
    done: grouped.done.slice(0, 600).map(present),
    doneCapped: grouped.done.length > 600,
    metrics,
    metricsLabel,
    period,
    lot: brokerId ? "" : String(options.brokerId || ""),
    brokers,
    // Checagem de WhatsApp: estado da rodada (a tela continua sozinha enquanto "checking") e, só para a equipe, a aba
    // "Sem WhatsApp" (leitura). Corretor não vê a lista (é da base inteira).
    whatsapp: room ? waCheckSummary(wa) : { state: "ok", reason: "", checked: 0, pending: false },
    noWhatsapp: brokerId ? null : await listNoWhatsapp(db()),
    loadedAt: new Date().toISOString()
  };
}

// --- Ações --------------------------------------------------------------------------------------------------------

// O envio é de quem o fez: o corretor só mexe nos DELE; a equipe não mexe nos de corretor (exceto SAIR, que protege o cliente).
async function loadSendForAction(sendId, auth, scope, { allowTeamOnBroker = false } = {}) {
  const send = check(await db().from("sms_batch_sends").select("id, phone_normalized, contact_id, event, campaign_id, sent_by, created_at").eq("id", String(sendId || "")).maybeSingle());
  if (!send) throw new SmsBatchError("Envio não encontrado.", 404);
  if (scope === "broker") {
    if (send.sent_by !== auth.profile.id) throw new AdminPermissionError("Este envio é de outro corretor.");
  } else if (!allowTeamOnBroker && send.campaign_id) {
    const owned = (await listSmsCampaigns()).find((row) => row.id === send.campaign_id);
    if (owned?.broker_id) throw new AdminPermissionError("Este envio é de um corretor.");
  }
  return send;
}

// Toque em "Enviar SMS" confirmado: grava o envio (tentativa de contato). Reconfere a elegibilidade no servidor; no lote do
// corretor o contato precisa estar reservado para ele (se a reserva venceu e ninguém pegou, ele a retoma).
const MORE_STEP = 50;
const extraSettingId = (brokerId) => `sms_batch_extra_${spDayKey(new Date())}_${brokerId || "team"}`;

async function readExtraToday(brokerId) {
  const row = check(await db().from("crm_settings").select("setting_value").eq("id", extraSettingId(brokerId)).maybeSingle());
  return Math.max(0, Math.floor(Number(row?.setting_value?.extra) || 0));
}

// "Carregar mais 50": só depois de zerar a meta do dia. A elegibilidade NÃO muda (smsSkipReason: só contato da base que
// nunca teve tentativa em nenhum canal); só aumenta a quantidade do dia.
export async function addSmsExtraBatch(auth) {
  const scope = scopeOf(auth);
  const brokerId = scope === "broker" ? auth.profile.id : null;
  const campaign = await ensureSmsCampaign(brokerId);
  const brokerCampaignIds = brokerId ? [] : (await listSmsCampaigns()).filter((row) => row.broker_id).map((row) => row.id);
  const [settings, sentToday, extra] = await Promise.all([
    getSmsBatchSettings(),
    countSentSince(spDayStartIso(), brokerId ? { campaignId: campaign.id } : { excludeCampaignIds: brokerCampaignIds }),
    readExtraToday(brokerId)
  ]);
  const next = extra + MORE_STEP;
  check(await db().from("crm_settings").upsert({ id: extraSettingId(brokerId), setting_value: { extra: next }, updated_at: new Date().toISOString() }, { onConflict: "id" }));
  return { ok: true, extra: next };
}

// "Zerar lista" (dono, 2026-11-02): os contatos que estão na tela JÁ foram enviados (1ª e 2ª) mas não foram marcados.
// Só grava o registro (nenhuma mensagem é enviada): 1ª + 2ª de cada um, e soma o mesmo tanto à cota do dia, para a lista
// vir com 50 NOVOS. Elegibilidade inalterada (só contato da base sem nenhuma tentativa).
export async function resetSmsList(auth) {
  const scope = scopeOf(auth);
  const brokerId = scope === "broker" ? auth.profile.id : null;
  const data = await loadSmsBatch(auth);
  const ids = data.items.map((item) => item.id);
  let done = 0;
  for (const part of chunk(ids, 5)) {
    const results = await Promise.allSettled(part.map(async (id) => {
      const first = await markSmsSent(id, auth);
      if (first?.sendId) await markSmsSecondSent(first.sendId, auth);
    }));
    done += results.filter((row) => row.status === "fulfilled").length;
  }
  if (done) {
    const extra = await readExtraToday(brokerId).catch(() => 0);
    check(await db().from("crm_settings").upsert({ id: extraSettingId(brokerId), setting_value: { extra: extra + done }, updated_at: new Date().toISOString() }, { onConflict: "id" }));
  }
  return { ok: true, marked: done, total: ids.length };
}

export async function markSmsSent(contactId, auth, { outsideOffice = false } = {}) {
  const scope = scopeOf(auth);
  const brokerId = scope === "broker" ? auth.profile.id : null;
  const id = String(contactId || "").trim();
  if (!id) throw new SmsBatchError("Contato inválido.");
  const row = check(await db().from("prospecting_contacts").select(CONTACT_COLUMNS).eq("id", id).maybeSingle());
  if (!row) throw new SmsBatchError("Contato não encontrado.", 404);
  // Idempotente: o mesmo toque gravado duas vezes (fila + volta do Mensagens) devolve o envio que já existe, sem erro.
  const already = check(await db().from("sms_batch_sends").select("id, created_at").eq("event", SMS_EVENT.FIRST).in("phone_normalized", phoneLookupCandidates(row.phone_normalized)).order("created_at", { ascending: true }).limit(1));
  if (already?.[0]) return { alreadySent: true, sendId: already[0].id, sentAt: already[0].created_at };
  if (brokerId) {
    const active = await readReservations([row.id], true);
    if (active.has(row.id) && active.get(row.id) !== brokerId) throw new SmsBatchError("Este contato não está mais disponível para o Lote de SMS.", 409);
    // Fora da imobiliária (PRO-18e) só registra o que já era dele: nunca retoma nem pega contato novo.
    if (outsideOffice && active.get(row.id) !== brokerId) throw new SmsBatchError(SMS_BATCH_OFFICE_ONLY_MESSAGE, 403, SMS_BATCH_OFFICE_ONLY_CODE);
    if (!active.has(row.id)) {
      const got = await reserveSmsContacts({ client: db(), brokerId, contactIds: [row.id], limit: 1 });
      if (!got.includes(row.id)) throw new SmsBatchError("Este contato não está mais disponível para o Lote de SMS.", 409);
    }
  }
  const [candidate] = await attachFacts([row], { viewerBrokerId: brokerId });
  const reason = smsSkipReason(candidate);
  if (reason === SMS_SKIP_REASON.SMS_SENT) return { alreadySent: true };
  if (reason) throw new SmsBatchError("Este contato não está mais disponível para o Lote de SMS.", 409);

  const campaign = await ensureSmsCampaign(brokerId);
  const now = new Date();
  const nowIso = now.toISOString();
  const sent = check(await db().from("sms_batch_sends").insert({ phone_normalized: row.phone_normalized, contact_id: row.id, event: SMS_EVENT.FIRST, campaign_id: campaign.id, sent_by: auth?.profile?.id || null, created_at: nowIso }).select("id").single());
  // Conta como tentativa e sai da Prospecção por 30 dias (mesmo padrão da tentativa recente). Sem corretor: não é
  // atividade de ninguém, não mexe em Meta Diária/pontuação/ranking.
  const availableAfter = new Date(now.getTime() + SMS_BATCH_RECENT_ATTEMPT_DAYS * 86400000).toISOString();
  // Em paralelo (independentes entre si): menos espera por toque.
  const [updated, history] = await Promise.all([
    db().from("prospecting_contacts").update({ status: "recent_attempt", last_attempt_at: nowIso, available_after: availableAfter, updated_at: nowIso }).eq("id", row.id).eq("status", "available").select("id"),
    db().from("prospecting_history").insert({ contact_id: row.id, registration_id: null, user_id: null, event_type: SMS_BATCH_HISTORY_EVENT, details: { sentBy: auth?.profile?.id || null, sendId: sent.id, ...(brokerId ? { brokerId } : {}) } }),
    brokerId ? releaseSmsReservation(db(), row.id, brokerId) : Promise.resolve()
  ]);
  check(updated);
  check(history);
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
    optedOut: has(SMS_EVENT.OPT_OUT) || has(SMS_EVENT.INVALID) || has(SMS_EVENT.INACTIVE),
    doNotContact: contact?.status === "do_not_contact" || (clients || []).some((row) => row.status === "do_not_contact")
  };
}

// Toque em "Enviar 2ª mensagem" confirmado: só depois da 1ª, uma vez por telefone, nunca para SAIR/Não contactar.
// `sendId` = a linha da 1ª mensagem (sms_batch_sends).
export async function markSmsSecondSent(sendId, auth) {
  const scope = scopeOf(auth);
  const first = await loadSendForAction(sendId, auth, scope);
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
  const scope = scopeOf(auth);
  const found = check(await db().from("sms_batch_sends").select("id").eq("id", String(sendId || "")).maybeSingle());
  if (!found) return { undone: false };
  const send = await loadSendForAction(sendId, auth, scope);
  if (send.event !== SMS_EVENT.FIRST && send.event !== SMS_EVENT.SECOND) throw new SmsBatchError("Só um envio pode ser desfeito.");
  if (Date.now() - new Date(send.created_at).getTime() > UNDO_WINDOW_MS) throw new SmsBatchError("O prazo para desfazer passou.", 409);
  check(await db().from("sms_batch_sends").delete().eq("id", send.id));
  if (send.contact_id && send.event === SMS_EVENT.FIRST) {
    // Só devolve se o contato continua exatamente como o envio o deixou.
    check(await db().from("prospecting_contacts").update({ status: "available", last_attempt_at: null, available_after: null, updated_at: new Date().toISOString() }).eq("id", send.contact_id).eq("status", "recent_attempt").eq("last_attempt_at", send.created_at).select("id"));
    check(await db().from("prospecting_history").insert({ contact_id: send.contact_id, registration_id: null, user_id: null, event_type: "sms_batch_undone", details: { sendId: send.id } }));
    // No lote do corretor o contato volta reservado para ele (se ninguém o pegou nesse meio-tempo).
    if (scope === "broker") await reserveSmsContacts({ client: db(), brokerId: auth.profile.id, contactIds: [send.contact_id], limit: 1 }).catch((error) => console.warn("Lote de SMS: reserva não refeita ao desfazer:", error?.message || error));
  }
  return { undone: true };
}

// "Respondeu SAIR": Não contactar pelo caminho único (do-not-contact-core), em TODAS as linhas irmãs do telefone
// (fila de prospecção por telefone/cadastro e qualquer cadastro de cliente com o telefone). Mantém a atribuição.
// Corretor marca os dele; admin/gestor marcam qualquer um (é uma proteção ao cliente, não um envio).
// "Número inválido": o SMS não foi entregue porque o número não existe/não recebe. Sai de "Aguardando 2ª", não recebe a 2ª e
// nunca volta ao lote (o envio da 1ª já o tirou da fila). NÃO é Não contactar: nada muda no contato nem em cliente.
export async function markSmsInvalid(sendId, auth, reason = "nonexistent") {
  const scope = scopeOf(auth);
  const send = await loadSendForAction(sendId, auth, scope, { allowTeamOnBroker: true });
  const inserted = await db().from("sms_batch_sends").insert({ phone_normalized: send.phone_normalized, contact_id: send.contact_id, event: reason === "inactive" ? SMS_EVENT.INACTIVE : SMS_EVENT.INVALID, campaign_id: send.campaign_id || null, sent_by: auth?.profile?.id || null, created_at: new Date().toISOString() });
  if (inserted.error?.code === "23514") throw new SmsBatchError("\"Número inválido\" ainda não está liberado no banco (migration 20261102200000_sms_batch_inactive.sql pendente).", 503);
  check(inserted);
  return { ok: true };
}

export async function markSmsOptOut(sendId, auth) {
  const scope = scopeOf(auth);
  const send = await loadSendForAction(sendId, auth, scope, { allowTeamOnBroker: true });
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

  check(await db().from("sms_batch_sends").insert({ phone_normalized: send.phone_normalized, contact_id: send.contact_id, event: SMS_EVENT.OPT_OUT, campaign_id: send.campaign_id || null, sent_by: auth?.profile?.id || null, created_at: now }));
  return { ok: true, contacts: contactIds.length, clients: (clients || []).length };
}
