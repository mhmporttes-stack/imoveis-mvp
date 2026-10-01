import { NOT_UNDERSTOOD, buildSpeechResponse, handleSkillRequest as handleLegacyRequest } from "../alexa-skill-core.mjs";
import { ETAPAS, ETAPA_IDS, TOPICS, etapaFromText, topicFromText } from "./catalog.mjs";
import { PERIOD_IDS, addDays, isDatePeriod, nextWeekday, parseDateSlot, periodFromText, resolvePeriod } from "./periods.mjs";
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
  "CorretorIntent",
  "AgendaIntent",
  "AgendaDataIntent",
  "DiaSeguinteIntent",
  "DiaAnteriorIntent",
  "PrimeiraIntent",
  "UltimaIntent",
  "CompararIntent",
  "ContinuaIntent",
  "MaisIntent",
  "AMAZON.NextIntent",
  "AMAZON.RepeatIntent"
]);

const FALLBACK_SPEECH = "Não consegui buscar isso agora.";
const NOT_AVAILABLE_SPEECH = NOT_UNDERSTOOD;
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
  if (!slot) return null;
  const id = resolvedValue(slot)?.id || "";
  const byId = id ? deps.brokers?.byId?.(id) : null;
  if (byId) return { id: byId.id || "", name: byId.name, gender: byId.gender || "" };
  const text = slotText(slot);
  if (!text) return null;
  const found = deps.brokers?.match?.(text);
  if (found) return { id: found.id || "", name: found.name, gender: found.gender || "" };
  return { id: "", name: String(text).replace(/[^\p{L}'-]/gu, "").slice(0, 20), unknown: true };
}

// --- Construção da pergunta ----------------------------------------------------
function spokenPeriods(topic) {
  const labels = { hoje: "hoje", ontem: "ontem", amanha: "amanhã", esta_semana: "esta semana", semana_passada: "a semana passada", este_mes: "este mês", mes_passado: "o mês passado" };
  const list = topic.periods.filter((id) => id !== "data").map((id) => labels[id] || id);
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

// Corretor falado em assunto de EQUIPE ("e o Eduardo?", "vendas da Izabela"): usa o assunto
// individual equivalente (mesma fonte, nível corretor).
const BROKER_REMAP = {
  meta_equipe: "meta_corretor",
  meta_bateram: "meta_bateu",
  meta_faltam: "meta_corretor",
  meta_cada: "meta_corretor",
  meta_lider: "meta_corretor",
  prospeccao_equipe: "med_prospeccoes",
  prospeccao_ranking: "med_prospeccoes",
  prospeccao_vs_meta: "prospeccao_faltam",
  prospeccao_corretor: "med_prospeccoes",
  sem_prospeccao: "med_prospeccoes",
  vendas: "med_vendas",
  aprovacoes: "med_aprovados",
  clientes_novos: "med_clientes_novos",
  ranking: "posicao_ranking",
  melhor_dia: "posicao_ranking",
  desempenho: "corretor_resumo"
};

// Assuntos que perguntam sobre o TIME inteiro: não herdam o corretor da conversa.
const NO_INHERIT = new Set(["meta_bateram", "meta_faltam", "meta_cada", "meta_lider", "prospeccao_ranking", "sem_prospeccao", "ranking", "melhor_dia"]);

// Assuntos que a comparação entre corretores entende.
const COMPARE_METRICS = new Set([...Object.keys(TOPICS).filter((id) => id.startsWith("med_")), "meta_corretor", "posicao_ranking", "pontos", "prospeccao_faltam"]);

const TEAM_WORDS = /\b(equipe|time)\b/i;

// Dia da semana falado ("sexta", "próxima sexta", "segunda que vem") -> AAAA-MM-DD de Brasília.
function weekdayFromSlot(slot, today) {
  const id = resolvedValue(slot)?.id || "";
  const match = /^([0-6])(_proxima)?$/.exec(id);
  if (match) return nextWeekday(Number(match[1]), today, { strict: Boolean(match[2]) });
  return parseDateSlot(slotText(slot), today);
}

export function buildQuery({ intent, slots = {}, ctx = null, deps }) {
  const today = deps.today();
  const fromTopic = readTopicSlot(slots.assunto);
  const periodSlot = readPeriodSlot(slots.periodo);
  const etapaSlot = readEtapaSlot(slots.etapa) || fromTopic.etapa;
  const brokerSlot = readBrokerSlot(slots.corretor, deps);
  const broker2Slot = readBrokerSlot(slots.outro_corretor, deps);
  const spokenTopic = String(slots.assunto?.value || "");
  const spokenTeam = TEAM_WORDS.test(spokenTopic);
  const BROKER_INTENTS = ["ConsultarIntent", "ListarIntent", "CorretorIntent", "CompararIntent"];
  // "Quantos clientes em documentação": etapa falada sem assunto.
  const explicitTopic = fromTopic.topic || (etapaSlot && (intent === "ConsultarIntent" || intent === "ListarIntent") ? "etapa" : "");
  const hasCtx = Boolean(ctx?.topic);

  if (intent === "ResumoIntent") {
    const topicId = explicitTopic === "atencao" ? "atencao" : explicitTopic === "equipe_resumo" ? "equipe_resumo" : "resumo";
    return { ok: true, q: baseQuery({ topicId, kind: "count", periodId: "hoje", today }) };
  }

  if (intent === "MaisIntent" || intent === "AMAZON.NextIntent") {
    // "E depois?" logo após "qual é a primeira?": as atividades seguintes.
    if (hasCtx && ctx.topic === "minha_agenda" && ctx.kind === "first") return { ok: true, q: baseQuery({ topicId: "minha_agenda", kind: "rest", periodId: ctx.periodo, today }) };
    if (hasCtx && ctx.topic === "minha_agenda" && ctx.kind === "last") return { ok: false, speech: "Essa é a última atividade.", keep: ctx };
    if (!hasCtx || (ctx.kind !== "list" && ctx.kind !== "rest")) return { ok: false, speech: NOT_UNDERSTOOD };
    if (!ctx.hasMore) return { ok: false, speech: "Esses eram todos." };
    return { ok: true, q: { ...baseQuery({ topicId: ctx.topic, kind: ctx.kind === "rest" ? "rest" : "list", periodId: ctx.periodo, today, etapa: ctx.etapa, corretor: ctx.corretor }), page: (ctx.page || 0) + 1 } };
  }

  // --- Minha agenda (atividades do usuário vinculado) ------------------------------
  // Dia específico (dia 8 de outubro, sexta-feira, dia 15) e navegação "no dia seguinte / anterior".
  let datePeriod = "";
  if (intent === "AgendaIntent" || intent === "AgendaDataIntent") {
    const spokenDate = String(slots.data?.value || "").trim();
    const weekdaySlot = slots.dia_semana;
    if (spokenDate || (weekdaySlot && (resolvedValue(weekdaySlot) || weekdaySlot.value))) {
      const parsed = spokenDate ? parseDateSlot(spokenDate, today) : weekdayFromSlot(weekdaySlot, today);
      if (!parsed) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
      datePeriod = `d:${parsed}`;
    }
  } else if (intent === "DiaSeguinteIntent" || intent === "DiaAnteriorIntent") {
    if (!(hasCtx && ctx.topic === "minha_agenda")) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    const base = resolvePeriod(ctx.periodo, today).startDate;
    datePeriod = `d:${addDays(base, intent === "DiaSeguinteIntent" ? 1 : -1)}`;
  }
  if (datePeriod) return { ok: true, q: baseQuery({ topicId: "minha_agenda", kind: "list", periodId: datePeriod, today }) };

  if (intent === "AgendaIntent" || intent === "AgendaDataIntent" || intent === "PrimeiraIntent" || intent === "UltimaIntent") {
    const sameTopic = hasCtx && ctx.topic === "minha_agenda";
    const kind = intent === "PrimeiraIntent" ? "first" : intent === "UltimaIntent" ? "last" : "list";
    if (kind !== "list" && !sameTopic) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    const periodId = periodSlot || (sameTopic ? ctx.periodo : "") || "hoje";
    const topic = TOPICS.minha_agenda;
    if (!topic.periods.includes(isDatePeriod(periodId) ? "data" : periodId)) return { ok: false, speech: `Isso eu só sei para ${spokenPeriods(topic)}.`, keep: ctx };
    return { ok: true, q: baseQuery({ topicId: "minha_agenda", kind, periodId, today }) };
  }

  // --- Comparação entre dois corretores -------------------------------------------
  if (intent === "CompararIntent") {
    let first = brokerSlot;
    let second = broker2Slot;
    if (first && !second && ctx?.corretor && first.id !== ctx.corretor.id) {
      second = first;
      first = ctx.corretor;
    }
    if (!first || !second) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    for (const item of [first, second]) {
      if (item.unknown) return { ok: false, speech: `Não encontrei o corretor ${item.name}.`, keep: ctx };
    }
    const asked = BROKER_REMAP[explicitTopic] || explicitTopic;
    const metric = COMPARE_METRICS.has(asked) ? asked : "corretor_resumo";
    const periodId = periodSlot || (hasCtx ? ctx.periodo : "") || "hoje";
    const topic = TOPICS.comparar;
    if (!topic.periods.includes(periodId)) return { ok: false, speech: `Isso eu só sei para ${spokenPeriods(topic)}.`, keep: ctx };
    const q = baseQuery({ topicId: "comparar", kind: "count", periodId, today, corretor: first });
    return { ok: true, q: { ...q, corretor2: second, metric } };
  }

  let topicId = explicitTopic;
  let kind = intent === "ListarIntent" ? "list" : "count";
  let periodId = periodSlot;
  let etapa = etapaSlot;
  let corretor = brokerSlot;

  if (intent === "CorretorIntent") {
    topicId = explicitTopic || "corretor_resumo";
    if (!corretor && hasCtx && ctx.corretor) corretor = ctx.corretor;
    if (!periodId && hasCtx && ctx.corretor && corretor?.id === ctx.corretor?.id) periodId = ctx.periodo;
  } else if (intent === "ContinuaIntent") {
    if (!hasCtx) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    // Sem nenhuma informação nova (assunto, período, corretor ou etapa) não há o que completar.
    if (!explicitTopic && !periodId && !corretor && !etapa) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    const changed = Boolean(explicitTopic) && explicitTopic !== ctx.topic;
    topicId = explicitTopic || ctx.topic;
    const wanted = ctx.kind === "rest" ? "list" : ctx.kind || "count";
    // Assunto novo: só herda o formato (lista/número) se o novo assunto suporta; senão pergunta de número.
    kind = changed ? (TOPICS[topicId]?.kinds.includes(wanted) ? wanted : "count") : wanted;
    if (changed && TOPICS[topicId]?.defaultKind && wanted !== "list") kind = TOPICS[topicId].defaultKind;
    if (!periodId) periodId = ctx.periodo;
    if (!etapa) etapa = ctx.etapa;
    if (!corretor) corretor = ctx.corretor || null;
  } else {
    // Consultar/Listar: sem assunto falado, continua o anterior (ex.: "quem são?").
    const topicChanged = Boolean(explicitTopic) && explicitTopic !== ctx?.topic;
    if (!topicId && hasCtx) topicId = ctx.topic;
    if (!topicId) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
    if (!topicChanged && hasCtx && topicId === ctx.topic) {
      if (!periodId) periodId = ctx.periodo;
      if (!etapa) etapa = ctx.etapa;
      // "Quem fez mais simulações?" (assunto falado, lista) é pergunta do TIME: não herda o corretor.
      const teamRanking = kind === "list" && explicitTopic && !["etapa", "agenda", "proxima_reuniao"].includes(topicId);
      if (!corretor && !teamRanking) corretor = ctx.corretor || null;
    }
    if (topicId === "etapa" && !etapa && hasCtx && ctx.etapa) etapa = ctx.etapa;
  }

  // Período da conversa vale também ao trocar de assunto/corretor ("e a Bruna?" mantém "ontem").
  if (!periodId && hasCtx && ctx.periodo && BROKER_INTENTS.includes(intent) && (ctx.corretor || corretor)) periodId = ctx.periodo;

  // Corretor da conversa em assunto pessoal ("quantas simulações?", "e vendas?"): herda; assunto do time não.
  if (!corretor && hasCtx && ctx.corretor && !spokenTeam && kind !== "list" && topicId) {
    const def = TOPICS[topicId];
    const personal = def?.needsCorretor || def?.corretorContext || (BROKER_REMAP[topicId] && !NO_INHERIT.has(topicId));
    if (personal) corretor = ctx.corretor;
  }

  if (corretor?.unknown && deps.brokers?.match) return { ok: false, speech: `Não encontrei o corretor ${corretor.name}.`, keep: ctx };

  if (corretor && !corretor.unknown && topicId && BROKER_REMAP[topicId] && !TOPICS[topicId]?.corretorContext && !TOPICS[topicId]?.needsCorretor) {
    topicId = BROKER_REMAP[topicId];
    kind = "count";
  }

  const topic = TOPICS[topicId];
  if (!topic) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };
  // A agenda pessoal é do dono; "e a Bruna?" sobre ela não tem fonte segura.
  if (topicId === "minha_agenda" && corretor) return { ok: false, speech: NOT_UNDERSTOOD, keep: ctx };

  if (!periodId) periodId = topic.defaultPeriod || "hoje";
  // Período só herdado da conversa (não falado agora) que este assunto não tem: usa o padrão dele.
  if (!periodSlot && !topic.periods.includes(isDatePeriod(periodId) ? "data" : periodId)) periodId = topic.periods.includes("hoje") ? "hoje" : topic.periods[0];
  if (!topic.periods.includes(isDatePeriod(periodId) ? "data" : periodId)) {
    return { ok: false, speech: `Isso eu só sei para ${spokenPeriods(topic)}.`, keep: { ...(ctx || {}) } };
  }
  if (topic.needsEtapa && !etapa) {
    return { ok: false, speech: NOT_UNDERSTOOD, pending: { topic: topicId, kind } };
  }
  if (topic.needsCorretor && !corretor) {
    return { ok: false, speech: NOT_UNDERSTOOD, pending: { topic: topicId, kind, periodo: periodId } };
  }

  let note = "";
  if (intent !== "ContinuaIntent" && intent !== "ListarIntent" && topic.defaultKind) kind = topic.defaultKind;
  // "Quem bateu a meta?" pede nomes; "quantos bateram?" pede o número.
  if (intent === "ConsultarIntent" && topic.kinds.includes("list") && /^(quem|qual corretor|quais corretores)\b/i.test(spokenTopic.trim())) kind = "list";
  // Corretor específico com assunto de lista: o que importa é o número dele.
  if (corretor && kind === "list" && !["agenda", "etapa", "proxima_reuniao"].includes(topicId)) kind = "count";
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
    corretor2: null,
    metric: "",
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

// Contexto estruturado: assunto/métrica (topic), formato (kind), período/data (periodo), corretor, etapa e domínio.
// Ele só COMPLETA o que a próxima pergunta não disser; informação explícita nova sempre vence.
function contextOf(q, extra = {}) {
  const domain = q.topic === "minha_agenda" ? "agenda" : q.corretor ? "corretor" : "equipe";
  return { topic: q.topic, kind: q.kind, periodo: q.periodo, etapa: q.etapa, corretor: q.corretor, page: q.page, domain, ...extra };
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
  const hasMore = (q.kind === "list" || q.kind === "rest") && total > (q.page + 1) * PAGE_SIZE;
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
    return respond(built.speech, { ctx: ctxKeep, previous: attributes, reprompt: built.speech === NOT_UNDERSTOOD ? "" : built.speech });
  }

  const answered = await answerQuery(built.q, deps, built.note || "");
  return respond(answered.text, {
    ctx: answered.ctx,
    previous: attributes,
    reprompt: answered.hasMore ? "Quer ouvir mais?" : DEFAULT_REPROMPT
  });
}

export { ETAPA_IDS };
