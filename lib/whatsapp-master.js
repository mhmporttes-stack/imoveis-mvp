import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { saveWhatsappMasterRuntimeSettings } from "./crm";
import { digitsOnly, toBrazilianE164, toWhatsAppDigits } from "./phone-utils";
import { getSupabaseAdminClient } from "./supabase";
import {
  buildAutomationResponseText,
  incrementAutomationReplyTriggerCount,
  materializeClientFromAutomationReply,
  matchAutomationReply
} from "./whatsapp-automation-replies";

const DEFAULT_GRAPH_VERSION = "v23.0";

// Caixa de entrada: as mensagens recebidas pelo número oficial já ficam
// gravadas em whatsapp_master_events (processWhatsappWebhook, abaixo) desde
// que a integração existe — só não existia nenhuma tela para ver essa lista.
// Só "message" (o que o cliente mandou de verdade); "sent"/"delivered"/"read"
// são status de entrega das mensagens que O SISTEMA envia, ruído numa caixa
// de entrada. "Carregar mais" por cursor de created_at, mais barato que
// OFFSET numa tabela que só cresce.
export async function listWhatsappMasterEvents({ limit = 30, beforeCreatedAt = "" } = {}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");

  let query = supabase
    .from("whatsapp_master_events")
    .select("id, message_id, sender_phone, contact_name, message_type, message_text, event_at, received_at, related_client_id, created_at")
    .eq("event_type", "message")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 30, 1), 100));

  if (beforeCreatedAt) query = query.lt("created_at", beforeCreatedAt);

  const { data, error } = await query;
  if (error) throw error;

  const clientIds = [...new Set((data || []).map((row) => row.related_client_id).filter(Boolean))];
  const clientsById = clientIds.length ? await getClientsByIds(clientIds) : {};

  return (data || []).map((row) => ({
    id: row.id,
    senderPhone: row.sender_phone || "",
    contactName: row.contact_name || "",
    messageType: row.message_type || "text",
    messageText: row.message_text || "",
    eventAt: row.event_at || row.received_at || row.created_at,
    createdAt: row.created_at,
    client: clientsById[row.related_client_id] || null
  }));
}

async function getClientsByIds(ids) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("simulation_registrations").select("id, full_name, client_code").in("id", ids);
  if (error) throw error;
  return (data || []).reduce((result, row) => {
    result[row.id] = { id: row.id, name: row.full_name || "Cliente sem nome", code: row.client_code || "" };
    return result;
  }, {});
}

export function getWhatsappMasterEnvironmentStatus() {
  return {
    accessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    businessAccountId: Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    webhookVerifyToken: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    appSecret: Boolean(getAppSecret())
  };
}

export function getWhatsappMasterDisplaySettings(settings) {
  const environment = getWhatsappMasterEnvironmentStatus();
  return {
    ...settings,
    phone: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || settings.phone,
    connectionStatus: environment.accessToken && environment.phoneNumberId
      ? settings.connectionStatus
      : "not_configured"
  };
}

export async function testWhatsappMasterConnection(updatedBy = null) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const checkedAt = new Date().toISOString();

  if (!token || !phoneNumberId) {
    const settings = await saveWhatsappMasterRuntimeSettings({
      connectionStatus: "not_configured",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastCheckedAt: checkedAt,
      lastError: "Credenciais da Meta ainda não configuradas."
    }, updatedBy);
    return { ok: false, settings, error: settings.lastError };
  }

  try {
    const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}`);
    url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));

    const settings = await saveWhatsappMasterRuntimeSettings({
      phone: payload.display_phone_number || "",
      connectionStatus: "connected",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastConnectedAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: "",
      active: true
    }, updatedBy);
    return {
      ok: true,
      settings,
      meta: { verifiedName: payload.verified_name || "", qualityRating: payload.quality_rating || "" }
    };
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "A API da Meta não respondeu a tempo."
      : String(error?.message || "Falha ao validar a conexão com a Meta.").slice(0, 240);
    const settings = await saveWhatsappMasterRuntimeSettings({
      connectionStatus: "disconnected",
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      lastCheckedAt: checkedAt,
      lastError: message
    }, updatedBy);
    return { ok: false, settings, error: message };
  }
}

// Mensagem de TEXTO livre (não template) — só pode ser mandada dentro da
// janela de 24h após a última mensagem do cliente (regra da própria Meta),
// que é exatamente a situação aqui: estamos respondendo a uma mensagem que
// ELE acabou de mandar. Por isso não precisa de template aprovado, ao
// contrário de sendWhatsappTemplateMessage (usada pelo Disparo, que manda
// pra quem não iniciou conversa nenhuma).
export async function sendWhatsappTextMessage({ to, text }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const recipient = toWhatsAppDigits(to);
  const body = String(text || "").trim();

  if (!token || !phoneNumberId) throw new Error("Credenciais da Meta Cloud API não configuradas.");
  if (!recipient) throw new Error("WhatsApp do destinatário inválido.");
  if (!body) throw new Error("Mensagem vazia.");

  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { body: body.slice(0, 4096) }
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));

  const messageId = String(payload?.messages?.[0]?.id || "");
  if (!messageId) throw new Error("A Meta não retornou o ID da mensagem enviada.");
  return { messageId, recipient: String(payload?.contacts?.[0]?.wa_id || recipient) };
}

// Automação de resposta por palavra-chave (Disparo → cliente responde →
// resposta automática, opcionalmente com o contato indo pra roleta). Regras
// e textos são geridos em lib/whatsapp-automation-replies.js — aqui só liga
// "chegou mensagem" com "manda a resposta configurada".
async function processAutomationReply(event) {
  const rule = await matchAutomationReply(event.message_text);
  if (!rule) return;

  let brokerProfile = null;
  if (rule.forwardToRoleta) {
    const result = await materializeClientFromAutomationReply({ phone: event.sender_phone, name: event.contact_name });
    brokerProfile = result.brokerProfile;
  }

  const responseText = buildAutomationResponseText(rule.responseMessage, { brokerProfile });
  await sendWhatsappTextMessage({ to: event.sender_phone, text: responseText });
  await incrementAutomationReplyTriggerCount(rule.id);
}

// buttonUrlParameter: só usado quando o template tem um botão de URL
// DINÂMICA (ex.: "{{site}}/simulacao?c={{1}}", criado com essa variável em
// createWhatsappMessageTemplate) — a Meta exige o valor do sufixo em um
// component `type: "button"` próprio, separado do corpo. Nunca a URL inteira,
// só o parâmetro que preenche {{1}} nela.
export async function sendWhatsappTemplateMessage({ to, templateName, languageCode = "pt_BR", bodyParameters = [], buttonUrlParameter = "" }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const recipient = toWhatsAppDigits(to);
  const cleanTemplateName = String(templateName || "").trim();

  if (!token || !phoneNumberId) throw new Error("Credenciais da Meta Cloud API não configuradas.");
  if (!recipient) throw new Error("WhatsApp do destinatário inválido.");
  if (!cleanTemplateName) throw new Error("Modelo de lembrete do WhatsApp não configurado.");

  const template = {
    name: cleanTemplateName,
    language: { code: String(languageCode || "pt_BR").trim() || "pt_BR" }
  };
  const components = [];
  const parameters = bodyParameters.map((value) => ({ type: "text", text: cleanTemplateParameter(value) }));
  if (parameters.length) components.push({ type: "body", parameters });
  if (buttonUrlParameter) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: cleanTemplateParameter(buttonUrlParameter) }]
    });
  }
  if (components.length) template.components = components;

  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));

  const messageId = String(payload?.messages?.[0]?.id || "");
  if (!messageId) throw new Error("A Meta não retornou o ID da mensagem enviada.");
  return { messageId, recipient: String(payload?.contacts?.[0]?.wa_id || recipient) };
}

// Cria um modelo (template) de mensagem na Meta para ser usado depois com
// sendWhatsappTemplateMessage — igual ao modelo de lembrete de atividade
// (WHATSAPP_REMINDER_TEMPLATE_NAME), só que criado por aqui em vez de manual
// no WhatsApp Manager. A Meta sempre exige revisão antes do modelo poder ser
// usado (normalmente minutos, às vezes até 24h) — status volta "PENDING".
// Suporta cabeçalho/corpo/rodapé/botão (item 5 do pedido "Disparo") mantendo
// 100% de retrocompatibilidade com o uso atual (provisionamento dos 3
// templates fixos do resumo diário só passa name/category/languageCode/
// bodyText/bodyExample — todos os campos novos são opcionais). O botão, se
// informado, é sempre do tipo URL DINÂMICA ({{1}} no final da URL) — é assim
// que uma campanha nova pode reaproveitar o MESMO template apontando para um
// link diferente a cada disparo (ver sendWhatsappTemplateMessage,
// buttonUrlParameter), sem precisar de um template por campanha.
export async function createWhatsappMessageTemplate({
  name,
  category = "UTILITY",
  languageCode = "pt_BR",
  headerText = "",
  bodyText,
  bodyExample = [],
  footerText = "",
  buttonText = "",
  buttonUrlTemplate = ""
}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  const cleanName = String(name || "").trim();
  const cleanBody = String(bodyText || "").trim();

  if (!token || !businessAccountId) throw new Error("Credenciais da Meta Cloud API não configuradas.");
  if (!cleanName) throw new Error("Nome do modelo não informado.");
  if (!cleanBody) throw new Error("Texto do modelo não informado.");

  const components = [];
  const cleanHeader = String(headerText || "").trim();
  if (cleanHeader) components.push({ type: "HEADER", format: "TEXT", text: cleanHeader });

  const bodyComponent = { type: "BODY", text: cleanBody };
  if (bodyExample.length) bodyComponent.example = { body_text: [bodyExample] };
  components.push(bodyComponent);

  const cleanFooter = String(footerText || "").trim();
  if (cleanFooter) components.push({ type: "FOOTER", text: cleanFooter });

  const cleanButtonText = String(buttonText || "").trim();
  const cleanButtonUrl = String(buttonUrlTemplate || "").trim();
  if (cleanButtonText && cleanButtonUrl) {
    components.push({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: cleanButtonText, url: cleanButtonUrl, example: [buildButtonUrlExample(cleanButtonUrl)] }]
    });
  }

  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(businessAccountId)}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: cleanName, language: languageCode, category, components }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));

  return { id: payload?.id || "", status: payload?.status || "PENDING", category: payload?.category || category, components };
}

// A Meta exige um exemplo de valor plausível para o parâmetro dinâmico de um
// botão URL na hora de submeter o template (não afeta o disparo real, só a
// análise) — usa "exemplo123" no lugar de {{1}} na própria URL configurada.
function buildButtonUrlExample(urlTemplate) {
  return urlTemplate.replace(/\{\{\d+\}\}/g, "exemplo123");
}

// Usado pelo provisionamento (ver rota provision-daily-performance-templates)
// para não tentar recriar um modelo que já existe — a Meta rejeita nome
// duplicado. Também é a base da sincronização do Disparo (item 9 do pedido):
// `id`/`components` a mais aqui são o que permite reconciliar templates que já
// existiam na conta com o registro local (whatsapp_templates) sem duplicar.
// Segue paginação da Graph API (`paging.next`) — uma conta com muitos
// templates não pode ficar limitada aos primeiros 200.
export async function listWhatsappMessageTemplates() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  if (!token || !businessAccountId) throw new Error("Credenciais da Meta Cloud API não configuradas.");

  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  let url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(businessAccountId)}/message_templates`);
  url.searchParams.set("fields", "id,name,status,category,language,components");
  url.searchParams.set("limit", "200");

  const templates = [];
  for (let page = 0; page < 10 && url; page += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));
    templates.push(...(payload?.data || []));
    url = payload?.paging?.next ? new URL(payload.paging.next) : null;
  }
  return templates;
}

// Consulta status/detalhe de UM template específico pelo Meta template ID —
// usada para atualizar o status de um template já criado sem precisar
// relistar a conta inteira (item 8: "Status dos templates").
export async function getWhatsappMessageTemplateStatus(metaTemplateId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const id = String(metaTemplateId || "").trim();
  if (!token) throw new Error("Credenciais da Meta Cloud API não configuradas.");
  if (!id) throw new Error("ID do template na Meta não informado.");

  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,name,status,category,language,components");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(sanitizeMetaError(payload?.error));
  return payload;
}

export function verifyWhatsappWebhookChallenge(searchParams) {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
  const mode = searchParams.get("hub.mode") || "";
  const token = searchParams.get("hub.verify_token") || "";
  const challenge = searchParams.get("hub.challenge") || "";
  return expected && mode === "subscribe" && challenge && safeEqual(token, expected) ? challenge : null;
}

export function verifyWhatsappWebhookSignature(rawBody, signature) {
  const secret = getAppSecret();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signature, expected);
}

export async function processWhatsappWebhook(payload) {
  const configuredPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const metadata = getWebhookMetadata(payload);

  if (!configuredPhoneNumberId) throw new Error("ID do número WhatsApp Master não configurado.");
  if (!metadata.phoneNumberIds.includes(configuredPhoneNumberId)) {
    return { received: 0, inserted: 0, ignored: "phone_number_id_mismatch" };
  }

  const events = extractWhatsappEvents(payload, configuredPhoneNumberId);
  if (!events.length) return { received: 0, inserted: 0 };

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase não configurado no servidor.");

  // Um webhook pode trazer dezenas de eventos de uma vez (a Meta agrupa) —
  // busca todos os telefones remetentes numa única consulta em vez de uma
  // por evento, senão um webhook de uma campanha de Disparo vira dezenas de
  // round-trips sequenciais só pra correlacionar cliente.
  const clientByPhone = await findClientsByPhones(events.map((event) => event.sender_phone));
  const rows = events.map((event) => ({ ...event, related_client_id: event.sender_phone ? clientByPhone.get(event.sender_phone) || null : null }));

  // select() após upsert com ignoreDuplicates:true só devolve as linhas
  // REALMENTE inseridas agora (a Meta reentrega o mesmo evento às vezes) —
  // é o que garante que a automação de resposta abaixo nunca processa o
  // mesmo "sim" do cliente duas vezes por causa de um reenvio de webhook.
  const { data, error } = await supabase
    .from("whatsapp_master_events")
    .upsert(rows, { onConflict: "event_key", ignoreDuplicates: true })
    .select("id, event_type, direction, sender_phone, contact_name, message_text");
  if (error) throw error;

  const newInboundMessages = (data || []).filter((row) => row.event_type === "message" && row.direction === "inbound" && row.message_text);
  if (newInboundMessages.length) {
    // Best-effort: uma falha na automação (ex.: nenhum corretor ativo na
    // roleta) nunca pode derrubar o processamento do webhook em si — a Meta
    // reenvia webhooks que respondem erro, e o restante do evento (guardar a
    // mensagem, sincronizar status de disparo) já terminou de qualquer jeito.
    await Promise.all(newInboundMessages.map((event) => processAutomationReply(event).catch((automationError) => {
      console.warn("Falha na automação de resposta do WhatsApp:", automationError?.message || automationError);
    })));
  }

  // Reaproveita o MESMO webhook (item 33 do pedido "Disparo") — nenhum
  // endpoint novo. Toda mensagem enviada por uma campanha de Disparo tem seu
  // whatsapp_message_id salvo em whatsapp_broadcast_messages no momento do
  // envio (ver lib/whatsapp-broadcasts.js); aqui só correlaciona o evento de
  // status recebido a essa linha, por ID — mensagens de fora de uma campanha
  // (lembrete de atividade, resumo diário) simplesmente não encontram
  // nenhuma linha e são ignoradas silenciosamente (comportamento correto).
  await syncBroadcastMessageStatuses(events.filter((event) => event.direction === "outbound"));

  const now = new Date().toISOString();
  await saveWhatsappMasterRuntimeSettings({
    phoneNumberId: configuredPhoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    connectionStatus: "connected",
    lastConnectedAt: now,
    lastWebhookAt: now,
    lastError: "",
    active: true
  });

  return { received: events.length, inserted: data?.length || 0 };
}

function extractWhatsappEvents(payload, configuredPhoneNumberId) {
  const rows = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const recipientPhoneId = value?.metadata?.phone_number_id || "";
      if (recipientPhoneId !== configuredPhoneNumberId) continue;
      const contacts = new Map((value.contacts || []).map((contact) => [digitsOnly(contact?.wa_id), contact?.profile?.name || ""]));

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const senderPhone = normalizeIncomingPhone(message?.from);
        const messageId = String(message?.id || "");
        if (!messageId) continue;
        rows.push({
          event_key: `message:${messageId}`,
          message_id: messageId,
          direction: "inbound",
          event_type: "message",
          sender_phone: senderPhone || null,
          contact_name: contacts.get(digitsOnly(message?.from)) || null,
          recipient_phone_id: recipientPhoneId || null,
          message_type: message?.type || "unknown",
          message_text: extractMessageText(message),
          event_at: unixToIso(message?.timestamp),
          raw_payload: { message, metadata: value.metadata || {} }
        });
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = String(status?.id || "");
        const statusName = String(status?.status || "unknown");
        if (!messageId) continue;
        rows.push({
          event_key: `status:${messageId}:${statusName}:${status?.timestamp || ""}`,
          message_id: messageId,
          direction: "outbound",
          event_type: statusName,
          sender_phone: normalizeIncomingPhone(status?.recipient_id) || null,
          contact_name: null,
          recipient_phone_id: recipientPhoneId || null,
          message_type: null,
          message_text: null,
          event_at: unixToIso(status?.timestamp),
          raw_payload: { status, metadata: value.metadata || {} }
        });
      }
    }
  }
  return rows;
}

const BROADCAST_STATUS_MAP = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
const BROADCAST_STATUS_TIMESTAMP_COLUMN = { sent: "sent_at", delivered: "delivered_at", read: "read_at", failed: "failed_at" };
// Ordem de progresso — nunca deixa um "delivered" tardio regredir um
// "read" já registrado (a Meta pode reentregar eventos fora de ordem).
const BROADCAST_STATUS_RANK = { queued: 0, processing: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

async function syncBroadcastMessageStatuses(statusEvents) {
  const relevantEvents = statusEvents.filter((event) => BROADCAST_STATUS_MAP[event.event_type] && event.message_id);
  if (!relevantEvents.length) return;
  const supabase = getSupabaseAdminClient();

  // Uma leitura só pra todos os message_id deste webhook, em vez de uma
  // consulta por evento de status — a Meta costuma agrupar vários eventos
  // de uma mesma campanha de Disparo no mesmo POST.
  const messageIds = [...new Set(relevantEvents.map((event) => event.message_id))];
  const { data: currentRows, error: readError } = await supabase
    .from("whatsapp_broadcast_messages")
    .select("id, broadcast_id, status, whatsapp_message_id")
    .in("whatsapp_message_id", messageIds);
  if (readError) return;
  const byMessageId = new Map((currentRows || []).map((row) => [row.whatsapp_message_id, row]));

  const broadcastIdsTouched = new Set();
  for (const event of relevantEvents) {
    const current = byMessageId.get(event.message_id);
    if (!current) continue; // mensagem de fora de uma campanha de Disparo — ignora
    const nextStatus = BROADCAST_STATUS_MAP[event.event_type];
    if ((BROADCAST_STATUS_RANK[current.status] || 0) >= BROADCAST_STATUS_RANK[nextStatus]) continue;

    const update = { status: nextStatus, [BROADCAST_STATUS_TIMESTAMP_COLUMN[nextStatus]]: event.event_at || new Date().toISOString() };
    if (nextStatus === "failed") {
      const errorInfo = event.raw_payload?.status?.errors?.[0];
      if (errorInfo) {
        update.error_code = String(errorInfo.code || "");
        update.error_message = String(errorInfo.title || errorInfo.message || "").slice(0, 500);
      }
    }
    const { error: updateError } = await supabase.from("whatsapp_broadcast_messages").update(update).eq("id", current.id);
    if (!updateError) {
      broadcastIdsTouched.add(current.broadcast_id);
      // Mantém o cache local coerente com o banco caso o mesmo message_id
      // apareça mais de uma vez neste webhook (ex.: "sent" e "delivered"
      // no mesmo lote), pra não deixar passar um status mais avançado.
      current.status = nextStatus;
    }
  }

  await recomputeBroadcastCounters([...broadcastIdsTouched]);
}

async function recomputeBroadcastCounters(broadcastIds) {
  const ids = [...new Set(Array.isArray(broadcastIds) ? broadcastIds : [broadcastIds])].filter(Boolean);
  if (!ids.length) return;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("whatsapp_broadcast_messages").select("broadcast_id, status").in("broadcast_id", ids);
  if (error || !data) return;

  const countsByBroadcast = new Map();
  for (const row of data) {
    if (!countsByBroadcast.has(row.broadcast_id)) countsByBroadcast.set(row.broadcast_id, { queued: 0, processing: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
    const counts = countsByBroadcast.get(row.broadcast_id);
    counts[row.status] = (counts[row.status] || 0) + 1;
  }

  for (const [broadcastId, counts] of countsByBroadcast) {
    await supabase.from("whatsapp_broadcasts").update({
      total_queued: counts.queued + counts.processing,
      total_sent: counts.sent + counts.delivered + counts.read,
      total_delivered: counts.delivered + counts.read,
      total_read: counts.read,
      total_failed: counts.failed
    }).eq("id", broadcastId);
  }
}

// Versão em lote de findClientByPhone — uma única consulta pra qualquer
// quantidade de telefones (em vez de um round-trip por telefone), mantendo a
// mesma regra de desempate: entre as variantes (E.164/dígitos/nacional) de
// um telefone, vence o cadastro mais recente entre TODAS elas, não só a
// primeira variante que encontrar algo.
async function findClientsByPhones(phones) {
  const supabase = getSupabaseAdminClient();
  const uniquePhones = [...new Set((phones || []).filter(Boolean))];
  if (!uniquePhones.length) return new Map();

  const candidatesByPhone = new Map();
  const allCandidates = new Set();
  for (const phone of uniquePhones) {
    const e164 = toBrazilianE164(phone);
    const digits = digitsOnly(phone);
    const national = digits.startsWith("55") ? digits.slice(2) : digits;
    const candidates = Array.from(new Set([e164, digits, national].filter(Boolean)));
    candidatesByPhone.set(phone, candidates);
    candidates.forEach((candidate) => allCandidates.add(candidate));
  }
  if (!allCandidates.size) return new Map();

  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("id, phone_normalized, created_at")
    .in("phone_normalized", Array.from(allCandidates))
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byNormalized = new Map();
  for (const row of data || []) {
    if (!byNormalized.has(row.phone_normalized)) byNormalized.set(row.phone_normalized, row);
  }

  const result = new Map();
  for (const phone of uniquePhones) {
    let best = null;
    for (const candidate of candidatesByPhone.get(phone) || []) {
      const row = byNormalized.get(candidate);
      if (row && (!best || row.created_at > best.created_at)) best = row;
    }
    result.set(phone, best?.id || null);
  }
  return result;
}

function getWebhookMetadata(payload) {
  const phoneNumberIds = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const metadata = change?.value?.metadata;
      if (metadata?.phone_number_id) phoneNumberIds.push(String(metadata.phone_number_id));
    }
  }
  return { phoneNumberIds };
}

function extractMessageText(message) {
  if (message?.type === "text") return message?.text?.body || null;
  if (message?.type === "button") return message?.button?.text || null;
  if (message?.type === "interactive") {
    return message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || null;
  }
  return null;
}

function normalizeIncomingPhone(value) {
  return toBrazilianE164(value) || (digitsOnly(value) ? `+${digitsOnly(value)}` : "");
}

function unixToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeGraphVersion(value) {
  const version = String(value || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

function getAppSecret() {
  return process.env.WHATSAPP_APP_SECRET || process.env.APP_SECRET || "";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeMetaError(error) {
  const message = String(error?.message || "Credenciais recusadas pela Meta.");
  const code = error?.code ? ` (código ${error.code})` : "";
  const details = [error?.error_data?.details, error?.error_user_title, error?.error_user_msg]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" — ");
  const subcode = error?.error_subcode ? `/${error.error_subcode}` : "";
  return `${message}${code}${subcode}${details ? `: ${details}` : ""}`.slice(0, 700);
}

function cleanTemplateParameter(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 900) || "Não informado";
}
