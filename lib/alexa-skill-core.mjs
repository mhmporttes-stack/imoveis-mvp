// Lógica pura da skill "Central Machado" (consulta por voz): autorização,
// roteamento das intenções, frases e conversa de acompanhamento ("quem são?").
// Sem banco, sem rede, sem env: as consultas entram por `deps` (injeção), o
// que permite testar tudo com `node --test`. SOMENTE LEITURA, só contagens e
// primeiros nomes — nunca CPF, renda, valores ou documentos.

export const TOPICS = {
  simulacao: { label: "simulação", singular: "cliente aguardando simulação", plural: "clientes aguardando simulação" },
  documentacao: { label: "documentação", singular: "cliente com documentação pendente", plural: "clientes com documentação pendente" },
  aprovacao: { label: "aprovação", singular: "cliente aguardando aprovação", plural: "clientes aguardando aprovação" }
};

const TOPIC_BY_INTENT = {
  AguardandoSimulacaoIntent: "simulacao",
  AguardandoDocumentacaoIntent: "documentacao",
  AguardandoAprovacaoIntent: "aprovacao"
};

const MAX_NAMES = 5;
const SKILL_NAME = "Central Machado";
const HELP_TEXT = "Você pode pedir o resumo do dia, perguntar quantos clientes aguardam simulação, documentação ou aprovação, ou saber a próxima reunião.";

// --- Autorização -------------------------------------------------------------
export function parseAllowedUserIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Camadas depois da assinatura da Amazon: ID da skill e usuário autorizado.
// O deviceId é só informativo (não é critério de segurança).
export function authorizeSkillRequest(body, { skillId, allowedUserIds }) {
  const applicationId = body?.session?.application?.applicationId || body?.context?.System?.application?.applicationId || "";
  if (!skillId || applicationId !== skillId) return { ok: false, reason: "skill_invalida" };
  const userId = body?.session?.user?.userId || body?.context?.System?.user?.userId || "";
  if (!userId || !allowedUserIds.includes(userId)) return { ok: false, reason: "usuario_nao_autorizado" };
  return { ok: true };
}

// --- Resposta ----------------------------------------------------------------
export function buildSpeechResponse(text, { reprompt = "", end = false, attributes = {} } = {}) {
  const response = { outputSpeech: { type: "PlainText", text }, shouldEndSession: end };
  if (!end && reprompt) response.reprompt = { outputSpeech: { type: "PlainText", text: reprompt } };
  return { version: "1.0", sessionAttributes: attributes, response };
}

function countPhrase(topicKey, count) {
  const topic = TOPICS[topicKey];
  if (count === 0) return `Nenhum cliente ${topicKey === "documentacao" ? "com documentação pendente" : topicKey === "simulacao" ? "aguardando simulação" : "aguardando aprovação"}.`;
  return `${count} ${count === 1 ? topic.singular : topic.plural}.`;
}

export function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function spokenWhen({ dayOffset, hours, minutes, weekdayName }) {
  const time = minutes === 0 ? (hours === 1 ? "1 hora" : `${hours} horas`) : `${hours} e ${String(minutes).padStart(2, "0")}`;
  const day = dayOffset === 0 ? "hoje" : dayOffset === 1 ? "amanhã" : `na ${weekdayName}`;
  return `${day} às ${time}`;
}

// Assunto vindo do slot (valor resolvido ou texto falado) ou da sessão.
export function topicFromText(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("simul")) return "simulacao";
  if (value.includes("document")) return "documentacao";
  if (value.includes("aprova")) return "aprovacao";
  return "";
}

function slotTopic(slot) {
  const resolved = slot?.resolutions?.resolutionsPerAuthority?.find((item) => item.status?.code === "ER_SUCCESS_MATCH")?.values?.[0]?.value?.name;
  return topicFromText(resolved) || topicFromText(slot?.value);
}

// deps: { countByTopic(topic) -> number, namesByTopic(topic, limit) -> {names[], total},
//         nextMeeting() -> {dayOffset,hours,minutes,weekdayName}|null, daySummary() -> string }
export async function handleSkillRequest(body, deps) {
  const request = body?.request || {};
  const attributes = body?.session?.attributes || {};

  if (request.type === "SessionEndedRequest") return { version: "1.0", response: { shouldEndSession: true } };

  if (request.type === "LaunchRequest") {
    return buildSpeechResponse(`${SKILL_NAME}. ${HELP_TEXT}`, { reprompt: "O que você quer saber?" });
  }

  if (request.type !== "IntentRequest") {
    return buildSpeechResponse("Não entendi o pedido.", { end: true });
  }

  const intent = request.intent?.name || "";
  const again = { reprompt: "Posso ajudar com mais alguma coisa?" };

  if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") return buildSpeechResponse("Até logo.", { end: true });
  if (intent === "AMAZON.HelpIntent") return buildSpeechResponse(HELP_TEXT, { reprompt: "O que você quer saber?", attributes });
  if (intent === "AMAZON.NavigateHomeIntent") return buildSpeechResponse(`${SKILL_NAME}. ${HELP_TEXT}`, { reprompt: "O que você quer saber?" });

  if (intent === "ResumoDoDiaIntent") {
    const text = await deps.daySummary();
    return buildSpeechResponse(text, { ...again, attributes: {} });
  }

  if (TOPIC_BY_INTENT[intent]) {
    const topic = TOPIC_BY_INTENT[intent];
    const count = await deps.countByTopic(topic);
    return buildSpeechResponse(countPhrase(topic, count), {
      reprompt: count > 0 ? "Quer saber quem são?" : "Posso ajudar com mais alguma coisa?",
      attributes: { lastTopic: topic, lastCount: count }
    });
  }

  if (intent === "ProximaReuniaoIntent") {
    const meeting = await deps.nextMeeting();
    const text = meeting ? `Sua próxima reunião é ${spokenWhen(meeting)}.` : "Você não tem reuniões marcadas pelos próximos dias.";
    return buildSpeechResponse(text, { ...again, attributes: {} });
  }

  if (intent === "QuemSaoIntent") {
    const topic = slotTopic(request.intent?.slots?.assunto) || attributes.lastTopic || "";
    if (!TOPICS[topic]) {
      return buildSpeechResponse("De qual assunto? Simulação, documentação ou aprovação?", {
        reprompt: "Simulação, documentação ou aprovação?",
        attributes
      });
    }
    const { names, total } = await deps.namesByTopic(topic, MAX_NAMES);
    if (!total) return buildSpeechResponse(countPhrase(topic, 0), { ...again, attributes: { lastTopic: topic, lastCount: 0 } });
    const rest = total - names.length;
    const text = `${joinNames(names)}${rest > 0 ? `, e mais ${rest}` : ""}.`;
    return buildSpeechResponse(text, { ...again, attributes: { lastTopic: topic, lastCount: total } });
  }

  return buildSpeechResponse(`Não entendi. ${HELP_TEXT}`, { reprompt: "O que você quer saber?", attributes });
}
