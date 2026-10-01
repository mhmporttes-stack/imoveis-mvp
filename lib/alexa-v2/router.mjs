import { buildSpeechResponse, handleSkillRequest as handleLegacyRequest } from "../alexa-skill-core.mjs";
import { ETAPAS, ETAPA_IDS, TOPICS, etapaFromText, topicFromText } from "./catalog.mjs";
import { PERIOD_IDS, periodFromText, resolvePeriod } from "./periods.mjs";
import { PAGE_SIZE } from "./text.mjs";
import { sanitizeSpeech } from "./sanitize.mjs";

// ROTEADOR V2: entende a pergunta (intenção + slots + contexto), escolhe o
// assunto no catálogo, pede o dado ao provedor (que lê o cache/snapshot ou uma
// consulta leve — NUNCA cálculo pesado) e monta uma frase curta. As intenções
// V1 continuam atendidas pelo tratador antigo até serem migradas (etapa 4/5).

// Frases da V1 agora usam as mesmas regras e fontes da V2 (números da tela).
const V1_TO_V2 = {
  ResumoDoDiaIntent: { intent: "ResumoIntent", topic: "" },
  ProximaReuniaoIntent: { intent: "ConsultarIntent", topic: "proxima_reuniao" },
  AguardandoSimulacaoIntent: { intent: "ConsultarIntent", topic: "etapa_simulacao" },
  AguardandoDocumentacaoIntent: { intent: "ConsultarIntent", topic: "etapa_documentacao" },
  AguardandoAprovacaoIntent: { intent: "ConsultarIntent", topic: "etapa_aprovacao" }
};

const idSlot = (id) => ({ value: id, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: id } }] }] } });

export const V2_INTENTS = new Set([
  "ConsultarIntent",
  "ListarIntent",
  "ResumoIntent",
  "ContinuaIntent",
  "MaisIntent",
  "AMAZON.NextIntent",
  "AMAZON.RepeatIntent"
]);

const FALLBACK_SPEECH = "Não consegui buscar isso agora. Quer o resumo geral?";
const NOT_AVAILABLE_SPEECH = "Ainda não consigo responder isso por aqui.";
const HISTORY_UNAVAILABLE_SPEECH = "Ainda não tenho esse histórico.";
const DEFAULT_REPROMPT = "Posso ajudar com mais alguma coisa?";
const DEFAULT_TIMEOUT_MS = 5500;

// --- Slots ------------------------------------------------------------------
function resolvedValue(slot) {
  return slot?.resolutions?.resolutionsPerAuthority?.find((item) => item.status?.code === "ER_SUCCESS_MATCH")?.values?.[0]?.value || null;
}

function slotText(slot) {
  return resolvedValue(slot)?.name || slot?.value || "";
}

// Assunto: id canônico do modelo (ex.: "meta_bateram", "etapa_simulacao") ou texto falado.
export function readTopicSlot(slot) {
  const id = resolvedValue(slot)?.id || "";
  if (id.startsWith("etapa_") && ETAPAS[id.slice(6)]) return { topic: "etapa", etapa: id.slice(6) };
  if (TOPICS[id]) return { topic: id, etapa: "" };
  const text = slotText(slot);
  const etapaGuess = /clientes|aguard|em |estao/i.test(String(text)) ? etapaFromText(text) : "";
  const topic = topicFromText(text);
  if (topic) return { topic, etapa: topic === "etapa" ? etapaGuess : "" };
  return { topic: "", etapa: etapaGuess ? etapaGuess : "" };
}

export function readPeriodSlot(slot) {
  const id = resolvedValue(slot)?.id || "";
  if (PERIOD_IDS.includes(id)) return id;
  return periodFromText(slotText(slot));
}

export function readEtapaSlot(slot) {
  const id = resolvedValue(slot)?.id || "";
  if (ETAPAS[id]) return id;
  return etapaFromText(slotText(slot));
}

function readBrokerSlot(slot, deps) {
  const text = slotText(slot);
  if (!text) return null;
  const found = deps.brokers?.match?.(text);
  if (found) return { id: found.id || "", name: found.name };
  return { id: "", name: String(text).replace(/[^\p{L}'-]/gu, "").slice(0, 20), unknown: true };
}

// --- Construção da pergunta ----------------------------------------------------
function spokenPeriods(topic) {
  const labels = { hoje: "hoje", ontem: "ontem", amanha: "amanhã", esta_semana: "esta semana", semana_passada: "a semana passada", este_mes: "este mês", mes_passado: "o mês passado" };
  const list = topic.periods.map((id) => labels[id] || id);
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

const BROKER_REMAP = {
  meta_equipe: "meta_corretor",
  meta_bateram: "meta_corretor",
  meta_faltam: "meta_corretor",
  meta_cada: "meta_corretor",
  meta_lider: "meta_corretor",
  prospeccao_equipe: "prospeccao_corretor",
  prospeccao_ranking: "prospeccao_corretor",
  prospeccao_vs_meta: "prospeccao_corretor",
  sem_prospeccao: "prospeccao_corretor",
  ranking: "pontos",
  melhor_dia: "pontos",
  desempenho: "pontos"
};

export function buildQuery({ intent, slots = {}, ctx = null, deps }) {
  const today = deps.today();
  const fromTopic = readTopicSlot(slots.assunto);
  const periodSlot = readPeriodSlot(slots.periodo);
  const etapaSlot = readEtapaSlot(slots.etapa) || fromTopic.etapa;
  const brokerSlot = readBrokerSlot(slots.corretor, deps);
  // "Quantos clientes em documentação": etapa falada sem assunto.
  const explicitTopic = fromTopic.topic || (etapaSlot && (intent === "ConsultarIntent" || intent === "ListarIntent") ? "etapa" : "");
  const hasCtx = Boolean(ctx?.topic);

  if (intent === "ResumoIntent") {
    const topicId = explicitTopic === "atencao" ? "atencao" : "resumo";
    return { ok: true, q: baseQuery({ topicId, kind: "count", periodId: "hoje", today }) };
  }

  if (intent === "MaisIntent" || intent === "AMAZON.NextIntent") {
    if (!hasCtx || ctx.kind !== "list") return { ok: false, speech: "Não há uma lista para continuar. Pergunte, por exemplo, quem são os clientes de uma etapa." };
    if (!ctx.hasMore) return { ok: false, speech: "Esses eram todos." };
    return { ok: true, q: { ...baseQuery({ topicId: ctx.topic, kind: "list", periodId: ctx.periodo, today, etapa: ctx.etapa, corretor: ctx.corretor }), page: (ctx.page || 0) + 1 } };
  }

  let topicId = explicitTopic;
  let kind = intent === "ListarIntent" ? "list" : "count";
  let periodId = periodSlot;
  let etapa = etapaSlot;
  let corretor = brokerSlot;

  if (intent === "ContinuaIntent") {
    if (!hasCtx) return { ok: false, speech: "Sobre o que você quer saber? Pergunte, por exemplo, quantos corretores bateram a meta." };
    topicId = explicitTopic || ctx.topic;
    kind = ctx.kind || "count";
    if (!periodId) periodId = ctx.periodo;
    if (!etapa) etapa = ctx.etapa;
    if (!corretor) corretor = ctx.corretor || null;
  } else {
    // Consultar/Listar: sem assunto falado, continua o anterior (ex.: "quem são?").
    const topicChanged = Boolean(explicitTopic) && explicitTopic !== ctx?.topic;
    if (!topicId && hasCtx) topicId = ctx.topic;
    if (!topicId) return { ok: false, speech: "Sobre qual assunto? Por exemplo, a meta, o funil, a agenda ou as vendas." };
    if (!topicChanged && hasCtx && topicId === ctx.topic) {
      if (!periodId) periodId = ctx.periodo;
      if (!etapa) etapa = ctx.etapa;
      if (!corretor) corretor = ctx.corretor || null;
    }
    if (topicId === "etapa" && !etapa && hasCtx && ctx.etapa) etapa = ctx.etapa;
  }

  // Corretor falado em assunto de equipe ("e o Eduardo?"): usa o assunto individual.
  if (corretor && !corretor.unknown && topicId && !TOPICS[topicId]?.needsCorretor && BROKER_REMAP[topicId]) topicId = BROKER_REMAP[topicId];

  if (corretor?.unknown && deps.brokers?.match) return { ok: false, speech: `Não encontrei o corretor ${corretor.name}.`, keep: ctx };

  const topic = TOPICS[topicId];
  if (!topic) return { ok: false, speech: "Não entendi o assunto. Pergunte, por exemplo, a meta, o funil ou a agenda." };

  if (!periodId) periodId = topic.defaultPeriod || "hoje";
  if (!topic.periods.includes(periodId)) {
    return { ok: false, speech: `Isso eu só sei para ${spokenPeriods(topic)}.`, keep: { ...(ctx || {}) } };
  }
  if (topic.needsEtapa && !etapa) {
    return { ok: false, speech: "De qual etapa? Simulação, documentação, aprovação, aprovados, reunião, atendimento, venda ou prospecção.", pending: { topic: topicId, kind } };
  }
  if (topic.needsCorretor && !corretor) {
    return { ok: false, speech: "De qual corretor?", pending: { topic: topicId, kind, periodo: periodId } };
  }

  let note = "";
  if (intent !== "ContinuaIntent" && intent !== "ListarIntent" && topic.defaultKind) kind = topic.defaultKind;
  // "Quem bateu a meta?" pede nomes; "quantos bateram?" pede o número.
  if (intent === "ConsultarIntent" && topic.kinds.includes("list") && /^quem /i.test(String(slots.assunto?.value || "").trim())) kind = "list";
  if (!topic.kinds.includes(kind)) {
    note = "Para isso só tenho o número. ";
    kind = "count";
  }

  return { ok: true, q: baseQuery({ topicId, kind, periodId, today, etapa, corretor }), note };
}

function baseQuery({ topicId, kind, periodId, today, etapa = "", corretor = null }) {
  const period = resolvePeriod(periodId, today);
  return {
    topic: topicId,
    kind,
    periodo: period.id,
    periodoSpoken: period.spoken,
    range: { startDate: period.startDate, endDate: period.endDate },
    etapa,
    corretor,
    corretorId: corretor?.id || "",
    corretorName: corretor?.name || "",
    page: 0
  };
}

// --- Execução ----------------------------------------------------------------
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function contextOf(q, extra = {}) {
  return { topic: q.topic, kind: q.kind, periodo: q.periodo, etapa: q.etapa, corretor: q.corretor, page: q.page, ...extra };
}

export async function answerQuery(q, deps, note = "") {
  const topic = TOPICS[q.topic];
  const provider = deps.providers?.[topic.provider];
  if (!provider) return { text: NOT_AVAILABLE_SPEECH, ctx: contextOf(q), failed: true };

  let data;
  try {
    data = await withTimeout(Promise.resolve(provider(q)), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    deps.onProviderError?.(q.topic, error);
    return { text: FALLBACK_SPEECH, ctx: contextOf(q), failed: true };
  }
  if (data == null) return { text: FALLBACK_SPEECH, ctx: contextOf(q), failed: true };
  if (data.unavailable) return { text: HISTORY_UNAVAILABLE_SPEECH, ctx: contextOf(q), failed: true };

  const speak = topic.say[q.kind] || topic.say.count;
  const result = speak(data, q);
  const normalized = typeof result === "string" ? { text: result } : result;
  let text = normalized.text || FALLBACK_SPEECH;
  if (data.staleMinutes) text = `Última atualização há ${data.staleMinutes} minutos. ${text}`;

  const names = normalized.names || [];
  const total = names.length;
  const hasMore = q.kind === "list" && total > (q.page + 1) * PAGE_SIZE;
  return { text: `${note}${text}`, ctx: contextOf(q, { hasMore, total }), hasMore };
}

function respond(text, { ctx = null, reprompt = DEFAULT_REPROMPT, previous = {} } = {}) {
  const safe = sanitizeSpeech(text);
  const attributes = ctx ? { ...previous, v2: { ...ctx, lastSpeech: safe.slice(0, 300) } } : previous;
  return buildSpeechResponse(safe, { reprompt, attributes });
}

// body = envelope da Alexa; deps = { providers, brokers, today(), timeoutMs, onProviderError }
export async function handleSkillRequestV2(body, deps) {
  const request = body?.request || {};
  const intent = request.intent?.name || "";

  if (request.type === "IntentRequest" && V1_TO_V2[intent] && deps.v1ToV2 !== false) {
    const map = V1_TO_V2[intent];
    const slots = map.topic ? { assunto: idSlot(map.topic) } : {};
    return handleSkillRequestV2({ ...body, request: { ...request, intent: { name: map.intent, slots } } }, deps);
  }
  if (request.type !== "IntentRequest" || !V2_INTENTS.has(intent)) return handleLegacyRequest(body, deps.legacyDeps || {});

  const attributes = body?.session?.attributes || {};
  // Continuidade vinda da V1 ("quantos aguardam simulação?" -> "quem são?").
  const v1Etapa = ETAPAS[attributes.lastTopic] ? attributes.lastTopic : "";
  const ctx = attributes.v2 || (v1Etapa ? { topic: "etapa", kind: "count", periodo: "hoje", etapa: v1Etapa, corretor: null, page: 0 } : null);

  if (intent === "AMAZON.RepeatIntent") {
    return respond(ctx?.lastSpeech || "Não tenho nada para repetir.", { ctx, previous: attributes });
  }

  const built = buildQuery({ intent, slots: request.intent?.slots || {}, ctx, deps });
  if (!built.ok) {
    const ctxKeep = built.pending ? { ...(ctx || {}), ...built.pending } : built.keep || ctx;
    return respond(built.speech, { ctx: ctxKeep, previous: attributes, reprompt: built.speech });
  }

  const answered = await answerQuery(built.q, deps, built.note || "");
  return respond(answered.text, {
    ctx: answered.ctx,
    previous: attributes,
    reprompt: answered.hasMore ? "Quer ouvir mais?" : DEFAULT_REPROMPT
  });
}

export { ETAPA_IDS };
