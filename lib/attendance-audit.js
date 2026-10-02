import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertCanAccessResponsibleUser } from "./admin-access";
import { getAdminProfileById } from "./admin-profiles";
import { getBrokerPerformanceOverview, resolveOverviewRange, OVERVIEW_PERIODS } from "./performance-overview";
import { addDaysToPlainDate, formatPlainDateBR, getTodayInSaoPaulo, normalizePlainDate, zonedPlainDateToUtcIso } from "./daily-report";
import { recordAiUsage } from "./ai-usage";

// Auditoria de Atendimento (Gestão > Desempenho > Auditoria) — reaproveita
// integralmente o Chat (whatsapp_conversations/whatsapp_messages) e o motor
// de desempenho (getBrokerPerformanceOverview, MESMA fonte do funil/ranking)
// para as métricas OBJETIVAS, e chama a OpenAI (mesmo padrão de
// app/api/analyze/route.js: /v1/responses + json_schema) só para a análise
// QUALITATIVA das conversas reais. Nada aqui recalcula pontuação/funil por
// conta própria — só lê o que já existe.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Mesmo escopo de "conversas do corretor" usado pelo Chat (chatScope/
// runScopedQuery em lib/whatsapp-chat.js): responsável do cliente OU
// conversa atribuída a ele — nunca uma cópia divergente dessa regra.
async function loadBrokerConversations(brokerId) {
  const supabase = db();
  // Mesma regra de visibilidade do Chat (conversa = telefone + sessão): o
  // número oficial entra por cliente/atribuição; a conversa de WhatsApp
  // pessoal entra só para o DONO da linha — a auditoria de um corretor nunca
  // conta mensagem que passou pelo WhatsApp de outro.
  const NO_SESSION = "00000000-0000-0000-0000-000000000000";
  const [byClient, byAssignee, bySession] = await Promise.all([
    supabase
      .from("whatsapp_conversations")
      .select("id, client_id, status, last_message_direction, last_message_at, created_at, scope:simulation_registrations!client_id!inner(responsible_user_id, full_name)")
      .is("deleted_at", null)
      .eq("session_key", NO_SESSION)
      .eq("scope.responsible_user_id", brokerId),
    supabase
      .from("whatsapp_conversations")
      .select("id, client_id, status, last_message_direction, last_message_at, created_at")
      .is("deleted_at", null)
      .eq("session_key", NO_SESSION)
      .eq("assigned_user_id", brokerId),
    supabase
      .from("whatsapp_conversations")
      .select("id, client_id, status, last_message_direction, last_message_at, created_at")
      .is("deleted_at", null)
      .eq("session_key", brokerId)
  ]);
  if (byClient.error) throw byClient.error;
  if (byAssignee.error) throw byAssignee.error;
  if (bySession.error) throw bySession.error;

  const byId = new Map();
  for (const row of byClient.data || []) byId.set(row.id, row);
  for (const row of byAssignee.data || []) if (!byId.has(row.id)) byId.set(row.id, row);
  for (const row of bySession.data || []) if (!byId.has(row.id)) byId.set(row.id, row);
  return Array.from(byId.values());
}

async function loadMessagesInRange(conversationIds, range) {
  if (!conversationIds.length) return [];
  const CHUNK = 300; // .in() com muitos ids — mesmo cuidado de fetchAllRows em outras libs
  const rows = [];
  for (let i = 0; i < conversationIds.length; i += CHUNK) {
    const chunk = conversationIds.slice(i, i + CHUNK);
    const { data, error } = await db()
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, sender_type, sender_user_id, message_type, body, message_at")
      .in("conversation_id", chunk)
      .gte("message_at", range.startIso)
      .lt("message_at", range.endIso)
      .order("message_at", { ascending: true });
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

// Grupos/rótulos exibidos no relatório — cada chave aqui precisa existir em
// METRIC_META (unidade + "menor é melhor?", usado na comparação com a
// auditoria anterior).
export const METRIC_GROUPS = [
  { key: "volume", label: "VOLUME", items: ["clientsAttended", "conversations", "messagesSent", "messagesReceived"] },
  { key: "prospeccao", label: "PROSPECÇÃO", items: ["prospecting", "prospectingResponded", "prospectingResponseRate"] },
  { key: "conversao", label: "CONVERSÃO", items: ["service", "simulation", "documentation", "approvalPending", "approval", "meeting", "sale", "conversionProspectToSale"] },
  { key: "velocidade", label: "VELOCIDADE", items: ["firstResponseMinutes", "avgResponseMinutes", "medianResponseMinutes"] },
  { key: "followup", label: "FOLLOW-UP", items: ["completedActivities", "awaitingAction", "noFutureActivity", "conversationsWithoutContinuity"] }
];

const METRIC_META = {
  clientsAttended: { label: "Clientes atendidos", unit: "count" },
  conversations: { label: "Conversas", unit: "count" },
  messagesSent: { label: "Mensagens enviadas", unit: "count" },
  messagesReceived: { label: "Mensagens recebidas", unit: "count" },
  prospecting: { label: "Prospecções", unit: "count" },
  prospectingResponded: { label: "Respostas às prospecções", unit: "count" },
  prospectingResponseRate: { label: "Taxa de resposta", unit: "percent" },
  service: { label: "Atendimentos (funil)", unit: "count" },
  simulation: { label: "Simulações", unit: "count" },
  documentation: { label: "Documentação", unit: "count" },
  approvalPending: { label: "Aguardando aprovação", unit: "count" },
  approval: { label: "Aprovações", unit: "count" },
  meeting: { label: "Reuniões", unit: "count" },
  sale: { label: "Vendas", unit: "count" },
  conversionProspectToSale: { label: "Conversão Prospecção → Venda", unit: "percent" },
  firstResponseMinutes: { label: "Primeira resposta", unit: "minutes", lowerIsBetter: true },
  avgResponseMinutes: { label: "Tempo médio de resposta", unit: "minutes", lowerIsBetter: true },
  medianResponseMinutes: { label: "Tempo mediano de resposta", unit: "minutes", lowerIsBetter: true },
  completedActivities: { label: "Atividades/follow-ups concluídos", unit: "count" },
  awaitingAction: { label: "Clientes aguardando ação", unit: "count", lowerIsBetter: true },
  noFutureActivity: { label: "Sem atividade futura agendada", unit: "count", lowerIsBetter: true },
  conversationsWithoutContinuity: { label: "Conversas sem continuidade", unit: "count", lowerIsBetter: true }
};

// Métricas 100% calculadas pelo sistema/banco (nunca pela IA) — VOLUME,
// PROSPECÇÃO e VELOCIDADE vêm de whatsapp_messages/whatsapp_conversations
// (Chat real); CONVERSÃO e FOLLOW-UP reaproveitam getBrokerPerformanceOverview
// (a MESMA fonte do funil/"Ranking da Equipe" — nenhuma cópia de regra).
export async function computeAuditMetrics(brokerId, range, auth) {
  const [overview, conversations] = await Promise.all([
    getBrokerPerformanceOverview(brokerId, { period: OVERVIEW_PERIODS.CUSTOM, startDate: range.startDate, endDate: range.endDate }, auth),
    loadBrokerConversations(brokerId)
  ]);

  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const conversationIds = conversations.map((row) => row.id);
  const messages = await loadMessagesInRange(conversationIds, range);

  const messagesByConversation = new Map();
  for (const message of messages) {
    if (!messagesByConversation.has(message.conversation_id)) messagesByConversation.set(message.conversation_id, []);
    messagesByConversation.get(message.conversation_id).push(message);
  }

  const touchedConversationIds = new Set(messages.map((message) => message.conversation_id));
  const messagesSent = messages.filter((message) => message.sender_type === "user" && message.sender_user_id === brokerId && message.direction === "outbound");
  const messagesReceived = messages.filter((message) => message.direction === "inbound");
  const clientsAttended = new Set(messagesSent.map((message) => conversationById.get(message.conversation_id)?.client_id).filter(Boolean));

  // Velocidade: para cada par (mensagem do cliente → próxima resposta do
  // corretor NA MESMA conversa), a diferença em minutos. "Primeira resposta"
  // usa só as conversas cujo created_at cai dentro do período (contato novo).
  const responseGaps = [];
  const firstResponseGaps = [];
  let prospectingInitiated = 0;
  let prospectingResponded = 0;
  let conversationsWithoutContinuity = 0;

  for (const [conversationId, list] of messagesByConversation) {
    const conversation = conversationById.get(conversationId);
    let pendingInboundAt = null;
    let firstMessage = true;
    let initiatedByBroker = false;
    let gotClientReply = false;
    let firstResponseRecorded = false;
    const isNewConversationInRange = Boolean(conversation?.created_at) && conversation.created_at >= range.startIso && conversation.created_at < range.endIso;

    for (const message of list) {
      if (message.direction === "inbound") {
        if (pendingInboundAt === null) pendingInboundAt = message.message_at;
        if (firstMessage) initiatedByBroker = false;
        gotClientReply = initiatedByBroker ? true : gotClientReply;
      } else if (message.direction === "outbound") {
        if (firstMessage) initiatedByBroker = true;
        if (pendingInboundAt !== null) {
          const gapMinutes = (new Date(message.message_at) - new Date(pendingInboundAt)) / 60000;
          if (Number.isFinite(gapMinutes) && gapMinutes >= 0) {
            responseGaps.push(gapMinutes);
            if (isNewConversationInRange && !firstResponseRecorded) {
              firstResponseGaps.push((new Date(message.message_at) - new Date(conversation.created_at)) / 60000);
              firstResponseRecorded = true;
            }
          }
          pendingInboundAt = null;
        }
      }
      firstMessage = false;
    }

    if (initiatedByBroker) {
      prospectingInitiated += 1;
      if (gotClientReply) prospectingResponded += 1;
    }
  }

  // "Sem continuidade": conversas do corretor cuja última mensagem é do
  // cliente e ele nunca respondeu depois (reaproveita last_message_direction,
  // a MESMA coluna do filtro "Sem resposta" do próprio Chat) — nunca inventa
  // um novo cálculo de silêncio.
  conversationsWithoutContinuity = conversations.filter(
    (row) => touchedConversationIds.has(row.id) && row.last_message_direction === "inbound" && row.status !== "finished"
  ).length;

  const broker = overview.broker || {};
  const metrics = {
    clientsAttended: clientsAttended.size,
    conversations: touchedConversationIds.size,
    messagesSent: messagesSent.length,
    messagesReceived: messagesReceived.length,
    prospecting: broker.prospecting || 0,
    prospectingResponded,
    prospectingResponseRate: prospectingInitiated ? (prospectingResponded / prospectingInitiated) * 100 : null,
    service: broker.service || 0,
    simulation: broker.simulation || 0,
    documentation: broker.documentation || 0,
    approvalPending: broker.approvalPending || 0,
    approval: broker.approval || 0,
    meeting: broker.meeting || 0,
    sale: broker.sale || 0,
    conversionProspectToSale: broker.prospecting ? (broker.sale / broker.prospecting) * 100 : null,
    firstResponseMinutes: firstResponseGaps.length ? Math.round(average(firstResponseGaps)) : null,
    avgResponseMinutes: responseGaps.length ? Math.round(average(responseGaps)) : null,
    medianResponseMinutes: responseGaps.length ? Math.round(median(responseGaps)) : null,
    completedActivities: broker.completedActivities || 0,
    awaitingAction: broker.awaitingAction || 0,
    noFutureActivity: broker.noFutureActivity || 0,
    conversationsWithoutContinuity
  };

  return { metrics, conversations, messagesByConversation, range: overview.range };
}

// Amostra compacta de conversas reais para a IA analisar — nunca a base
// inteira. Prioriza as conversas com mais interação (mais evidência por
// token gasto) e limita tamanho total de caracteres enviados (regra #9:
// "não enviar informações desnecessárias à OpenAI").
const MAX_SAMPLE_CONVERSATIONS = 20;
const MAX_TRANSCRIPT_CHARS = 45000;
const MAX_MESSAGE_CHARS = 400;

function buildTranscriptSample(conversations, messagesByConversation) {
  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const ranked = Array.from(messagesByConversation.entries())
    .map(([conversationId, list]) => ({
      conversationId,
      list,
      clientId: conversationById.get(conversationId)?.client_id || "",
      clientName: conversationById.get(conversationId)?.scope?.full_name || "Cliente"
    }))
    .filter((entry) => entry.list.some((message) => message.direction === "inbound") && entry.list.length >= 2)
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, MAX_SAMPLE_CONVERSATIONS);

  let budget = MAX_TRANSCRIPT_CHARS;
  const blocks = [];
  const evidenceIndex = {};
  for (const entry of ranked) {
    if (budget <= 0) break;
    const lines = entry.list
      .filter((message) => message.direction !== "internal" && (message.body || message.message_type !== "text"))
      .map((message) => {
        const who = message.direction === "outbound" ? (message.sender_type === "automation" ? "automação" : "corretor") : "cliente";
        const text = (message.body || `[${message.message_type}]`).slice(0, MAX_MESSAGE_CHARS);
        return `[${who}] ${text}`;
      });
    if (!lines.length) continue;
    const header = `--- Conversa ${entry.conversationId} (cliente: ${entry.clientName}) ---`;
    const block = [header, ...lines].join("\n");
    if (block.length > budget) break;
    blocks.push(block);
    evidenceIndex[entry.conversationId] = { clientId: entry.clientId, clientName: entry.clientName };
    budget -= block.length;
  }
  return { transcriptText: blocks.join("\n\n"), evidenceIndex };
}

const AUDIT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resumo: { type: "string" },
    pontosFortes: { type: "array", items: { type: "string" } },
    pontosFracos: { type: "array", items: { type: "string" } },
    erros: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          descricao: { type: "string" },
          conversationId: { type: "string" }
        },
        required: ["descricao", "conversationId"]
      }
    },
    oportunidadesPerdidas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          descricao: { type: "string" },
          conversationId: { type: "string" }
        },
        required: ["descricao", "conversationId"]
      }
    },
    recomendacoes: { type: "array", items: { type: "string" } },
    prioridadesMelhoria: { type: "array", items: { type: "string" } },
    cruzamentoQualidadeResultado: { type: "array", items: { type: "string" } },
    comparacaoQualitativa: {
      type: "object",
      additionalProperties: false,
      properties: {
        evoluiu: { type: "array", items: { type: "string" } },
        piorou: { type: "array", items: { type: "string" } },
        permanece: { type: "array", items: { type: "string" } },
        problemasCorrigidos: { type: "array", items: { type: "string" } },
        problemasRecorrentes: { type: "array", items: { type: "string" } },
        novaPrioridade: { type: "string" }
      },
      required: ["evoluiu", "piorou", "permanece", "problemasCorrigidos", "problemasRecorrentes", "novaPrioridade"]
    }
  },
  required: ["resumo", "pontosFortes", "pontosFracos", "erros", "oportunidadesPerdidas", "recomendacoes", "prioridadesMelhoria", "cruzamentoQualidadeResultado", "comparacaoQualitativa"]
};

const EMPTY_AI_RESULT = {
  resumo: "Análise por IA indisponível (OPENAI_API_KEY não configurada). Métricas objetivas abaixo continuam válidas.",
  pontosFortes: [],
  pontosFracos: [],
  erros: [],
  oportunidadesPerdidas: [],
  recomendacoes: [],
  prioridadesMelhoria: [],
  cruzamentoQualidadeResultado: [],
  comparacaoQualitativa: { evoluiu: [], piorou: [], permanece: [], problemasCorrigidos: [], problemasRecorrentes: [], novaPrioridade: "" }
};

// Mesmo padrão de chamada OpenAI usado em app/api/analyze/route.js
// (/v1/responses + text.format json_schema) — nenhuma integração paralela.
async function callOpenAiForAudit({ brokerName, range, metrics, transcriptText, previousAiResult }) {
  if (!process.env.OPENAI_API_KEY || !transcriptText) return { result: EMPTY_AI_RESULT, usage: null };

  const metricsSummary = METRIC_GROUPS.map((group) => `${group.label}: ` + group.items.map((key) => `${METRIC_META[key].label}=${metrics[key] ?? "—"}`).join(", ")).join("\n");

  const systemPrompt = "Você audita o atendimento via WhatsApp de corretores de imóveis no Brasil. Analise SOMENTE o que está nas conversas fornecidas — nunca invente ocorrências. Todo erro/oportunidade perdida relatado precisa citar o conversationId real de onde veio, exatamente como aparece no cabeçalho '--- Conversa <id> ---'. Trate relações entre qualidade e resultado comercial como correlações observadas, nunca como causalidade comprovada. Responda em português do Brasil.";

  const userParts = [
    `Corretor: ${brokerName}`,
    `Período: ${formatPlainDateBR(range.startDate)} a ${formatPlainDateBR(range.endDate)}`,
    `Métricas objetivas (já calculadas pelo sistema, não recalcule):\n${metricsSummary}`,
    previousAiResult ? `Resultado da auditoria ANTERIOR deste corretor (para a comparação qualitativa):\n${JSON.stringify(previousAiResult).slice(0, 4000)}` : "Não há auditoria anterior deste corretor — deixe comparacaoQualitativa com listas vazias e novaPrioridade vazia.",
    `Conversas reais do período (amostra):\n${transcriptText}`
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n\n") }
      ],
      text: { format: { type: "json_schema", name: "auditoria_atendimento", schema: AUDIT_RESULT_SCHEMA } }
    })
  });

  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  const result = JSON.parse(payload.output_text || "{}");
  return { result, usage: payload.usage || null };
}

// Preço estimado (gpt-4.1-mini, USD por milhão de tokens) — só para o
// registro em ai_usage_log, mesmo padrão de lib/document-analysis.js.
const OPENAI_PRICE_INPUT_PER_MILLION = 0.4;
const OPENAI_PRICE_OUTPUT_PER_MILLION = 1.6;

function estimateOpenAiCostUsd(usage) {
  if (!usage) return 0;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return (input / 1_000_000) * OPENAI_PRICE_INPUT_PER_MILLION + (output / 1_000_000) * OPENAI_PRICE_OUTPUT_PER_MILLION;
}

// Auditoria imediatamente anterior deste corretor (a mais recente cujo fim
// de período é anterior ao início do período pedido) — usada para sugerir o
// próximo período sem sobreposição e para a comparação.
export async function getPreviousAudit(brokerId, beforeStartDate) {
  const { data, error } = await db()
    .from("attendance_audits")
    .select("*")
    .eq("broker_id", brokerId)
    .lt("period_end", beforeStartDate)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Uma única forma (camelCase) tanto para a auditoria recém-criada quanto
// para o histórico — evita a UI ter que lidar com snake_case vindo direto
// do banco em um caminho e camelCase no outro.
function normalizeAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    brokerId: row.broker_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    metrics: row.metrics,
    comparison: row.comparison,
    aiResult: row.ai_result,
    evidenceIndex: row.evidence_index || {}
  };
}

export async function listAttendanceAudits(brokerId, auth) {
  assertCanAccessResponsibleUser(auth, brokerId);
  const { data, error } = await db()
    .from("attendance_audits")
    .select("id, broker_id, period_start, period_end, generated_at, metrics, comparison, ai_result, evidence_index")
    .eq("broker_id", brokerId)
    .order("period_end", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map(normalizeAuditRow);
}

export async function getAttendanceAudit(id, auth) {
  const { data, error } = await db().from("attendance_audits").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  assertCanAccessResponsibleUser(auth, data.broker_id);
  return data;
}

// Sugestão de próximo período: dia seguinte ao fim da última auditoria até
// hoje — evita sobreposição por padrão (regra #6).
export async function suggestNextAuditRange(brokerId, auth) {
  assertCanAccessResponsibleUser(auth, brokerId);
  const today = getTodayInSaoPaulo();
  const previous = await getPreviousAudit(brokerId, addDaysToPlainDate(today, 1));
  if (!previous) return { startDate: addDaysToPlainDate(today, -9), endDate: today };
  const suggestedStart = addDaysToPlainDate(previous.period_end, 1);
  return { startDate: suggestedStart > today ? today : suggestedStart, endDate: today };
}

function compareValue(key, previousValue, currentValue) {
  const meta = METRIC_META[key];
  if (previousValue == null || currentValue == null) return { key, label: meta.label, unit: meta.unit, previousValue: previousValue ?? null, currentValue: currentValue ?? null, changePercent: null, status: "sem_dado_anterior" };
  const diff = currentValue - previousValue;
  const changePercent = previousValue !== 0 ? (diff / Math.abs(previousValue)) * 100 : (currentValue === 0 ? 0 : null);
  let status = "manteve";
  const tolerance = meta.unit === "percent" ? 0.5 : Math.max(1, Math.abs(previousValue) * 0.02);
  if (Math.abs(diff) > tolerance) {
    const improved = meta.lowerIsBetter ? diff < 0 : diff > 0;
    status = improved ? "melhorou" : "piorou";
  }
  return { key, label: meta.label, unit: meta.unit, previousValue, currentValue, changePercent, status };
}

export function compareAuditMetrics(previousMetrics, currentMetrics) {
  if (!previousMetrics) return null;
  return Object.keys(METRIC_META).map((key) => compareValue(key, previousMetrics[key], currentMetrics[key]));
}

// Orquestrador — chamado pela API. Não recalcula auditorias antigas (regra
// #5): a anterior é só LIDA para comparação, nunca reescrita.
export async function createAttendanceAudit({ brokerId, startDate, endDate, auth }) {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  assertCanAccessResponsibleUser(auth, brokerId);

  const safeStart = normalizePlainDate(startDate);
  const safeEnd = normalizePlainDate(endDate);
  if (!safeStart || !safeEnd) throw new Error("Informe data inicial e final válidas.");

  const broker = await getAdminProfileById(brokerId);
  if (!broker) throw new Error("Corretor não encontrado.");

  const range = resolveOverviewRange({ period: OVERVIEW_PERIODS.CUSTOM, startDate: safeStart, endDate: safeEnd });
  const { metrics, conversations, messagesByConversation } = await computeAuditMetrics(brokerId, range, auth);
  const { transcriptText, evidenceIndex } = buildTranscriptSample(conversations, messagesByConversation);

  const previousAudit = await getPreviousAudit(brokerId, range.startDate);

  let aiResult = EMPTY_AI_RESULT;
  try {
    const { result, usage } = await callOpenAiForAudit({
      brokerName: broker.name || broker.email || "Corretor",
      range,
      metrics,
      transcriptText,
      previousAiResult: previousAudit?.ai_result || null
    });
    aiResult = result;
    if (usage) {
      await recordAiUsage({
        feature: "attendance_audit",
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        triggeredBy: auth?.profile?.email || "",
        clientId: null,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        costUsd: estimateOpenAiCostUsd(usage),
        success: true
      }).catch(() => {});
    }
  } catch (error) {
    aiResult = { ...EMPTY_AI_RESULT, resumo: `Falha ao chamar a IA: ${error.message || error}. Métricas objetivas abaixo continuam válidas.` };
    await recordAiUsage({ feature: "attendance_audit", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", triggeredBy: auth?.profile?.email || "", success: false, errorMessage: String(error.message || error) }).catch(() => {});
  }

  const comparison = previousAudit ? compareAuditMetrics(previousAudit.metrics, metrics) : null;

  const { data: inserted, error: insertError } = await db()
    .from("attendance_audits")
    .insert({
      broker_id: brokerId,
      period_start: safeStart,
      period_end: safeEnd,
      generated_by: auth?.profile?.id || null,
      metrics,
      ai_result: aiResult,
      comparison,
      evidence_index: evidenceIndex,
      previous_audit_id: previousAudit?.id || null
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  return { ...normalizeAuditRow(inserted), brokerName: broker.name || broker.email || "Corretor" };
}
