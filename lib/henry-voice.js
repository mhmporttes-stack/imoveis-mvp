import "server-only";
import { after } from "next/server";
import { getSupabaseAdminClient } from "./supabase";
import { recordAiUsage } from "./ai-usage";
import { decideDeviceClaim } from "./henry-voice-conversation.mjs";
import { getPainelInicio } from "./painel-inicio";
import { getPainelInicioDono } from "./painel-inicio-dono";
import { listMyCooledDecisions } from "./cooled-clients";
import { getWhatsappSessionHealth } from "./whatsapp-session-health";
import { loadBrokerList } from "./crm-metrics/team-goal";
import { getV2Providers } from "./alexa-v2/providers";
import { makeBrokerMatcher } from "./alexa-v2/brokers.mjs";
import { answerQuery, buildQuery } from "./alexa-v2/router.mjs";
import { TOPIC_IDS } from "./alexa-v2/catalog.mjs";
import { ETAPA_IDS } from "./alexa-v2/catalog-etapas.mjs";
import { PERIOD_IDS } from "./alexa-v2/periods.mjs";
import { sanitizeSpeech } from "./alexa-v2/sanitize.mjs";
import { firstName, saoPauloDateKey } from "./alexa-config-core.mjs";
import {
  HENRY_NAV_KEYS,
  HENRY_NAV_TARGETS,
  HENRY_OWNER_SPOKEN_NAME,
  HENRY_FALLBACK_REPLY,
  HENRY_SETTING_ID,
  buildHenryVisionNote,
  buildComplimentPrompt,
  henryEnabledFromSetting,
  henryVisionFromSetting,
  henryWebSearchFromSetting,
  parseComplimentReply,
  rememberCompliment,
  composeHenryDailyReport,
  createHenryReadCache,
  estimateHenryModelCostUsd,
  estimateHenryTtsCostUsd,
  resolveHenryNavigation,
  safeHenryReply,
  sanitizeHistory
} from "./henry-voice-core.mjs";
import { buildHenryStylePrompt, buildHenryTtsInstructions, henryAddressName, henrySampleText, mergeHenryStyle, resolveHenryStyle } from "./henry-voice-style.mjs";
import {
  ELEVENLABS_API,
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_STT_MODEL,
  buildElevenLabsSpeechRequest,
  buildElevenLabsTranscriptionRequest,
  estimateElevenLabsSttCostUsd,
  parseElevenLabsTranscript,
  chooseHenryVoiceProvider,
  describeElevenLabsError,
  parseElevenLabsSubscription,
  estimateElevenLabsCostUsd,
  henryProviderChain,
  parseElevenLabsVoices,
  pronounceForSpeech,
  resolveElevenLabsVoiceId
} from "./henry-voice-providers.mjs";
import { HENRY_BROKER_METRIC_IDS, HENRY_PERIOD_IDS, buildHenryBrokerReport, buildHenryPeriodReport, henryPeriodFromText, henryReportKind, previousHenryPeriod, resolveHenryPeriod } from "./henry-reports-core.mjs";
import { findHenryClientsByName, loadHenryBrokerCards, loadHenryLeadOrigins, loadHenryOverview, loadHenryTeamGoal, searchHenryClients } from "./henry-reports";
import { decideClientOpen, isAcceptance, offeredToOpen } from "./henry-navigation-core.mjs";
import { HENRY_WAIT_PHRASES, brokerWithArticle, henryProgressFor, narrationVoiceKey } from "./henry-voice-narration.mjs";
import {
  HENRY_GOODBYES,
  HENRY_REPORT_INTROS,
  HENRY_VARIATION_HINTS,
  HENRY_WEB_SEARCH_USD,
  buildHenryDynamicPrompt,
  buildHenrySystemBlocks,
  buildReportRewritePrompt,
  collectWebSources,
  henryWebSearchTool,
  looksLikeWebQuery,
  openingsFrom,
  pickVariant,
  rememberVariant,
  reportNumbersMatch,
  samplingFor,
  sourcesDetail,
  stripUrls,
  webSearchesFrom
} from "./henry-voice-persona.mjs";
import {
  HENRY_DAY_MEMORY_SETTING_ID,
  HENRY_NOTES_SETTING_ID,
  MEMORY_REPLIES,
  addNote,
  appendDayTurns,
  dayTurns,
  modelHistoryFromDay,
  notesFrom,
  parseMemoryCommand,
  removeNotes
} from "./henry-memory-core.mjs";

// Assistente de voz "Henry" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md HENRY-1). SOMENTE LEITURA: o modelo da
// Anthropic só tem ferramentas que LEEM o CRM pelas fontes que já existem (catálogo da Alexa V2, tela Início, caixinha
// de clientes esfriados, saúde dos WhatsApps) e uma ferramenta que devolve uma tela da lista fechada para o navegador
// abrir. Nenhuma ação de escrita. Logs só com motivo (nunca a fala); áudio nunca é gravado.

const ANTHROPIC_VERSION = "2023-06-01";
const HENRY_MODEL = process.env.ANTHROPIC_HENRY_MODEL || "claude-haiku-5-5";
const MAX_TOOL_ROUNDS = 4;
const MODEL_TIMEOUT_MS = 15000;
const TOOL_TIMEOUT_MS = 6000;
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "ash";
const OWNER_SUMMARY_TIMEOUT_MS = 9000;
const COMPLIMENT_TIMEOUT_MS = 3500; // elogio da webcam demorou → o relatório sai sem ele (HENRY-2)
const REPORT_REWRITE_TIMEOUT_MS = 4000; // relatório do dia no jeito de amigo; passou disso → reserva sem modelo
const MAX_REPLY_TOKENS = 300; // resposta falada = 1 a 3 frases curtas (≤ 700 caracteres)
const MAX_REPORT_TOKENS = 700; // só no modo relatório (3 a 5 frases; o detalhe vai para a tela, não para a voz)
const REPORT_TIMEOUT_MS = 25000; // período longo calculado na hora (ex.: 90 dias) pode levar mais que as ferramentas curtas
const DATA_CACHE_MS = 45000; // números do relatório e das ferramentas: cache curto, só nesta instância do servidor
const HENRY_COMPLIMENTS_SETTING_ID = "henry_voice_compliments";
// Voz, tom, velocidade e como tratar o dono: tela "Voz e personalidade" (henry_voice_assistant.style). Sem nada salvo, a
// instrução da voz é a de antes (buildHenryTtsInstructions com o padrão) e a voz é a do env.
const resolveStyle = (stored) => resolveHenryStyle(stored, { defaultVoice: TTS_VOICE });

// --- Velocidade (dono, 2026-10-22: "ele fica pensando por muito tempo") ----------------------------------------------
// Gravações que não mudam a resposta (custo em ai_usage_log, memória do elogio) rodam DEPOIS da resposta (after do Next;
// na Vercel o waitUntil segura a função até terminar). recordAiUsage nunca lança; writeSettingRow já vem com .catch.
function background(promise) {
  try {
    after(() => promise);
  } catch {
    // fora de uma requisição (scripts locais): a promessa segue sozinha
  }
}

// Cache curto (DATA_CACHE_MS) dos números lidos (relatório e ferramentas), por conta — regra em createHenryReadCache
// (henry-voice-core.mjs). Os números são os mesmos da tela, no máximo ~45 s mais velhos.
const dataCache = createHenryReadCache({ ttlMs: DATA_CACHE_MS });
const cachedRead = (key, loader) => dataCache.read(key, loader);

// --- Liga/desliga (crm_settings): Henry nasce LIGADO; a visão (webcam) nasce DESLIGADA ---------------------------------
async function readSettingRow(id) {
  const { data, error } = await getSupabaseAdminClient().from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.setting_value || {};
}

async function writeSettingRow(auth, id, value) {
  const { error } = await getSupabaseAdminClient()
    .from("crm_settings")
    .upsert({ id, setting_value: value, updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Um aparelho por vez: registro curto em crm_settings (id do navegador + hora). Sem id (versão antiga) → sempre liberado.
const HENRY_DEVICE_SETTING_ID = "henry_active_device";
export async function claimHenryDevice(auth, deviceId) {
  if (!deviceId) return true;
  const current = await readSettingRow(HENRY_DEVICE_SETTING_ID).catch(() => null);
  const decision = decideDeviceClaim({ current, deviceId });
  if (decision.allowed && decision.next) await writeSettingRow(auth, HENRY_DEVICE_SETTING_ID, decision.next).catch(() => {});
  return decision.allowed;
}

// --- Memória do dia e lembretes (henry-memory-core.mjs) -----------------------------------------------------------------
// Memória do dia (REGRA OFICIAL, dono 2026-10-22): só o TEXTO das trocas de hoje (São Paulo), em crm_settings; zera na
// virada do dia. Gravada DEPOIS da resposta (background), nunca atrasa a fala. Lembretes: longo prazo, até 30.
export async function readHenryDayTurns() {
  const stored = await readSettingRow(HENRY_DAY_MEMORY_SETTING_ID).catch(() => null);
  return dayTurns(stored, saoPauloDateKey());
}

function rememberExchange(auth, question, reply) {
  if (!question && !reply) return;
  background(
    (async () => {
      const stored = await readSettingRow(HENRY_DAY_MEMORY_SETTING_ID).catch(() => null);
      const turns = [question ? { role: "user", text: question } : null, reply ? { role: "assistant", text: reply } : null].filter(Boolean);
      await writeSettingRow(auth, HENRY_DAY_MEMORY_SETTING_ID, appendDayTurns(stored, saoPauloDateKey(), turns));
    })().catch((error) => console.warn(`[henry] memória do dia não gravada (${error?.name || "erro"}).`))
  );
}

async function readNotes() {
  return notesFrom(await readSettingRow(HENRY_NOTES_SETTING_ID).catch(() => null));
}

const recentPicks = { intro: [], memory: [], hint: [] };
function pick(kind, bank) {
  const choice = pickVariant(bank, recentPicks[kind] || []);
  recentPicks[kind] = rememberVariant(recentPicks[kind] || [], choice);
  return choice;
}

// "lembre que…", "esquece…", "esquece a conversa de hoje": resolvidos aqui, sem o modelo (única escrita do Henry, sobre
// ele mesmo). Devolve null quando não é comando de memória.
async function runMemoryCommand(auth, text) {
  const command = parseMemoryCommand(text);
  if (!command) return null;
  if (command.kind === "forget_today") {
    await writeSettingRow(auth, HENRY_DAY_MEMORY_SETTING_ID, { date: saoPauloDateKey(), turns: [] });
    console.info("[henry] memória do dia apagada a pedido do dono.");
    return { reply: pick("memory", MEMORY_REPLIES.forgetToday), navigate: null, detail: null, memoryCleared: true };
  }
  const stored = await readSettingRow(HENRY_NOTES_SETTING_ID).catch(() => ({}));
  if (command.kind === "remember") {
    const result = addNote(stored, command.note);
    if (!result.ok) return { reply: result.reason === "sensitive" ? MEMORY_REPLIES.rememberSensitive[0] : "Não entendi o que anotar. Fala de novo?", navigate: null, detail: null };
    await writeSettingRow(auth, HENRY_NOTES_SETTING_ID, { items: result.items });
    console.info(`[henry] lembrete anotado (${result.items.length} no total).`);
    return { reply: pick("memory", MEMORY_REPLIES.remember), navigate: null, detail: { title: "Lembretes do Henry", subtitle: `${result.items.length} anotados`, sections: [{ title: "Lembretes", rows: result.items.slice(-10).reverse().map((item) => ({ label: item.text, value: "" })) }] } };
  }
  const result = removeNotes(stored, command.term);
  if (!result.removed) return { reply: pick("memory", MEMORY_REPLIES.forgetNone), navigate: null, detail: null };
  await writeSettingRow(auth, HENRY_NOTES_SETTING_ID, { items: result.items });
  console.info(`[henry] ${result.removed} lembrete(s) apagado(s).`);
  return { reply: pick("memory", MEMORY_REPLIES.forget), navigate: null, detail: null };
}

export async function readHenrySettings() {
  const value = await readSettingRow(HENRY_SETTING_ID);
  return { enabled: henryEnabledFromSetting(value), vision: henryVisionFromSetting(value), webSearch: henryWebSearchFromSetting(value), mobileWake: value.mobileWake === true, style: resolveStyle(value.style) };
}

// patch = { enabled?, vision?, mobileWake? } (booleanos) e style? (já validado por parseHenryStylePatch); o resto do registro
// é preservado. mobileWake = "Ouvir 'Henry' com o app aberto" no celular (nasce desligado: lá o padrão é tocar para falar).
export async function setHenrySettings(auth, patch = {}) {
  const current = await readSettingRow(HENRY_SETTING_ID);
  const next = { ...current };
  if (typeof patch.enabled === "boolean") next.disabled = !patch.enabled;
  if (typeof patch.vision === "boolean") next.vision = patch.vision;
  if (typeof patch.mobileWake === "boolean") next.mobileWake = patch.mobileWake;
  if (typeof patch.webSearch === "boolean") next.webSearch = patch.webSearch;
  if (patch.style) next.style = mergeHenryStyle(current.style, patch.style);
  await writeSettingRow(auth, HENRY_SETTING_ID, next);
  return { enabled: henryEnabledFromSetting(next), vision: henryVisionFromSetting(next), webSearch: henryWebSearchFromSetting(next), mobileWake: next.mobileWake === true, style: resolveStyle(next.style) };
}

// Estilo da amostra: o salvo com as escolhas ainda não salvas da tela por cima (patch validado).
export function previewHenryStyle(saved, patch = {}) {
  return resolveStyle(mergeHenryStyle(saved, patch));
}

export function henryDefaultVoice() {
  return TTS_VOICE;
}

export function isHenryVoiceConfigured() {
  return henryVoiceProvider() !== "browser";
}

// --- Voz: ElevenLabs → OpenAI → navegador (decisão do dono, 2026-10-22) ------------------------------------------------
const providerEnv = () => ({ elevenLabsKey: process.env.ELEVENLABS_API_KEY, openAiKey: process.env.OPENAI_API_KEY });
const ELEVENLABS_MODEL = () => process.env.ELEVENLABS_MODEL || ELEVENLABS_DEFAULT_MODEL;

export function henryVoiceProvider() {
  return chooseHenryVoiceProvider(providerEnv());
}

// Vozes da conta ElevenLabs (GET /v2/voices), em cache por 10 min nesta instância do servidor. Sem chave → [].
const VOICES_CACHE_MS = 10 * 60 * 1000;
let voicesCache = { at: 0, list: null };

export async function listElevenLabsVoices({ fresh = false } = {}) {
  const token = process.env.ELEVENLABS_API_KEY;
  if (!token) return [];
  if (!fresh && voicesCache.list && Date.now() - voicesCache.at < VOICES_CACHE_MS) return voicesCache.list;
  const response = await fetch(`${ELEVENLABS_API}/v2/voices?page_size=100&sort=name&sort_direction=asc`, {
    headers: { "xi-api-key": token },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Object.assign(new Error(describeElevenLabsError(response.status, "voices")), { status: response.status });
  const list = parseElevenLabsVoices(await response.json().catch(() => ({})));
  voicesCache = { at: Date.now(), list };
  return list;
}

// Saldo de caracteres do plano (GET /v1/user/subscription, permissão "Usuário"). Sem chave → null.
export async function readElevenLabsSubscription() {
  const token = process.env.ELEVENLABS_API_KEY;
  if (!token) return null;
  const response = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, { headers: { "xi-api-key": token }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Object.assign(new Error(describeElevenLabsError(response.status, "user")), { status: response.status });
  return parseElevenLabsSubscription(await response.json().catch(() => ({})));
}

async function elevenLabsVoiceFor(style) {
  const chosen = style?.elevenVoice;
  if (chosen) return chosen;
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID;
  if (envVoiceId) return resolveElevenLabsVoiceId({ envVoiceId });
  return resolveElevenLabsVoiceId({ voices: await listElevenLabsVoices() });
}

async function speakWithElevenLabs(text, style, context) {
  const model = ELEVENLABS_MODEL();
  const voiceId = await elevenLabsVoiceFor(style);
  const { url, body } = buildElevenLabsSpeechRequest({ text, voiceId, modelId: model, style, previousText: context.previousText, nextText: context.nextText });
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) throw Object.assign(new Error(describeElevenLabsError(response.status, "tts")), { status: response.status });
  return { buffer: Buffer.from(await response.arrayBuffer()), model, costUsd: estimateElevenLabsCostUsd(text, model) };
}

async function speakWithOpenAi(text, style) {
  const resolved = resolveStyle(style);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: resolved.voice, input: pronounceForSpeech(text), instructions: buildHenryTtsInstructions(resolved), response_format: "mp3" }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), model: TTS_MODEL, costUsd: estimateHenryTtsCostUsd(text) };
}

// --- Relatório do dia (mesma fonte e mesma frase da tela Início) ------------------------------------------------------
// Dono: resumo ampliado do Início (INI-5, getPainelInicioDono — o mesmo que a Alexa fala); se falhar ou demorar, a frase
// do assistente do Início (getPainelInicio). As duas leituras correm JUNTAS (getPainelInicioDono só usa o Início no fim,
// e aceita a promessa) e ficam no cache curto; warmHenryReport pré-aquece ao ligar/abrir o Henry e ao ouvir "Henry".
function loadReportSources(auth) {
  return cachedRead(`report:${auth?.profile?.id || ""}`, async () => {
    const inicioPromise = getPainelInicio(auth);
    inicioPromise.catch(() => {}); // o erro do Início sobe no await abaixo; isto só evita o aviso de rejeição sem dono
    const owner = await withTimeout(getPainelInicioDono(auth, inicioPromise), OWNER_SUMMARY_TIMEOUT_MS).catch((error) => {
      console.warn(`[henry] resumo do dono indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}); usando o do Início.`);
      return null;
    });
    return { inicio: await inicioPromise, ownerText: owner?.text || "" };
  });
}

// Pré-aquecimento: números do relatório + lista de corretores (usada para entender "e da Carol?") no cache curto.
export async function warmHenryReport(auth) {
  await Promise.all([loadReportSources(auth), cachedRead("brokers", () => loadBrokerList()).catch(() => [])]);
}

async function buildDailyReport(auth) {
  const { inicio, ownerText } = await loadReportSources(auth);
  return composeHenryDailyReport(inicio, { ownerText });
}

// --- Visão: elogio do "bom dia" (HENRY-2) ----------------------------------------------------------------------------
// A imagem só passa pela memória desta função; NUNCA é gravada nem logada. Guarda-se só o TEXTO dos últimos elogios
// (crm_settings henry_voice_compliments) para variar. Qualquer falha → "" (segue sem elogio, sem erro falado).
async function buildCompliment(auth, image, style) {
  if (!image) return "";
  const usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const memory = await readSettingRow(HENRY_COMPLIMENTS_SETTING_ID).catch(() => ({}));
    const recent = Array.isArray(memory.recent) ? memory.recent : [];
    const data = await callAnthropic({
      system: buildComplimentPrompt(recent, { address: henryAddressName(style) }),
      max_tokens: 120,
      messages: [{ role: "user", content: [imageBlock(image), { type: "text", text: "Elogio de hoje." }] }]
    });
    usage.inputTokens = Number(data.usage?.input_tokens) || 0;
    usage.outputTokens = Number(data.usage?.output_tokens) || 0;
    const text = parseComplimentReply((data.content || []).filter((block) => block.type === "text").map((block) => block.text).join(" "));
    background(recordAiUsage({ feature: "henry_voice_vision", model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage) }));
    if (text) background(writeSettingRow(auth, HENRY_COMPLIMENTS_SETTING_ID, { recent: rememberCompliment(recent, text) }).catch(() => {}));
    console.info(`[henry] elogio: ${text ? "ok" : "pulado"}.`);
    return text;
  } catch (error) {
    console.warn(`[henry] elogio falhou (${error?.name === "TimeoutError" ? "timeout" : "erro"}); segue sem elogio.`);
    background(recordAiUsage({ feature: "henry_voice_vision", model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, success: false, errorMessage: "elogio falhou" }));
    return "";
  }
}

function imageBlock(image) {
  return { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } };
}

// --- Ferramentas (somente leitura) ------------------------------------------------------------------------------------
const TOOLS = [
  {
    name: "consultar_crm",
    description:
      "Consulta um número ou lista do CRM pelo mesmo catálogo da Alexa (Meta Diária, prospecção, online, funil, clientes por etapa, " +
      "agenda/reuniões, clientes sem atendimento, pendências, fila da roleta, clientes novos, vendas, aprovações, conversão, desempenho, " +
      "ranking, pontos, resumo e métricas por corretor). Devolve uma frase pronta com os números da tela.",
    input_schema: {
      type: "object",
      properties: {
        assunto: { type: "string", enum: TOPIC_IDS, description: "Assunto do catálogo. 'etapa' exige o campo etapa; assuntos de um corretor exigem corretor." },
        periodo: { type: "string", enum: PERIOD_IDS, description: "Período; padrão hoje." },
        formato: { type: "string", enum: ["numero", "lista"], description: "numero = quantidade; lista = nomes." },
        etapa: { type: "string", enum: ETAPA_IDS },
        corretor: { type: "string", description: "Nome do corretor como foi falado." },
        outro_corretor: { type: "string", description: "Segundo corretor, só para o assunto 'comparar'." }
      },
      required: ["assunto"]
    }
  },
  {
    name: "relatorio_do_dia",
    description: "Resumo do dia da tela Início do dono: leads de hoje, clientes aguardando resposta (e quem espera há mais tempo), simulações a conferir, atividades atrasadas e clientes aguardando documentos.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "clientes_esfriados_pendentes",
    description: "Quantos casos de clientes que esfriaram aguardam a decisão do dono (caixinha 'Clientes esfriados' do cabeçalho).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "whatsapp_dos_corretores",
    description: "Situação dos WhatsApps (números pessoais) dos corretores: quantos conectados e quais estão desconectados ou com problema.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "relatorio_periodo",
    description:
      "Relatório de um PERÍODO (semanal, mensal, últimos 7/15/30/90 dias, semana/mês passado, intervalo de datas): leads por origem, " +
      "funil (atendimento, simulação, documentação, aprovação, venda), ranking e pontos por corretor, Meta Diária da equipe, clientes " +
      "aguardando resposta e esfriados agora, e comparação com o período anterior. Use para qualquer pergunta de período além de hoje/ontem " +
      "ou quando ele pedir relatório semanal/mensal. Devolve os números e uma sugestão de fala; o detalhe completo aparece sozinho na tela.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["semanal", "mensal", "periodo"], description: "semanal = últimos 7 dias; mensal = últimos 30 dias (se ele não disser outro período)." },
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      }
    }
  },
  {
    name: "consultar_corretor",
    description:
      "Números de UM corretor num período (atendimentos, simulações, documentação, aprovados, vendas, pontos, posição no ranking, Meta Diária). " +
      "Use para 'como foi a Carol no mês?', 'quantos pontos o Eduardo fez nos últimos 30 dias?'.",
    input_schema: {
      type: "object",
      properties: {
        corretor: { type: "string", description: "Nome do corretor como foi falado." },
        metrica: { type: "string", enum: HENRY_BROKER_METRIC_IDS, description: "SÓ o indicador perguntado (ex.: 'quantos atendeu?' = atendimentos). Omita apenas quando ele pedir resumo/detalhes do corretor." },
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "Período dito (hoje, ontem, este_mes...). Padrão: este_mes." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      },
      required: ["corretor"]
    }
  },
  {
    name: "buscar_cliente",
    description:
      "Procura um cliente pelo nome e mostra etapa, responsável, último contato e próxima atividade. Nunca devolve CPF nem documento. " +
      "Telefone só aparece na tela, e só se ele pedir o telefone (incluir_telefone).",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome (ou parte) do cliente." },
        incluir_telefone: { type: "boolean", description: "Só true quando ele pedir o telefone." }
      },
      required: ["nome"]
    }
  },
  {
    name: "abrir_cliente",
    description:
      "Abre a ficha (card) de UM cliente na lista de Clientes, achando pelo nome. Use quando ele pedir para abrir/mostrar um cliente. " +
      "Se vierem várias opções, pergunte qual (primeiro nome, etapa e responsável) e chame de novo com o nome mais completo.",
    input_schema: {
      type: "object",
      properties: { nome: { type: "string", description: "Nome (ou parte) do cliente." } },
      required: ["nome"]
    }
  },
  {
    name: "abrir_tela",
    description: "Abre uma tela do CRM no computador do dono. Use quando ele pedir para abrir, mostrar ou ir para uma tela.",
    input_schema: {
      type: "object",
      properties: { destino: { type: "string", enum: HENRY_NAV_KEYS, description: HENRY_NAV_KEYS.map((key) => `${key} = ${HENRY_NAV_TARGETS[key].label}`).join("; ") } },
      required: ["destino"]
    }
  }
];

const idSlot = (id) => ({ value: id, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: id } }] }] } });

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); })]).finally(() => clearTimeout(timer));
}

async function brokerMatcher(context) {
  context.brokers ||= makeBrokerMatcher(await cachedRead("brokers", () => loadBrokerList()).catch(() => []));
  return context.brokers;
}

// Cena do Henry: "procurando o corretor" (foto + primeiro nome, a mesma photo_url do painel) e, quando achou, o cardzinho
// com 1 ou 2 números. Só primeiro nome e foto; nada de telefone/e-mail.
async function brokerCard(match) {
  const cards = await cachedRead("broker-cards", () => loadHenryBrokerCards()).catch(() => new Map());
  const card = cards.get(match.id);
  return { event: { id: match.id, firstName: firstName(match.name), photoUrl: card?.photoUrl || "" }, gender: match.gender || card?.gender || "" };
}

async function announceBroker(context, toolName, input, spokenName, { found = false, stats = [], position = null } = {}) {
  const brokers = await brokerMatcher(context);
  const match = spokenName ? brokers.match(String(spokenName).slice(0, 60)) : null;
  if (!match) return null;
  const { event, gender } = await brokerCard(match);
  if (!found) context.emit({ ...henryProgressFor(toolName, input, { name: match.name, gender }), broker: event });
  else context.emit({ progress: "corretor_achado", topic: "corretor", label: `Achei ${brokerWithArticle(match.name, gender)}.`, broker: { ...event, stats, ...(Number.isInteger(position) && position > 0 ? { position } : {}) } });
  return match;
}

// Reaproveita o roteador da Alexa V2 (buildQuery + answerQuery): mesmos provedores, mesmas frases, mesmos números.
async function consultCatalog(input, context) {
  const assunto = TOPIC_IDS.includes(input?.assunto) ? input.assunto : "";
  if (!assunto) return "Assunto desconhecido.";
  await brokerMatcher(context);
  const deps = {
    providers: getV2Providers(),
    brokers: context.brokers,
    today: () => saoPauloDateKey(),
    timeoutMs: TOOL_TIMEOUT_MS,
    onProviderError: (topic, error) => {
      context.providerFailed = true; // a frase de "não consegui" não fica no cache (runTool)
      console.warn(`[henry] provedor falhou (assunto=${topic}): ${error?.message === "timeout" ? "timeout" : error?.name || "erro"}.`);
    }
  };
  const slots = { assunto: idSlot(assunto) };
  if (PERIOD_IDS.includes(input.periodo)) slots.periodo = idSlot(input.periodo);
  if (ETAPA_IDS.includes(input.etapa)) slots.etapa = idSlot(input.etapa);
  if (input.corretor) slots.corretor = { value: String(input.corretor).slice(0, 60) };
  if (input.outro_corretor) slots.outro_corretor = { value: String(input.outro_corretor).slice(0, 60) };
  const intent = assunto === "minha_agenda" ? "AgendaIntent" : assunto === "comparar" ? "CompararIntent" : input.formato === "lista" ? "ListarIntent" : "ConsultarIntent";
  const built = buildQuery({ intent, slots, ctx: null, deps });
  if (!built.ok) return sanitizeSpeech(built.speech || "Não entendi.");
  const answered = await answerQuery(built.q, deps, built.note || "");
  return sanitizeSpeech(answered.text);
}

// --- Períodos longos, relatório semanal/mensal, corretor e cliente (dono, 2026-10-22) ------------------------------------
// Período pedido: o do modelo; sem período, o que foi dito na pergunta ("últimos 30 dias"); sem nada, o padrão.
function periodInput(input, context, fallback) {
  if (HENRY_PERIOD_IDS.includes(input?.periodo)) return { periodo: input.periodo, inicio: input.inicio, fim: input.fim };
  return henryPeriodFromText(context.question, saoPauloDateKey()) || fallback;
}

// Leitura que pode falhar sozinha: vira "indisponível" na resposta (nunca um zero falso), com o motivo no log.
function softRead(label, promise) {
  return withTimeout(promise, REPORT_TIMEOUT_MS).catch((error) => {
    console.warn(`[henry] ${label} indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}).`);
    return null;
  });
}

const periodKey = (auth, range) => `${auth?.profile?.id || ""}:${range.startDate}_${range.endDate}`;
const readOverviewFor = (auth, range) => cachedRead(`overview:${periodKey(auth, range)}`, () => loadHenryOverview(auth, range));
const readTeamGoalFor = (auth, range) => cachedRead(`teamgoal:${periodKey(auth, range)}`, () => loadHenryTeamGoal(auth, range));
const readLeadsFor = (auth, range) => cachedRead(`leads:${periodKey(auth, range)}`, () => loadHenryLeadOrigins(auth, range));

async function runPeriodReport(input, auth, context) {
  const tipo = input?.tipo;
  const fallback = { periodo: tipo === "mensal" ? "ultimos_30_dias" : "ultimos_7_dias" };
  const range = resolveHenryPeriod(periodInput(input, context, fallback), saoPauloDateKey());
  const previousRange = previousHenryPeriod(range);
  const [overview, teamGoal, leads, previousOverview, previousLeads, sources, cooled] = await Promise.all([
    softRead("desempenho do período", readOverviewFor(auth, range)),
    softRead("meta do período", readTeamGoalFor(auth, range)),
    softRead("leads do período", readLeadsFor(auth, range)),
    softRead("desempenho anterior", readOverviewFor(auth, previousRange)),
    softRead("leads anteriores", readLeadsFor(auth, previousRange)),
    softRead("início", loadReportSources(auth)),
    softRead("esfriados", cachedRead(`cooled:${auth?.profile?.id || ""}`, () => listMyCooledDecisions(auth)))
  ]);
  if (!overview && !teamGoal && !leads) return "Não consegui buscar os números desse período agora.";
  const report = buildHenryPeriodReport({
    kind: henryReportKind(input, range),
    range,
    previousRange,
    overview,
    previousOverview,
    teamGoal,
    leads,
    previousLeads,
    awaitingReply: Number.isFinite(sources?.inicio?.awaitingReply) ? sources.inicio.awaitingReply : null,
    cooledPending: Array.isArray(cooled?.items) ? cooled.items.length : null
  });
  context.detail = report.detail;
  context.reportMode = true;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

async function runBrokerReport(input, auth, context) {
  const spoken = String(input?.corretor || "").slice(0, 60);
  const match = await announceBroker(context, "consultar_corretor", input, spoken);
  if (!match) return `Não achei o corretor "${spoken}". Corretores: ${(await brokerMatcher(context)).names.join(", ")}.`;
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "este_mes" }), saoPauloDateKey());
  const [overview, teamGoal] = await Promise.all([softRead("desempenho do corretor", readOverviewFor(auth, range)), softRead("meta do corretor", readTeamGoalFor(auth, range))]);
  if (!overview && !teamGoal) return "Não consegui buscar os números desse corretor agora.";
  const report = buildHenryBrokerReport({ broker: { id: match.id, name: match.name }, range, overview, teamGoal, metric: String(input?.metrica || "") });
  await announceBroker(context, "consultar_corretor", input, spoken, { found: true, stats: report.stats, position: report.position || null });
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

async function runClientSearch(input, auth, context) {
  const name = String(input?.nome || "").slice(0, 60);
  const withPhone = input?.incluir_telefone === true;
  const result = await withTimeout(cachedRead(`client:${auth?.profile?.id || ""}:${name.toLowerCase()}:${withPhone ? 1 : 0}`, () => searchHenryClients(auth, name, { withPhone })), TOOL_TIMEOUT_MS);
  context.detail = result.detail;
  return JSON.stringify({ sugestao_de_fala: result.spoken, resultado: result.facts });
}

// Ferramentas de leitura com o mesmo pedido em até ~45 s → mesma resposta do cache (só respostas boas entram).
async function runTool(name, input, auth, context) {
  try {
    if (name === "relatorio_periodo") return await runPeriodReport(input || {}, auth, context);
    if (name === "consultar_corretor") return await runBrokerReport(input || {}, auth, context);
    if (name === "buscar_cliente") return await runClientSearch(input || {}, auth, context);
    if (name === "consultar_crm") {
      const query = input || {};
      const named = [query.corretor, query.outro_corretor].filter(Boolean);
      for (const spoken of named) await announceBroker(context, name, query, spoken).catch(() => null);
      const key = `tool:${auth?.profile?.id || ""}:${JSON.stringify(query)}`;
      const text = await cachedRead(key, () => consultCatalog(query, context));
      if (context.providerFailed) dataCache.delete(key);
      for (const spoken of named) await announceBroker(context, name, query, spoken, { found: true }).catch(() => null);
      return text;
    }
    if (name === "relatorio_do_dia") {
      const report = await withTimeout(buildDailyReport(auth), OWNER_SUMMARY_TIMEOUT_MS + 3000);
      return report || "Relatório indisponível agora.";
    }
    if (name === "clientes_esfriados_pendentes") {
      const { items } = await cachedRead(`cooled:${auth?.profile?.id || ""}`, () => withTimeout(listMyCooledDecisions(auth), TOOL_TIMEOUT_MS));
      return JSON.stringify({ aguardando_sua_decisao: (items || []).length });
    }
    if (name === "whatsapp_dos_corretores") {
      const { rows } = await cachedRead(`whatsapp:${auth?.profile?.id || ""}`, () => withTimeout(getWhatsappSessionHealth(auth), TOOL_TIMEOUT_MS));
      const list = rows || [];
      const problems = list.filter((row) => row.status !== "connected").map((row) => `${firstName(row.brokerName)} (${row.slotName}: ${row.status === "disconnected" ? "desconectado" : row.status})`);
      return JSON.stringify({ numeros: list.length, conectados: list.length - problems.length, com_problema: problems.slice(0, 12) });
    }
    if (name === "abrir_cliente") {
      const spoken = String(input?.nome || "").slice(0, 60);
      const matches = await withTimeout(cachedRead(`open-client:${auth?.profile?.id || ""}:${spoken.toLowerCase()}`, () => findHenryClientsByName(auth, spoken)), TOOL_TIMEOUT_MS);
      const decision = decideClientOpen(matches, spoken);
      if (decision.kind === "open") {
        context.navigate = decision.navigate;
        return `Ficha de ${decision.navigate.label.replace(/^ficha de /, "")} será aberta.`;
      }
      if (decision.kind === "ask") return JSON.stringify({ varios_clientes: decision.options, instrucao: "Pergunte qual deles, em uma frase curta." });
      return decision.reply;
    }
    if (name === "abrir_tela") {
      const target = resolveHenryNavigation(input?.destino);
      if (!target) return "Essa tela não está na lista que posso abrir.";
      context.navigate = target;
      return `Tela ${target.label} será aberta.`;
    }
    return "Ferramenta desconhecida.";
  } catch (error) {
    console.warn(`[henry] ferramenta ${name} falhou: ${error?.message === "timeout" ? "timeout" : error?.name || "erro"}.`);
    return "Não consegui buscar essa informação agora.";
  }
}

// Chamada única à Anthropic (fetch direto, sem SDK). O corpo pode levar a imagem da webcam: nunca é logado.
async function callAnthropic(payload) {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) throw Object.assign(new Error("Assistente de voz não configurado (ANTHROPIC_API_KEY)."), { status: 503 });
  const fastControls = /haiku-5/.test(HENRY_MODEL) ? { thinking: { type: "disabled" }, output_config: { effort: "low" } } : {};
  // Variação de redação: temperature 0,9 só em modelo que aceita (Haiku 5.5 manda omitir; ver samplingFor).
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": token, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: HENRY_MODEL, ...samplingFor(HENRY_MODEL), ...payload, ...fastControls }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Falha na IA (HTTP ${response.status}).`);
  return data;
}

// Sistema = parte FIXA com cache de prompt (identidade, jeito, conhecimento de base, barreiras, ferramentas) + parte
// VARIÁVEL (data/hora de Brasília, estilo da tela, visão, lembretes, memória do dia, aberturas já usadas, dica sorteada).
// vision = visão ligada na configuração; withImage = veio quadro da câmera. webSearch = pesquisa na internet ligada.
function callModel(messages, { withImage = false, vision = false, style, reportMode = false, webSearch = false, notes = [], daySummary = "", usedOpenings = [], hint = "" } = {}) {
  const dynamic = buildHenryDynamicPrompt({
    todayKey: saoPauloDateKey(),
    stylePrompt: buildHenryStylePrompt(style),
    visionNote: buildHenryVisionNote({ vision, withImage }),
    notes: notes.map((note) => note.text),
    daySummary,
    usedOpenings,
    hint,
    webSearch
  });
  return callAnthropic({
    max_tokens: reportMode ? MAX_REPORT_TOKENS : MAX_REPLY_TOKENS,
    system: buildHenrySystemBlocks(dynamic),
    tools: webSearch ? [...TOOLS, henryWebSearchTool()] : TOOLS,
    messages
  });
}

const sumUsage = (usage, data) => {
  usage.inputTokens += Number(data.usage?.input_tokens) || 0;
  usage.outputTokens += Number(data.usage?.output_tokens) || 0;
  usage.cacheWriteTokens += Number(data.usage?.cache_creation_input_tokens) || 0;
  usage.cacheReadTokens += Number(data.usage?.cache_read_input_tokens) || 0;
  usage.webSearches += webSearchesFrom(data.usage);
};

function logModelUsage(auth, feature, usage, extra = {}) {
  const { webSearches, cacheWriteTokens, cacheReadTokens, ...tokens } = usage;
  background(recordAiUsage({ feature, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...tokens, cacheCreationTokens: cacheWriteTokens, cacheReadTokens, costUsd: estimateHenryModelCostUsd(usage), ...extra }));
  // Pesquisa na internet: uma linha por busca (US$ 0,01 cada) em "Gastos de IA", origem henry_web_search.
  for (let index = 0; index < webSearches; index += 1) {
    background(recordAiUsage({ feature: "henry_web_search", model: "web_search_20250305", triggeredBy: auth.profile?.id, costUsd: HENRY_WEB_SEARCH_USD }));
  }
}

// Relatório do dia no jeito de amigo (dono, 2026-10-22): o modelo REESCREVE o texto dos dados; todo número do texto
// gerado precisa existir nos dados (reportNumbersMatch) e a fala passa pela barreira. Falhou → null (reserva sem modelo).
async function rewriteDailyReport(auth, factual, { address, usedOpenings }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
  try {
    const data = await withTimeout(
      callAnthropic({
        max_tokens: 400,
        system: buildReportRewritePrompt({ address, usedOpenings, hint: pick("hint", HENRY_VARIATION_HINTS) }),
        messages: [{ role: "user", content: factual }]
      }),
      REPORT_REWRITE_TIMEOUT_MS
    );
    sumUsage(usage, data);
    logModelUsage(auth, "henry_voice_assistant", usage);
    const text = (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
    if (!text || !reportNumbersMatch(factual, text)) {
      console.warn("[henry] relatório reescrito recusado (número fora dos dados ou vazio); usando a reserva.");
      return null;
    }
    const safe = safeHenryReply(text);
    return safe === HENRY_FALLBACK_REPLY ? null : safe;
  } catch (error) {
    console.warn(`[henry] relatório reescrito indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}); usando a reserva.`);
    if (usage.inputTokens) logModelUsage(auth, "henry_voice_assistant", usage);
    return null;
  }
}

// mode "report" = "bom dia, Henry" sem pergunta → relatório do dia (com a visão ligada e imagem, elogio antes), no jeito de
// amigo: o modelo reescreve o texto dos dados com trava de números; falhou → reserva com abertura sorteada.
// mode "question" = pergunta livre (com imagem quando a pergunta tem intenção visual e a visão está ligada).
// image = { mediaType, data } validada por parseHenryImage; só vive nesta chamada. style = readHenrySettings().style.
// webSearch = pesquisa na internet ligada (readHenrySettings().webSearch).
// onProgress(evento) = narração/cena do stream: { progress, topic, label, broker? } a cada ferramenta chamada (nunca lança).
// Devolve { reply (falado), navigate, detail (tela: relatório/corretor/cliente/fontes em lista; null nas respostas curtas),
// memoryCleared? }. A troca vai para a memória do dia DEPOIS da resposta (background).
export async function answerHenry(auth, { mode = "question", question = "", history = [], image = null, style = null, vision = false, webSearch = false, onProgress = null } = {}) {
  const address = henryAddressName(style);
  if (mode === "report") {
    // Elogio com prazo curto: se a visão demorar, o relatório sai sem ele (a chamada termina sozinha e registra o custo).
    const compliment = image ? withTimeout(buildCompliment(auth, image, style), COMPLIMENT_TIMEOUT_MS).catch(() => {
      console.warn("[henry] elogio passou do prazo; relatório sem elogio.");
      return "";
    }) : "";
    const [complimentText, { inicio, ownerText }, memoryTurns] = await Promise.all([compliment, loadReportSources(auth), readHenryDayTurns()]);
    // A barreira da fala troca a frase INTEIRA quando algo é sensível: tenta com elogio, sem elogio e, por fim, só o Início
    // (o elogio ou uma "atenção" nunca derrubam o relatório).
    const attempts = [{ ownerText, compliment: complimentText, address }, { ownerText, address }, { address }];
    let factual = "";
    let chosen = null;
    for (const options of attempts) {
      const text = composeHenryDailyReport(inicio, options);
      if (text && safeHenryReply(text) !== HENRY_FALLBACK_REPLY) {
        factual = safeHenryReply(text);
        chosen = options;
        break;
      }
    }
    if (!factual) return { reply: `Olá, ${address || HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`, navigate: null, detail: null };
    const rewritten = await rewriteDailyReport(auth, factual, { address, usedOpenings: openingsFrom(memoryTurns) });
    const fallback = safeHenryReply(composeHenryDailyReport(inicio, { ...chosen, intro: pick("intro", HENRY_REPORT_INTROS) }));
    const reply = rewritten || (fallback !== HENRY_FALLBACK_REPLY ? fallback : factual);
    console.info(`[henry] relatório do dia: ok (${rewritten ? "modelo" : "reserva"})${chosen?.compliment ? " (com elogio)" : ""}.`);
    // Na tela, os números exatos (a fala pode arredondar).
    const sentences = factual.split(/(?<=[.!?])\s+/).slice(1).filter((sentence) => sentence && sentence !== chosen?.compliment);
    const detail = sentences.length ? { title: "Relatório do dia", subtitle: "Números exatos de agora", sections: [{ title: "Hoje", rows: sentences.map((sentence) => ({ label: sentence, value: "" })) }] } : null;
    rememberExchange(auth, String(question || "").trim() || "Bom dia, Henry", reply);
    return { reply, navigate: null, detail };
  }

  const text = String(question || "").trim();
  const emit = (event) => {
    if (!event || typeof onProgress !== "function") return;
    try {
      onProgress(event);
    } catch {
      // o stream fechou (o dono interrompeu): segue sem a cena
    }
  };
  // Lembretes e "esquece a conversa de hoje": sem o modelo.
  const command = await runMemoryCommand(auth, text);
  if (command) {
    if (!command.memoryCleared) rememberExchange(auth, text, command.reply);
    return command;
  }
  const [memoryTurns, notes] = await Promise.all([readHenryDayTurns(), readNotes()]);
  const day = modelHistoryFromDay(memoryTurns);
  // Memória do dia (servidor) manda; sem nada guardado, a conversa que a página mandou.
  const previous = memoryTurns.length ? sanitizeHistory(day.history) : sanitizeHistory(history);
  const context = { navigate: null, brokers: null, detail: null, reportMode: false, question: text, emit };
  const messages = [
    ...previous.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: image ? [imageBlock(image), { type: "text", text }] : text }
  ];
  if (webSearch && looksLikeWebQuery(text)) emit({ progress: "internet", topic: "internet", label: "Pesquisando na internet…" });
  const feature = image ? "henry_voice_vision" : "henry_voice_assistant";
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
  // "Quer que eu abra?" → "sim/abre/pode": aceite da sugestão vira a ação, sem perguntar de novo.
  const lastAssistant = [...previous].reverse().find((turn) => turn.role === "assistant")?.text || "";
  const accepted = isAcceptance(text) && offeredToOpen(lastAssistant);
  const hint = accepted ? "ele ACEITOU abrir o que você ofereceu: use abrir_tela ou abrir_cliente agora, sem perguntar de novo, e confirme em poucas palavras" : pick("hint", HENRY_VARIATION_HINTS);
  const promptExtras = { notes, daySummary: day.summary, usedOpenings: openingsFrom(memoryTurns), hint, webSearch };
  const allBlocks = [];
  let replyText = "";
  let rounds = 0;
  try {
    for (; rounds <= MAX_TOOL_ROUNDS; rounds += 1) {
      const data = await callModel(messages, { withImage: Boolean(image), vision: vision || Boolean(image), style, reportMode: context.reportMode, ...promptExtras });
      sumUsage(usage, data);
      const blocks = data.content || [];
      allBlocks.push(...blocks);
      replyText = blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
      // Pesquisa longa: a API pausa o turno; devolve a mensagem do assistente como veio e continua.
      if (data.stop_reason === "pause_turn" && rounds < MAX_TOOL_ROUNDS) {
        messages.push({ role: "assistant", content: blocks });
        continue;
      }
      const toolUses = blocks.filter((block) => block.type === "tool_use");
      if (data.stop_reason !== "tool_use" || !toolUses.length || rounds === MAX_TOOL_ROUNDS) break;
      messages.push({ role: "assistant", content: blocks });
      // Narração e cena: um evento por ferramenta. Corretor (consultar_corretor ou consultar_crm com nome) é anunciado lá
      // dentro, depois de reconhecido (precisa da foto e do primeiro nome certos).
      for (const block of toolUses) {
        if (block.name === "consultar_corretor" || (block.name === "consultar_crm" && block.input?.corretor)) continue;
        emit(henryProgressFor(block.name, block.input || {}));
      }
      const results = await Promise.all(toolUses.map(async (block) => ({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input, auth, context) })));
      messages.push({ role: "user", content: results });
    }
    logModelUsage(auth, feature, usage);
  } catch (error) {
    logModelUsage(auth, feature, usage, { success: false, errorMessage: error?.message });
    throw error;
  }
  // Fontes da pesquisa: só na tela (a voz nunca lê links).
  const sources = sourcesDetail(collectWebSources(allBlocks));
  let detail = context.detail;
  if (sources) detail = detail ? { ...detail, sections: [...detail.sections, ...sources.sections] } : sources;
  console.info(`[henry] pergunta: ok (rodadas=${rounds + 1}${context.navigate ? ", abriu tela" : ""}${usage.webSearches ? `, ${usage.webSearches} busca(s) na internet` : ""}).`);
  const fallback = context.navigate ? `Abrindo ${context.navigate.label}.` : detail ? "Pronto, os detalhes estão na tela." : "Não consegui responder agora.";
  const reply = safeHenryReply(stripUrls(replyText) || fallback);
  rememberExchange(auth, text, reply);
  return { reply, navigate: context.navigate, detail };
}

// Voz do servidor: ElevenLabs (endpoint de streaming) → OpenAI → null (o navegador fala com a melhor voz pt-BR dele).
// style = voz/tom/velocidade da tela; context = { previousText, nextText } quando a fala vai em partes (continuidade).
// Cada tentativa (ok ou falha) vai para ai_usage_log (henry_voice_tts, model = id do modelo do provedor).
// context.primaryOnly = só o 1º provedor da ordem (frases de espera: nunca numa voz diferente da resposta; falhou → sem som).
export async function synthesizeHenrySpeech(auth, text, style = null, context = {}) {
  if (!text) return null;
  const chain = henryProviderChain(providerEnv());
  for (const provider of context.primaryOnly ? chain.slice(0, 1) : chain) {
    const model = provider === "elevenlabs" ? ELEVENLABS_MODEL() : TTS_MODEL;
    try {
      const result = provider === "elevenlabs" ? await speakWithElevenLabs(text, style, context) : await speakWithOpenAi(text, style);
      background(recordAiUsage({ feature: "henry_voice_tts", model: result.model, triggeredBy: auth.profile?.id, costUsd: result.costUsd }));
      return { base64: result.buffer.toString("base64"), contentType: "audio/mpeg", provider };
    } catch (error) {
      console.warn(`[henry] voz ${provider} falhou (${error?.name === "TimeoutError" ? "timeout" : error?.message || "erro"}); tentando a próxima.`);
      context.onError?.(provider, error);
      background(recordAiUsage({ feature: "henry_voice_tts", model, triggeredBy: auth.profile?.id, success: false, errorMessage: `${provider}: ${error?.message || "erro"}` }));
    }
  }
  return null;
}

// --- Frases de espera na voz do Henry (narração, dono 2026-10-22: "remova os silêncios") ---------------------------------
// Conjunto FIXO (HENRY_WAIT_PHRASES) sintetizado UMA vez por voz+estilo e guardado aqui por 6 h (o navegador guarda na
// sessão): não é uma chamada de voz por frase de espera. Só o provedor principal (a mesma voz da resposta); sem voz do
// servidor → lista vazia e o Henry fica em silêncio enquanto pensa (nunca a voz do navegador). Custo em ai_usage_log
// (henry_voice_tts), como toda fala.
const NARRATION_CACHE_MS = 6 * 60 * 60 * 1000;
const NARRATION_PARTIAL_CACHE_MS = 10 * 60 * 1000;
const narrationCache = new Map();
const shortSpeechCache = new Map();

function rememberBounded(map, key, value, max) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

export function henryNarrationVoiceKey(style) {
  const provider = henryVoiceProvider();
  return provider === "browser" ? "" : narrationVoiceKey(style, provider);
}

export async function getHenryNarration(auth, style) {
  const voiceKey = henryNarrationVoiceKey(style);
  if (!voiceKey) return { voiceKey: "", phrases: [] };
  const hit = narrationCache.get(voiceKey);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const promise = (async () => {
    const phrases = [];
    // Frases de espera + despedidas (fim da conversa), todas na voz do Henry.
    const bundle = [...HENRY_WAIT_PHRASES, ...HENRY_GOODBYES.map((text, index) => ({ id: `g${index + 1}`, text, topics: ["bye"] }))];
    // Duas por vez: não estoura o limite de pedidos simultâneos do plano da ElevenLabs.
    for (let index = 0; index < bundle.length; index += 2) {
      const batch = bundle.slice(index, index + 2);
      const audios = await Promise.all(batch.map((phrase) => synthesizeHenrySpeech(auth, phrase.text, style, { primaryOnly: true }).catch(() => null)));
      batch.forEach((phrase, position) => {
        const audio = audios[position];
        if (audio) phrases.push({ id: phrase.id, text: phrase.text, topics: phrase.topics, audio: { base64: audio.base64, contentType: audio.contentType } });
      });
    }
    return { voiceKey, phrases };
  })();
  const entry = { at: Date.now(), ttl: NARRATION_CACHE_MS, promise };
  rememberBounded(narrationCache, voiceKey, entry, 6);
  promise.then(
    (result) => {
      if (result.phrases.length < HENRY_WAIT_PHRASES.length + HENRY_GOODBYES.length) entry.ttl = NARRATION_PARTIAL_CACHE_MS;
    },
    () => narrationCache.delete(voiceKey)
  );
  return promise;
}

// Frase curta com o nome do corretor ("Consultando a Carol."): sintetizada na hora, guardada por voz+texto.
export async function synthesizeHenryShort(auth, text, style) {
  const voiceKey = henryNarrationVoiceKey(style);
  if (!voiceKey || !text) return null;
  const key = `${voiceKey}|${text}`;
  const hit = shortSpeechCache.get(key);
  if (hit && Date.now() - hit.at < NARRATION_CACHE_MS) return hit.promise;
  const promise = synthesizeHenrySpeech(auth, text, style, { primaryOnly: true }).catch(() => null);
  rememberBounded(shortSpeechCache, key, { at: Date.now(), promise }, 60);
  promise.then((audio) => {
    if (!audio) shortSpeechCache.delete(key);
  });
  return promise;
}

// "Ouvir amostra" da tela: frase curta fixa com a voz/tom/velocidade escolhidos. Mesma chamada paga (custo em
// ai_usage_log, origem henry_voice_tts); sem chave da OpenAI → null e a tela fala com a voz do navegador.
// voiceError = motivo claro da falha da voz do servidor (ex.: chave sem permissão), mostrado na tela.
export async function synthesizeHenrySample(auth, style) {
  const text = safeHenryReply(henrySampleText(style));
  const errors = [];
  const audio = await synthesizeHenrySpeech(auth, text, style, { onError: (provider, error) => errors.push(provider === "elevenlabs" ? error?.message : `OpenAI: ${error?.message || "erro"}`) });
  return { text, audio, voiceError: audio ? "" : errors.filter(Boolean).join(" ") };
}

// --- Fala para texto (tocar para falar no celular) ----------------------------------------------------------------------
// O app instalado no iPhone não tem reconhecimento de voz: o celular grava e manda o áudio; aqui ele vai à ElevenLabs
// (Scribe, mesma ELEVENLABS_API_KEY) e volta só o TEXTO. O áudio só passa pela memória desta chamada: nunca é gravado
// nem logado (logs só com o status). Custo em ai_usage_log (henry_voice_stt). 401/403 = chave sem "Fala para Texto".
export async function transcribeHenryAudio(auth, audio, { durationMs = 0 } = {}) {
  const token = process.env.ELEVENLABS_API_KEY;
  if (!token) throw Object.assign(new Error("Fala para texto não configurada (ELEVENLABS_API_KEY)."), { status: 503 });
  const { url, fields, fileName, mediaType } = buildElevenLabsTranscriptionRequest({ audio });
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([Buffer.from(audio.data, "base64")], { type: mediaType }), fileName);
  const estimatedSeconds = Math.min(30, Math.max(0, Number(durationMs) || 0) / 1000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "xi-api-key": token }, body: form, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    if (!response.ok) throw Object.assign(new Error(describeElevenLabsError(response.status, "stt")), { status: response.status });
    const payload = await response.json().catch(() => ({}));
    const seconds = Number(payload?.audio_duration_secs) > 0 ? Number(payload.audio_duration_secs) : estimatedSeconds;
    background(recordAiUsage({ feature: "henry_voice_stt", model: fields.model_id, triggeredBy: auth.profile?.id, costUsd: estimateElevenLabsSttCostUsd(seconds) }));
    return parseElevenLabsTranscript(payload);
  } catch (error) {
    console.warn(`[henry] fala para texto falhou (${error?.status || (error?.name === "TimeoutError" ? "timeout" : "erro")}).`);
    background(recordAiUsage({ feature: "henry_voice_stt", model: fields.model_id || ELEVENLABS_STT_MODEL, triggeredBy: auth.profile?.id, success: false, errorMessage: `elevenlabs stt: ${error?.status || error?.name || "erro"}` }));
    if (error?.status) throw Object.assign(new Error(error.message), { status: error.status === 401 || error.status === 403 ? 424 : 502 });
    throw Object.assign(new Error("Não consegui entender o áudio agora. Tente de novo."), { status: 502 });
  }
}
