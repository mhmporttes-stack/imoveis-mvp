import "server-only";
import { createHash } from "crypto";
import { SkillRequestSignatureVerifier, TimestampVerifier } from "ask-sdk-express-adapter";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS } from "./client-status";
import { isOwnerAdminEmail } from "./admin-profiles";
import { listCalendarActivities } from "./calendar-activities";
import { buildArrivalSummary, countByStatus } from "./alexa-arrival";
import { firstName, saoPauloDateKey } from "./alexa-config-core.mjs";
import { authorizeSkillRequest, parseAllowedUserIds, buildSpeechResponse } from "./alexa-skill-core.mjs";
import { handleSkillRequestV2, V2_INTENTS } from "./alexa-v2/router.mjs";
import { makeBrokerMatcher } from "./alexa-v2/brokers.mjs";
import { loadBrokerList } from "./crm-metrics/team-goal";
import { getV2Providers } from "./alexa-v2/providers";

// Skill "Central Machado": consulta por voz, SOMENTE LEITURA. Segurança em 3
// camadas: assinatura/horário da Amazon, ID da skill e usuário Alexa autorizado
// (variáveis de ambiente — nada de segredo no banco). Os logs trazem só a
// intenção e o resultado, nunca nomes, números ou o conteúdo falado.

const TOPIC_STATUSES = {
  simulacao: [CLIENT_STATUS.PENDING],
  documentacao: [CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING],
  aprovacao: [CLIENT_STATUS.APPROVAL_PENDING]
};

const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const RESPONSE_BUDGET_MS = 6000; // a Alexa desiste em ~8s

export function getSkillConfig() {
  return {
    enabled: process.env.ALEXA_SKILL_ENABLED === "true",
    skillId: process.env.ALEXA_SKILL_ID || "",
    allowedUserIds: parseAllowedUserIds(process.env.ALEXA_ALLOWED_USER_IDS)
  };
}

// Lança se a chamada não veio da Amazon (assinatura, certificado ou horário).
export async function verifyAmazonRequest(rawBody, headers) {
  await new SkillRequestSignatureVerifier().verify(rawBody, headers);
  await new TimestampVerifier().verify(rawBody);
}

let ownerCache = { id: "", at: 0 };
async function resolveOwner() {
  if (ownerCache.id && Date.now() - ownerCache.at < 5 * 60 * 1000) return ownerCache.id;
  const { data } = await getSupabaseAdminClient().from("admin_users").select("id, email").limit(200);
  const owner = (data || []).find((row) => isOwnerAdminEmail(row.email));
  ownerCache = { id: owner?.id || "", at: Date.now() };
  return ownerCache.id;
}

async function namesByTopic(topic, limit) {
  const { data, count, error } = await getSupabaseAdminClient()
    .from("simulation_registrations")
    .select("full_name", { count: "exact" })
    .in("status", TOPIC_STATUSES[topic])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return { names: (data || []).map((row) => firstName(row.full_name)).filter(Boolean), total: count || 0 };
}

async function nextMeeting() {
  const ownerId = await resolveOwner();
  if (!ownerId) return null;
  const now = new Date();
  const auth = { ok: true, user: { email: "" }, profile: { id: ownerId, role: "admin" } };
  const items = await listCalendarActivities({
    from: now.toISOString(),
    to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    auth,
    pendingOnly: true
  });
  const next = items.find((item) => new Date(item.scheduledActivityAt) >= now);
  if (!next) return null;
  const at = new Date(next.scheduledActivityAt);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const todayKey = saoPauloDateKey(now);
  const tomorrowKey = saoPauloDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const key = saoPauloDateKey(at);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    dayOffset: key === todayKey ? 0 : key === tomorrowKey ? 1 : 2,
    hours: Number(get("hour")),
    minutes: Number(get("minute")),
    weekdayName: WEEKDAY_NAMES[weekday] || ""
  };
}

const deps = {
  countByTopic: (topic) => countByStatus(TOPIC_STATUSES[topic]),
  namesByTopic,
  nextMeeting,
  daySummary: async () => buildArrivalSummary(await resolveOwner())
};

// Log seguro de falha de provedor: só o assunto e o tipo do erro.
function logProviderError(topic, error) {
  console.warn(`[alexa-skill] provedor falhou (assunto=${topic}): ${error?.message === "timeout" ? "timeout" : error?.name || "erro"}.`);
}

// Executa a consulta com limite de tempo (a Alexa corta em ~8s).
export async function answerSkillRequest(body) {
  const guard = authorizeSkillRequest(body, getSkillConfig());
  if (!guard.ok) {
    // Só o motivo e uma impressão digital curta (hash) do usuário, para comparar sem expor o ID.
    const fingerprint = createHash("sha256").update(String(body?.session?.user?.userId || "")).digest("hex").slice(0, 10);
    console.warn(`[alexa-skill] acesso negado: ${guard.reason} (usuario=${fingerprint}).`);
    return { denied: true, payload: buildSpeechResponse("Não tenho permissão para isso.", { end: true }) };
  }
  const intent = body?.request?.intent?.name || body?.request?.type || "?";
  try {
    const brokers = V2_INTENTS.has(intent) ? makeBrokerMatcher(await loadBrokerList().catch(() => [])) : null;
    const payload = await Promise.race([
      handleSkillRequestV2(body, { legacyDeps: deps, providers: getV2Providers(), brokers, today: () => saoPauloDateKey(), onProviderError: logProviderError }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), RESPONSE_BUDGET_MS))
    ]);
    console.info(`[alexa-skill] ${intent}: ok.`);
    return { denied: false, payload };
  } catch (error) {
    console.warn(`[alexa-skill] ${intent}: erro (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}).`);
    return {
      denied: false,
      payload: buildSpeechResponse("Não consegui buscar essa informação agora. Tente de novo em instantes.", { reprompt: "Posso ajudar com mais alguma coisa?" })
    };
  }
}
