import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { canonicalWhatsappPhone, phoneComparisonKey, phoneLookupCandidates, toBrazilianE164 } from "./phone-utils";
import { getSiteBaseUrl } from "./admin-profiles";
import {
  createWhatsappMessageTemplate,
  listWhatsappMessageTemplates,
  sendWhatsappTemplateMessage
} from "./whatsapp-master";
import { createCampaign, buildCampaignLink, getCampaign } from "./campaigns";

export function canManageWhatsappBroadcasts() {
  return hasSupabaseAdminConfig;
}

function db() {
  return getSupabaseAdminClient();
}

const STATUS_LABELS = {
  PENDING: "Em análise",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
  NOT_FOUND: "Não existe mais na Meta"
};

export function templateStatusLabel(status) {
  return STATUS_LABELS[String(status || "").toUpperCase()] || String(status || "Desconhecido");
}

/* ------------------------------- Templates -------------------------------- */

// Só devolve o registro LOCAL (whatsapp_templates) — nunca chama a Meta a
// cada carregamento de tela (item 44: evitar polling excessivo). "Sincronizar
// agora" (syncTemplatesFromMeta, abaixo) é a ação explícita que atualiza
// status/lista a partir da Meta.
export async function listLocalTemplates(auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("whatsapp_templates").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToTemplate);
}

export async function getLocalTemplate(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("whatsapp_templates").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToTemplate(data) : null;
}

// Sincroniza com a conta da Meta (item 9 do pedido): busca TODOS os templates
// existentes (criados por aqui ou não) e faz upsert por (nome, idioma) — a
// MESMA chave de unicidade da Meta — para nunca criar um registro local
// duplicado de um template que já existe lá.
export async function syncTemplatesFromMeta(auth) {
  assertGeneralAdminOrManager(auth);
  const metaTemplates = await listWhatsappMessageTemplates();
  const now = new Date().toISOString();

  const rows = metaTemplates.map((template) => ({
    meta_template_id: String(template.id || ""),
    name: template.name,
    language: template.language,
    category: template.category || "MARKETING",
    status: template.status || "PENDING",
    components: template.components || [],
    raw_meta: template,
    updated_at: now,
    last_sync_at: now
  }));
  if (!rows.length) return [];

  // upsert por (name, language) preserva a linha existente (inclusive
  // variable_mapping/button_text já configurados por quem criou aqui) e só
  // atualiza os campos que realmente vêm da Meta — nunca sobrescreve
  // variable_mapping, que é uma decisão nossa, não da Meta.
  for (const row of rows) {
    const { error } = await db().from("whatsapp_templates").upsert(row, { onConflict: "name,language", ignoreDuplicates: false });
    if (error) throw error;
  }

  // Reconciliação: um template local cujo (nome, idioma) não veio na lista
  // viva da Meta não existe mais na conta conectada (ex.: trocou de WABA) —
  // sem isso ele ficava com o último status conhecido ("Aprovado") pra
  // sempre, mesmo sem existir de verdade, e o Disparo deixava escolher um
  // template fantasma. Nunca DELETE (whatsapp_broadcasts.template_id
  // referencia essa tabela, quebraria histórico) — só marca o status.
  const liveKeys = new Set(metaTemplates.map((template) => `${template.name}::${template.language}`));
  const { data: localRows, error: localError } = await db().from("whatsapp_templates").select("id, name, language, status");
  if (localError) throw localError;
  const staleIds = (localRows || [])
    .filter((row) => row.status !== "NOT_FOUND" && !liveKeys.has(`${row.name}::${row.language}`))
    .map((row) => row.id);
  if (staleIds.length) {
    const { error: staleError } = await db().from("whatsapp_templates").update({ status: "NOT_FOUND", updated_at: now, last_sync_at: now }).in("id", staleIds);
    if (staleError) throw staleError;
  }

  return listLocalTemplates(auth);
}

// Cria o template na Meta E o registro local numa só ação (item 3/7 do
// pedido). O botão, quando informado, é SEMPRE de URL dinâmica apontando
// para o Gerador de Links já existente (?c={{1}}) — nunca uma URL fixa por
// template, porque cada campanha usando esse template precisa poder apontar
// para uma campanha/link diferente (ver dispatchBroadcastNow).
export async function createAndSubmitTemplate(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const name = normalizeTemplateName(payload.name);
  if (!name) throw new Error("Informe um nome válido para o modelo (ex.: poder_de_compra).");
  const languageCode = String(payload.languageCode || "pt_BR").trim() || "pt_BR";
  const category = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(payload.category) ? payload.category : "MARKETING";
  const bodyText = String(payload.bodyText || "").trim();
  if (!bodyText) throw new Error("Informe o texto do corpo da mensagem.");

  const variableMapping = normalizeVariableMapping(payload.variableMapping, bodyText);
  const bodyExample = buildBodyExample(bodyText, variableMapping);

  const buttonText = String(payload.buttonText || "").trim();
  const includeButton = Boolean(buttonText);
  const buttonUrlTemplate = includeButton ? `${getSiteBaseUrl()}/simulacao?c={{1}}` : "";

  const { data: existing } = await db().from("whatsapp_templates").select("id").eq("name", name).eq("language", languageCode).maybeSingle();
  if (existing) throw new Error("Já existe um modelo com esse nome e idioma. Use a sincronização para atualizar o status, ou escolha outro nome.");

  const metaResult = await createWhatsappMessageTemplate({
    name,
    category,
    languageCode,
    headerText: payload.headerText || "",
    bodyText,
    bodyExample,
    footerText: payload.footerText || "",
    buttonText,
    buttonUrlTemplate
  });

  const { data, error } = await db().from("whatsapp_templates").insert({
    meta_template_id: metaResult.id,
    name,
    language: languageCode,
    category,
    status: metaResult.status,
    components: metaResult.components,
    variable_mapping: variableMapping,
    button_text: buttonText || null,
    raw_meta: metaResult,
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToTemplate(data);
}

function normalizeTemplateName(value) {
  return String(value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 512);
}

// {{1}}, {{2}}... contados no corpo; mapping = { "1": "name" | "fixed", ... }
// com valor fixo opcional em variableMapping[n].value quando source="fixed".
// Nunca assume automaticamente que toda variável é o nome (regra explícita
// do item 5) — só {{1}} tem esse padrão sugerido por default.
function normalizeVariableMapping(rawMapping, bodyText) {
  const variableCount = countTemplateVariables(bodyText);
  const mapping = {};
  for (let index = 1; index <= variableCount; index += 1) {
    const entry = rawMapping?.[index] || rawMapping?.[String(index)] || {};
    const source = entry.source === "fixed" ? "fixed" : "contact_name";
    mapping[index] = source === "fixed" ? { source: "fixed", value: String(entry.value || "").slice(0, 200) } : { source: "contact_name" };
  }
  return mapping;
}

function countTemplateVariables(text) {
  const matches = String(text || "").match(/\{\{(\d+)\}\}/g) || [];
  return matches.length ? Math.max(...matches.map((match) => Number(match.replace(/\D/g, "")))) : 0;
}

function buildBodyExample(bodyText, variableMapping) {
  const count = countTemplateVariables(bodyText);
  const example = [];
  for (let index = 1; index <= count; index += 1) {
    const entry = variableMapping[index];
    example.push(entry?.source === "fixed" ? (entry.value || "Exemplo") : "João");
  }
  return example;
}

function rowToTemplate(row) {
  return {
    id: row.id,
    metaTemplateId: row.meta_template_id || "",
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    statusLabel: templateStatusLabel(row.status),
    components: row.components || [],
    variableMapping: row.variable_mapping || {},
    buttonText: row.button_text || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncAt: row.last_sync_at
  };
}

/* ------------------------------- Contatos --------------------------------- */

// Base da Imobiliária = prospecting_contacts com owner_user_id nulo (mesma
// definição já usada em lib/prospecting.js). Consulta própria, paginada e
// pesquisável, em vez de reaproveitar listProspectingContacts (que carrega a
// base inteira de uma vez) — item 12 do pedido pede explicitamente
// performance/paginação para bases grandes. "Não contactar novamente" (item
// 13) é excluído incondicionalmente, mesmo que o filtro de busca combine com
// ele — nunca aparece na lista de seleção, então nunca pode ser selecionado.
export async function searchBaseContacts({ query = "", limit = 50, offset = 0 } = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const trimmedQuery = String(query || "").trim();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let baseQuery = db().from("prospecting_contacts")
    .select("id, name, phone_normalized", { count: "exact" })
    .is("owner_user_id", null)
    .neq("status", "do_not_contact")
    .order("name", { ascending: true })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (trimmedQuery) {
    const digits = trimmedQuery.replace(/\D/g, "");
    baseQuery = digits.length >= 3
      ? baseQuery.or(`name.ilike.%${trimmedQuery}%,phone_normalized.ilike.%${digits}%`)
      : baseQuery.ilike("name", `%${trimmedQuery}%`);
  }

  const { data, error, count } = await baseQuery;
  if (error) throw error;
  return {
    contacts: (data || []).map((row) => ({ id: row.id, name: row.name, phone: row.phone_normalized })),
    total: count || 0
  };
}

export async function countEligibleBaseContacts(auth) {
  assertGeneralAdminOrManager(auth);
  const { count, error } = await db().from("prospecting_contacts").select("id", { count: "exact", head: true }).is("owner_user_id", null).neq("status", "do_not_contact");
  if (error) throw error;
  return count || 0;
}

// Resolve e VALIDA a lista final de destinatários de uma campanha — usada
// tanto na revisão (item 24, antes de criar o lote) quanto na criação real
// do lote (createBroadcast, abaixo), para as duas contarem exatamente igual.
// Nunca inclui quem está com "não contactar novamente" (item 13), mesmo que
// tenha vindo selecionado explicitamente — a trava é sempre no servidor, não
// só na tela.
async function resolveBroadcastRecipients({ sourceType, contactIds = [], csvRows = [] }) {
  if (sourceType === "csv") {
    return resolveCsvRecipients(csvRows);
  }

  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (!ids.length) return { valid: [], invalidCount: 0, blockedCount: 0, duplicateCount: 0 };

  const { data, error } = await db().from("prospecting_contacts").select("id, name, phone_normalized, status").in("id", ids).is("owner_user_id", null);
  if (error) throw error;

  const found = new Map((data || []).map((row) => [row.id, row]));
  let blockedCount = 0;
  const valid = [];
  for (const id of ids) {
    const row = found.get(id);
    if (!row) continue; // não pertence à Base da Imobiliária (ou não existe) — ignorado silenciosamente
    if (row.status === "do_not_contact") { blockedCount += 1; continue; }
    valid.push({ contactId: row.id, name: row.name, phone: row.phone_normalized });
  }
  return { valid, invalidCount: 0, blockedCount, duplicateCount: 0 };
}

// CSV (item 14): normaliza telefone (DDI/DDD, remove formatação), detecta
// duplicado (por telefone normalizado) e inválido, SEM deixar um contato
// ruim travar o restante — cada linha é avaliada isoladamente. Também
// verifica opt-out contra a base real (um telefone já marcado como "não
// contactar" no CRM nunca deve receber disparo só porque veio de uma
// planilha separada).
async function resolveCsvRecipients(rows) {
  const seenPhones = new Set();
  const candidates = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const row of rows) {
    const name = String(row?.name || row?.nome || "").trim().slice(0, 160);
    const rawPhone = row?.phone || row?.telefone || "";
    // Estratégia central de telefone: com ou sem o 9º dígito é o MESMO número (dedupe
    // e opt-out não se perdem por diferença de formato) e o envio sai no formato canônico.
    const phone = toBrazilianE164(canonicalWhatsappPhone(rawPhone));
    if (!name || !phone) { invalidCount += 1; continue; }
    const phoneKey = phoneComparisonKey(phone);
    if (seenPhones.has(phoneKey)) { duplicateCount += 1; continue; }
    seenPhones.add(phoneKey);
    candidates.push({ contactId: null, name, phone });
  }

  if (!candidates.length) return { valid: [], invalidCount, blockedCount: 0, duplicateCount };

  const phones = [...new Set(candidates.flatMap((row) => phoneLookupCandidates(row.phone)))];
  const { data: blocked, error } = await db().from("prospecting_contacts").select("phone_normalized").eq("status", "do_not_contact").in("phone_normalized", phones);
  if (error) throw error;
  const blockedSet = new Set((blocked || []).map((row) => phoneComparisonKey(row.phone_normalized)));

  const valid = candidates.filter((row) => !blockedSet.has(phoneComparisonKey(row.phone)));
  return { valid, invalidCount, blockedCount: candidates.length - valid.length, duplicateCount };
}

/* -------------------------------- Preview ---------------------------------- */

// Etapa de revisão (item 24) — nunca cria nada no banco, só CALCULA o que
// createBroadcast faria, para a tela mostrar o total real antes do usuário
// confirmar.
export async function previewBroadcast(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const template = await requireApprovedTemplate(payload.templateId, auth);
  const recipients = await resolveBroadcastRecipients(payload);
  const variableMapping = normalizeVariableMapping(payload.variableMapping || template.variableMapping, extractBodyText(template));

  return {
    templateName: template.name,
    templateCategory: template.category,
    bodyPreview: renderPreview(extractBodyText(template), variableMapping, recipients.valid[0]?.name || "Cliente"),
    buttonText: template.buttonText,
    destinationJourney: normalizeDestinationJourney(payload.destinationJourney),
    totalCandidates: (payload.sourceType === "csv" ? (payload.csvRows || []).length : (payload.contactIds || []).length),
    totalInvalid: recipients.invalidCount,
    totalDuplicate: recipients.duplicateCount,
    totalBlocked: recipients.blockedCount,
    totalToSend: recipients.valid.length
  };
}

function extractBodyText(template) {
  const body = (template.components || []).find((component) => String(component.type).toUpperCase() === "BODY");
  return body?.text || "";
}

function renderPreview(bodyText, variableMapping, sampleName) {
  return String(bodyText || "").replace(/\{\{(\d+)\}\}/g, (_, index) => {
    const entry = variableMapping[index] || variableMapping[Number(index)];
    if (entry?.source === "fixed") return entry.value || `{{${index}}}`;
    return sampleName || "Cliente";
  });
}

function normalizeDestinationJourney(value) {
  return ["quick_service", "simulation", "choice"].includes(value) ? value : "choice";
}

async function requireApprovedTemplate(templateId, auth) {
  const template = await getLocalTemplate(templateId, auth);
  if (!template) throw new Error("Modelo não encontrado.");
  if (template.status !== "APPROVED") throw new Error("Só é possível usar modelos com status Aprovado em campanhas.");
  return template;
}

/* -------------------------------- Campanha --------------------------------- */

// Cria o lote (item 10): 1 linha em campaigns (reaproveitando 100% o
// Gerador de Links/tracking já existente — client_origins, campaign_link_views
// — destination_type='roulette' para o lead cair na roleta já existente,
// item 21), 1 linha em whatsapp_broadcasts, e 1 linha em
// whatsapp_broadcast_messages por destinatário válido — nada é enviado
// ainda aqui, só enfileirado (status 'queued'). dispatchBroadcastNow (abaixo)
// é a ação separada que efetivamente dispara.
export async function createBroadcast(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const campaignName = String(payload.campaignName || "").trim();
  if (!campaignName || campaignName.length < 2) throw new Error("Informe o nome da campanha.");

  const template = await requireApprovedTemplate(payload.templateId, auth);
  const recipients = await resolveBroadcastRecipients(payload);
  if (!recipients.valid.length) throw new Error("Nenhum contato válido para disparo (confira telefones inválidos, duplicados ou bloqueados).");

  const destinationJourney = normalizeDestinationJourney(payload.destinationJourney);
  const variableMapping = normalizeVariableMapping(payload.variableMapping || template.variableMapping, extractBodyText(template));

  // Link da campanha: reaproveita o Gerador de Links (item 40) — 1 campanha
  // "roulette" por disparo, com link_journey já configurado para pular a
  // tela de escolha quando aplicável (item 15-18).
  const linkCampaign = await createCampaign({ name: campaignName, destinationType: "roulette", status: "active" });
  await db().from("campaigns").update({ link_journey: destinationJourney }).eq("id", linkCampaign.id);

  const { data: broadcastRow, error: broadcastError } = await db().from("whatsapp_broadcasts").insert({
    campaign_name: campaignName,
    template_id: template.id,
    template_meta_id: template.metaTemplateId,
    template_name: template.name,
    template_category: template.category,
    template_language: template.language,
    variable_mapping: variableMapping,
    button_text: template.buttonText || null,
    destination_journey: destinationJourney,
    link_campaign_id: linkCampaign.id,
    source_type: payload.sourceType === "csv" ? "csv" : "base",
    status: "draft",
    created_by: auth?.profile?.id || null,
    total_selected: recipients.valid.length,
    total_invalid: recipients.invalidCount,
    total_blocked: recipients.blockedCount,
    total_queued: recipients.valid.length
  }).select("*").single();
  if (broadcastError) throw broadcastError;

  const messageRows = recipients.valid.map((recipient) => ({
    broadcast_id: broadcastRow.id,
    contact_id: recipient.contactId,
    full_name: recipient.name,
    phone_normalized: recipient.phone,
    variables: buildRecipientVariables(variableMapping, recipient),
    status: "queued"
  }));
  const { error: messagesError } = await db().from("whatsapp_broadcast_messages").insert(messageRows);
  if (messagesError) throw messagesError;

  return rowToBroadcast(broadcastRow);
}

function buildRecipientVariables(variableMapping, recipient) {
  const variables = {};
  for (const [index, entry] of Object.entries(variableMapping)) {
    variables[index] = entry.source === "fixed" ? (entry.value || "") : recipient.name;
  }
  return variables;
}

// "Disparar agora" (item 25/26). Protegido contra clique duplo/reenvio: só
// avança quem ainda está em 'draft' (UPDATE condicional — a segunda
// requisição simultânea não encontra linha para atualizar e recebe o mesmo
// broadcast já em andamento, nunca cria um segundo lote).
export async function dispatchBroadcastNow(broadcastId, auth) {
  assertGeneralAdminOrManager(auth);
  const now = new Date().toISOString();
  const { data: claimed, error } = await db().from("whatsapp_broadcasts")
    .update({ status: "processing", started_at: now, started_by: auth?.profile?.id || null })
    .eq("id", broadcastId)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!claimed) {
    // já disparado antes (clique duplo/reenvio) — devolve o estado atual em
    // vez de erro, a tela só precisa refletir o que já está acontecendo.
    return getBroadcastDetail(broadcastId, auth);
  }

  // Processa um primeiro lote de imediato, dentro da própria requisição, para
  // o usuário ver progresso instantâneo — o cron (processAllActiveBroadcastQueues)
  // é quem garante que o resto termina mesmo se a página fechar.
  await processBroadcastQueueBatch(broadcastId, 25000);
  return getBroadcastDetail(broadcastId, auth);
}

/* --------------------------- Fila de processamento -------------------------- */

const SEND_INTERVAL_MS = 1000; // ~1 mensagem/segundo — item 28, ajustável aqui se a Meta permitir mais

// Processa um lote de mensagens 'queued' de UM broadcast, respeitando um
// orçamento de tempo (maxDurationMs) — usado tanto pelo disparo imediato
// quanto pelo cron. Cada mensagem é isolada: um erro NUNCA interrompe as
// seguintes (item 29). Erros temporários (429/5xx/timeout) voltam para
// 'queued' com tentativa registrada para retry no próximo lote (item 30,
// backoff simples = próxima execução do cron, no máximo 1 min depois);
// erros permanentes (telefone inválido, template indisponível) vão direto
// para 'failed' sem retry.
const MAX_ATTEMPTS = 5;
// Mensagem 'processando' há mais que isso = processo que caiu (um envio dura ~12s no máximo).
const STUCK_AFTER_SECONDS = 300;

export async function processBroadcastQueueBatch(broadcastId, maxDurationMs = 25000) {
  const deadline = Date.now() + maxDurationMs;
  let processed = 0;

  // Mensagens presas em 'processando' por um processo que caiu: volta para a fila só
  // quando é seguro (nunca chamou a Meta); as que a Meta pode ter aceitado ficam
  // 'failed/delivery_unknown' e NÃO são reenviadas (ver a função no banco).
  await recoverStuckBroadcastMessages();

  for (;;) {
    if (Date.now() >= deadline) break;
    // Aquisição ATÔMICA no banco (FOR UPDATE SKIP LOCKED): "Disparar agora", cron e
    // qualquer outro processo nunca recebem a mesma mensagem.
    const { data: claimedRows, error } = await db().rpc("claim_whatsapp_broadcast_message", { p_broadcast_id: broadcastId, p_max_attempts: MAX_ATTEMPTS });
    if (error) throw error;
    const next = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
    if (!next) break; // fila deste broadcast esvaziou (ou o resto está com outro processo)

    await sendSingleBroadcastMessage(next);
    processed += 1;

    if (Date.now() < deadline) await sleep(SEND_INTERVAL_MS);
  }

  await finalizeBroadcastIfDone(broadcastId);
  return processed;
}

export async function recoverStuckBroadcastMessages(olderThanSeconds = STUCK_AFTER_SECONDS) {
  const { data, error } = await db().rpc("recover_stuck_whatsapp_broadcast_messages", { p_older_than_seconds: olderThanSeconds });
  if (error) {
    // Recuperação é rede de segurança: nunca impede o envio normal da fila.
    console.warn("Falha ao recuperar mensagens presas do Disparo:", error.message || error);
    return { requeued: 0, delivery_unknown: 0, promoted_sent: 0 };
  }
  const result = data || {};
  if (result.requeued || result.delivery_unknown || result.promoted_sent) {
    console.warn(JSON.stringify({ source: "whatsapp-broadcast", event: "recovered_stuck_messages", ...result }));
  }
  return result;
}

// `message` já vem ADQUIRIDA (status 'processing' + claim_token). Todo resultado é
// gravado só se a posse ainda for desta execução (claim_token) — uma execução
// atrasada nunca sobrescreve o estado de outra.
async function sendSingleBroadcastMessage(message) {
  const token = message.claim_token;
  const ownedUpdate = (patch) => db().from("whatsapp_broadcast_messages").update(patch).eq("id", message.id).eq("claim_token", token);

  const { data: broadcast, error: broadcastError } = await db().from("whatsapp_broadcasts").select("*").eq("id", message.broadcast_id).maybeSingle();
  if (broadcastError || !broadcast) {
    // Ainda não chamou a Meta: devolve para a fila com segurança.
    await ownedUpdate({ status: "queued", claim_token: null, processing_started_at: null });
    return;
  }

  // A partir daqui a Meta pode aceitar a mensagem; a marca abaixo é o que impede a
  // recuperação de reenviá-la se este processo cair no meio.
  const { data: began, error: beginError } = await db().rpc("begin_whatsapp_broadcast_send", { p_id: message.id, p_token: token });
  if (beginError || !began) {
    if (beginError) await ownedUpdate({ status: "queued", claim_token: null, processing_started_at: null });
    return; // perdeu a posse (recuperação já assumiu) — não envia
  }

  const attempts = (message.attempts || 0) + 1;
  try {
    const bodyParameters = orderedVariableValues(message.variables);
    const buttonUrlParameter = broadcast.button_text ? broadcast.link_campaign_id : "";
    const outcome = await sendWhatsappTemplateMessage({
      to: message.phone_normalized,
      templateName: broadcast.template_name,
      languageCode: broadcast.template_language,
      bodyParameters,
      buttonUrlParameter,
      callbackData: `bcm:${message.id}`
    });
    await ownedUpdate({
      status: "sent",
      whatsapp_message_id: outcome.messageId,
      sent_at: new Date().toISOString(),
      attempts
    });
  } catch (sendError) {
    const classification = classifyMetaError(sendError);
    const errorMessage = String(sendError?.message || "").slice(0, 500);
    // Só a resposta de ERRO da Meta prova que a mensagem não foi aceita. Timeout, falha
    // de rede ou resposta sem ID deixam o resultado DESCONHECIDO: reenviar poderia
    // duplicar — a linha fica 'failed/delivery_unknown' (e o webhook de status, se a
    // Meta tiver aceitado, promove a linha de volta a 'sent').
    if (!sendError?.metaRejected && !sendError?.notSent) {
      await ownedUpdate({
        status: "failed",
        attempts,
        error_code: "delivery_unknown",
        error_message: `Resultado do envio desconhecido (${errorMessage || "sem resposta da Meta"}). Não reenviada automaticamente para evitar duplicidade.`,
        failed_at: new Date().toISOString()
      });
      return;
    }
    if (classification === "temporary" && attempts < MAX_ATTEMPTS) {
      // volta para 'queued' — a próxima passada do cron tenta de novo
      // (backoff natural: só reprocessa no minuto seguinte, item 30).
      // queued_at avança para agora, indo para o FIM da fila (order by
      // queued_at asc) — sem isso, uma mensagem com erro temporário ficava
      // na frente da fila e podia consumir várias tentativas seguidas no
      // mesmo lote antes de deixar as próximas mensagens serem processadas.
      await ownedUpdate({
        status: "queued",
        attempts,
        queued_at: new Date().toISOString(),
        claim_token: null,
        processing_started_at: null,
        send_started_at: null,
        error_code: classification,
        error_message: errorMessage
      });
    } else {
      await ownedUpdate({
        status: "failed",
        attempts,
        error_code: classification,
        error_message: errorMessage,
        failed_at: new Date().toISOString()
      });
    }
  }
}

function orderedVariableValues(variables) {
  const keys = Object.keys(variables || {}).map(Number).sort((a, b) => a - b);
  return keys.map((key) => variables[key] ?? variables[String(key)] ?? "");
}

// Erro "temporário" = vale a pena tentar de novo (rate limit, timeout,
// instabilidade momentânea da Graph API); tudo o mais é tratado como
// permanente (telefone inválido, template pausado/rejeitado, credencial
// recusada) — nunca fica reenviando pra sempre (item 30).
function classifyMetaError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout") || message.includes("429") || /\(código 130429\)/.test(message) || message.includes("rate limit")) return "temporary";
  if (/\(código 5\d\d\)/.test(message) || message.includes("internal server") || message.includes("temporarily unavailable")) return "temporary";
  if (message.includes("network")) return "temporary";
  return "permanent";
}

async function finalizeBroadcastIfDone(broadcastId) {
  await recomputeCountersFromDb(broadcastId);
  const { count: remaining, error } = await db().from("whatsapp_broadcast_messages").select("id", { count: "exact", head: true }).eq("broadcast_id", broadcastId).in("status", ["queued", "processing"]);
  if (error) return;
  if ((remaining || 0) === 0) {
    await db().from("whatsapp_broadcasts").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", broadcastId).eq("status", "processing");
  }
}

async function recomputeCountersFromDb(broadcastId) {
  const { data, error } = await db().from("whatsapp_broadcast_messages").select("status").eq("broadcast_id", broadcastId);
  if (error || !data) return;
  const counts = { queued: 0, processing: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of data) counts[row.status] = (counts[row.status] || 0) + 1;
  await db().from("whatsapp_broadcasts").update({
    total_queued: counts.queued + counts.processing,
    total_sent: counts.sent + counts.delivered + counts.read,
    total_delivered: counts.delivered + counts.read,
    total_read: counts.read,
    total_failed: counts.failed
  }).eq("id", broadcastId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Chamada pelo cron (app/api/cron/whatsapp-broadcast-dispatch) — processa
// TODOS os broadcasts com fila pendente, dividindo o orçamento de tempo do
// cron entre eles, para nenhum broadcast grande monopolizar a execução e
// deixar os outros parados.
export async function processAllActiveBroadcastQueues(totalBudgetMs = 45000) {
  const { data: active, error } = await db().from("whatsapp_broadcasts").select("id").eq("status", "processing");
  if (error) throw error;
  if (!active?.length) return { processedBroadcasts: 0 };

  const perBroadcastBudget = Math.max(Math.floor(totalBudgetMs / active.length), 5000);
  let processedBroadcasts = 0;
  for (const row of active) {
    await processBroadcastQueueBatch(row.id, perBroadcastBudget);
    processedBroadcasts += 1;
  }
  return { processedBroadcasts, totalActive: active.length };
}

/* -------------------------------- Histórico --------------------------------- */

export async function listBroadcastHistory({ period, templateId, status, limit = 50 } = {}, auth) {
  assertGeneralAdminOrManager(auth);
  let query = db().from("whatsapp_broadcasts").select("*").order("created_at", { ascending: false }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200));
  if (templateId) query = query.eq("template_id", templateId);
  if (status) query = query.eq("status", status);
  if (period?.startIso) query = query.gte("created_at", period.startIso);
  if (period?.endIso) query = query.lt("created_at", period.endIso);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToBroadcast);
}

export async function getBroadcastDetail(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("whatsapp_broadcasts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: messages, error: messagesError } = await db().from("whatsapp_broadcast_messages")
    .select("id, full_name, phone_normalized, status, error_message, queued_at, sent_at, delivered_at, read_at, failed_at")
    .eq("broadcast_id", id)
    .order("queued_at", { ascending: false })
    .limit(2000);
  if (messagesError) throw messagesError;

  let campaignLink = "";
  if (data.link_campaign_id) {
    try {
      const campaign = await getCampaign(data.link_campaign_id);
      if (campaign) campaignLink = buildCampaignLink(campaign);
    } catch (linkError) {
      console.warn("Falha ao montar o link da campanha do disparo:", linkError?.message || linkError);
    }
  }

  return {
    ...rowToBroadcast(data),
    campaignLink,
    messages: (messages || []).map((row) => ({
      id: row.id,
      name: row.full_name,
      phone: row.phone_normalized,
      status: row.status,
      errorMessage: row.error_message || "",
      queuedAt: row.queued_at,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      failedAt: row.failed_at
    }))
  };
}

function rowToBroadcast(row) {
  return {
    id: row.id,
    campaignName: row.campaign_name,
    templateId: row.template_id,
    templateName: row.template_name,
    templateCategory: row.template_category,
    destinationJourney: row.destination_journey,
    sourceType: row.source_type,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    totals: {
      selected: row.total_selected,
      invalid: row.total_invalid,
      blocked: row.total_blocked,
      queued: row.total_queued,
      sent: row.total_sent,
      delivered: row.total_delivered,
      read: row.total_read,
      failed: row.total_failed
    }
  };
}

export function formatWhatsappBroadcastError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("does not exist") && (normalized.includes("whatsapp_broadcast") || normalized.includes("whatsapp_templates"))) {
    return "As tabelas do Disparo ainda não existem no Supabase. Execute a migration supabase/migrations/20260920000000_whatsapp_master_disparo.sql.";
  }
  return message || "Não foi possível concluir a operação de Disparo.";
}
