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
import { firstName, saoPauloDateKey, saoPauloNow } from "./alexa-config-core.mjs";
import { planHenryVocabulary, vocabularyUsage } from "./henry-voice-lexicon.mjs";
import { henryClientAlertsFromSetting, henryTeamArrivalsFromSetting, henryVoiceNoticesFromSetting } from "./henry-voice-client-alerts-core.mjs";
import { HENRY_LOCK_DONE_PHRASES, HENRY_LOCKED_PHRASES, buildHenryLockNote, isHenryToolLocked } from "./henry-lock-core.mjs";
import { henryPulseFromSetting } from "./henry-pulse-core.mjs";
import {
  HENRY_TOOL_ACCESS,
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
  elevenLabsModelFor,
  parseElevenLabsSubscription,
  estimateElevenLabsCostUsd,
  henryProviderChain,
  parseElevenLabsVoices,
  pronounceForSpeech,
  resolveElevenLabsVoiceId
} from "./henry-voice-providers.mjs";
import { HENRY_BROKER_METRIC_IDS, HENRY_PERIOD_IDS, buildHenryBrokerReport, henryClientQueries, buildHenryPeriodReport, henryPeriodFromText, henryReportKind, previousHenryPeriod, resolveHenryPeriod } from "./henry-reports-core.mjs";
import { findHenryClientsByName, loadHenryAwaiting, loadHenryBrokerCards, loadHenryClientConversation, loadHenryFinance, loadHenryLeadOrigins, loadHenryOverview, loadHenryPresence, loadHenryTeamGoal, searchHenryClientsMany } from "./henry-reports";
import { decideClientOpen, isAcceptance, offeredToOpen } from "./henry-navigation-core.mjs";
import { readHenryNowPlaying, readHenrySpotifyTaste, readSpotifyStatus, runHenrySpotifyDeviceTool, runHenrySpotifyTool, startHenryMorningMusic } from "./henry-spotify";
import { loadHenryMorningExtras } from "./henry-morning";
import {
  MORNING_STYLE_QUESTION,
  MORNING_VOLUME,
  birthdayDraft,
  birthdayQuestion,
  classifyMorningMusicAnswer,
  classifyMorningStyle,
  classifyYesNo,
  composeMorningExtras,
  MORNING_ALREADY_PLAYING,
  morningMusicPrefix,
  morningOpening,
  parseMorningState,
  resolveMorningMusic
} from "./henry-morning-core.mjs";
import {
  MORNING_MUSIC_SETTING_ID,
  isOtherMusicRequest,
  morningSuggestionHistory,
  morningSuggestionLine,
  pickMorningSuggestion,
  rememberMorningSuggestion,
  spotifyTasteSuggestions,
  todaysMorningSuggestion
} from "./henry-morning-music-core.mjs";
import { HENRY_ACK_ITEMS, HENRY_WAIT_PHRASES, brokerWithArticle, henryDeviceResult, henryMusicResult, henryProgressFor, musicPlayingLine, narrationVoiceKey, pickHenryAnswerScene, pickMusicPlayingOpener } from "./henry-voice-narration.mjs";
import {
  HENRY_GOODBYES,
  HENRY_REPORT_INTROS,
  HENRY_WEB_SEARCH_USD,
  buildHenryDynamicPrompt,
  buildHenrySystemBlocks,
  buildReportRewritePrompt,
  closingsFrom,
  collectWebSources,
  henryNeedsTools,
  isHenryGreeting,
  henryWebSearchTool,
  looksLikeWebQuery,
  openingsFrom,
  pickDayHint,
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
  dayLexiconState,
  dayTurns,
  modelHistoryFromDay,
  notesFrom,
  parseMemoryCommand,
  recordDayLexicon,
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
const CLIENT_TOOL_TIMEOUT_MS = 8000; // vários clientes com ficha completa (consultas em paralelo; meta < 2 s para 3)
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "ash";
const OWNER_SUMMARY_TIMEOUT_MS = 9000;
const COMPLIMENT_TIMEOUT_MS = 3500; // elogio da webcam demorou → o relatório sai sem ele (HENRY-2)
const REPORT_REWRITE_TIMEOUT_MS = 4000; // relatório do dia no jeito de amigo; passou disso → reserva sem modelo
const MAX_REPLY_TOKENS = 300; // resposta falada = 1 a 3 frases curtas (≤ 700 caracteres)
const MAX_SMALL_TALK_TOKENS = 120; // papo casual (henryNeedsTools = false): 1 frase curta, sem ferramentas
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

// Aparelho ativo (só leitura, sem reservar): usado pelos avisos de cliente novo/transferido, que só falam nele.
export async function readHenryActiveDevice() {
  return readSettingRow(HENRY_DEVICE_SETTING_ID).catch(() => null);
}

// --- Memória do dia e lembretes (henry-memory-core.mjs) -----------------------------------------------------------------
// Memória do dia (REGRA OFICIAL, dono 2026-10-22): só o TEXTO das trocas de hoje (São Paulo), em crm_settings; zera na
// virada do dia. Gravada DEPOIS da resposta (background), nunca atrasa a fala. Lembretes: longo prazo, até 30.
export async function readHenryDayTurns() {
  return (await readHenryDay()).turns;
}

// Trocas de hoje + vocabulário já usado hoje (expressões, piadas, estruturas; henry-memory-core.mjs).
async function readHenryDay() {
  const stored = await readSettingRow(HENRY_DAY_MEMORY_SETTING_ID).catch(() => null);
  const today = saoPauloDateKey();
  return { turns: dayTurns(stored, today), lexicon: dayLexiconState(stored, today) };
}

// Vocabulário da resposta (dono, 2026-10-22: "para não repetir [...] o mesmo jeito de falar, mesmo que eu faça a mesma
// pergunta, pelo menos no mesmo dia"): repertório sorteado sem o que já foi usado hoje + estrutura do dia ainda não usada.
function planVocabulary(mode, question, lexicon) {
  const hour = Math.floor(saoPauloNow().minutes / 60);
  return { ...planHenryVocabulary({ mode, question, state: lexicon, hour }), hint: pickDayHint(lexicon.hints) };
}

// plan = planVocabulary(...) quando a resposta veio do modelo: marca como usadas hoje as expressões do banco que
// aparecem na resposta, a piada (se saiu) e a estrutura sorteada.
function rememberExchange(auth, question, reply, plan = null) {
  if (!question && !reply) return;
  background(
    (async () => {
      const stored = await readSettingRow(HENRY_DAY_MEMORY_SETTING_ID).catch(() => null);
      const today = saoPauloDateKey();
      const turns = [question ? { role: "user", text: question } : null, reply ? { role: "assistant", text: reply } : null].filter(Boolean);
      let next = appendDayTurns(stored, today, turns);
      if (plan) next = recordDayLexicon(next, today, { ...vocabularyUsage(reply, plan), hint: plan.hint });
      await writeSettingRow(auth, HENRY_DAY_MEMORY_SETTING_ID, next);
    })().catch((error) => console.warn(`[henry] memória do dia não gravada (${error?.name || "erro"}).`))
  );
}

async function readNotes() {
  return notesFrom(await readSettingRow(HENRY_NOTES_SETTING_ID).catch(() => null));
}

const recentPicks = { intro: [], memory: [], hint: [], locked: [], lockDone: [] };
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
    // Apaga a conversa; o vocabulário já usado hoje (só chaves curtas, sem a fala) continua, para não repetir.
    const today = saoPauloDateKey();
    const stored = await readSettingRow(HENRY_DAY_MEMORY_SETTING_ID).catch(() => null);
    await writeSettingRow(auth, HENRY_DAY_MEMORY_SETTING_ID, { date: today, turns: [], lexicon: dayLexiconState(stored, today) });
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
  return { enabled: henryEnabledFromSetting(value), vision: henryVisionFromSetting(value), webSearch: henryWebSearchFromSetting(value), mobileWake: value.mobileWake === true, clientAlerts: henryClientAlertsFromSetting(value), teamArrivals: henryTeamArrivalsFromSetting(value), voiceNotices: henryVoiceNoticesFromSetting(value), pulse: henryPulseFromSetting(value), style: resolveStyle(value.style) };
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
  if (typeof patch.clientAlerts === "boolean") next.clientAlerts = patch.clientAlerts;
  if (typeof patch.teamArrivals === "boolean") next.teamArrivals = patch.teamArrivals;
  if (typeof patch.voiceNotices === "boolean") next.voiceNotices = patch.voiceNotices;
  // Pulso do CRM (rascunho HENRY-1 "Pulso"): patch já validado por parseHenryPulsePatch; o resto do pulso é preservado.
  if (patch.pulse) next.pulse = { ...(current.pulse && typeof current.pulse === "object" ? current.pulse : {}), ...patch.pulse };
  if (patch.style) next.style = mergeHenryStyle(current.style, patch.style);
  await writeSettingRow(auth, HENRY_SETTING_ID, next);
  return { enabled: henryEnabledFromSetting(next), vision: henryVisionFromSetting(next), webSearch: henryWebSearchFromSetting(next), mobileWake: next.mobileWake === true, clientAlerts: henryClientAlertsFromSetting(next), teamArrivals: henryTeamArrivalsFromSetting(next), voiceNotices: henryVoiceNoticesFromSetting(next), pulse: henryPulseFromSetting(next), style: resolveStyle(next.style) };
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

// Erro da ElevenLabs com o corpo lido (o 401 de créditos esgotados só se distingue pelo detail.status = quota_exceeded).
async function elevenLabsFailure(response, what) {
  const payload = await response.json().catch(() => null);
  return Object.assign(new Error(describeElevenLabsError(response.status, what, payload)), { status: response.status });
}

export async function listElevenLabsVoices({ fresh = false } = {}) {
  const token = process.env.ELEVENLABS_API_KEY;
  if (!token) return [];
  if (!fresh && voicesCache.list && Date.now() - voicesCache.at < VOICES_CACHE_MS) return voicesCache.list;
  const response = await fetch(`${ELEVENLABS_API}/v2/voices?page_size=100&sort=name&sort_direction=asc`, {
    headers: { "xi-api-key": token },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw await elevenLabsFailure(response, "voices");
  const list = parseElevenLabsVoices(await response.json().catch(() => ({})));
  voicesCache = { at: Date.now(), list };
  return list;
}

// Saldo de caracteres do plano (GET /v1/user/subscription, permissão "Usuário"). Sem chave → null.
export async function readElevenLabsSubscription() {
  const token = process.env.ELEVENLABS_API_KEY;
  if (!token) return null;
  const response = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, { headers: { "xi-api-key": token }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw await elevenLabsFailure(response, "user");
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
  const model = elevenLabsModelFor({ modelId: ELEVENLABS_MODEL(), profile: context.profile });
  const voiceId = await elevenLabsVoiceFor(style);
  const { url, body } = buildElevenLabsSpeechRequest({ text, voiceId, modelId: model, style, previousText: context.previousText, nextText: context.nextText, profile: context.profile });
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) throw await elevenLabsFailure(response, "tts");
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
      "Consulta um número ou lista do CRM pelo mesmo catálogo da Alexa (Meta Diária e pontuação de hoje, prospecção, online, funil, " +
      "clientes por etapa — da equipe ou de um corretor —, agenda/reuniões de hoje, amanhã ou da semana — da equipe ou de um corretor —, " +
      "clientes sem atendimento, clientes parados/sem contato há mais de 3 dias, pendências, fila da roleta, clientes novos, vendas, " +
      "aprovações, conversão, desempenho, ranking, pontos, resumo e métricas por corretor). Devolve uma frase pronta com os números da tela.",
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
    name: "buscar_clientes",
    description:
      "Status de UM OU VÁRIOS clientes de uma vez (passe todos os nomes/telefones numa única chamada): etapa do funil, corretor responsável, " +
      "último contato/atendimento, próxima atividade, simulação (feita/enviada), documentos, análise da CCA, origem e as 3 últimas movimentações. " +
      "Nunca devolve CPF nem documento. Se vários clientes tiverem o mesmo nome, devolve até 3 opções (corretor e etapa): pergunte qual " +
      "e chame de novo com o nome mais completo ou com o corretor. Telefone só aparece na tela, e só se ele pedir o telefone (incluir_telefone).",
    input_schema: {
      type: "object",
      properties: {
        clientes: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              nome: { type: "string", description: "Nome (ou parte) do cliente, como foi falado." },
              telefone: { type: "string", description: "Telefone, quando ele disser o número em vez do nome." },
              corretor: { type: "string", description: "Corretor do cliente, para escolher entre clientes com o mesmo nome ('o da Carol')." }
            }
          }
        },
        incluir_telefone: { type: "boolean", description: "Só true quando ele pedir o telefone." }
      },
      required: ["clientes"]
    }
  },
  {
    name: "conversas_aguardando",
    description:
      "Chat do WhatsApp: quantas conversas aguardam resposta, por corretor (com a mais antiga), igual ao Início. Com 'cliente': a conversa " +
      "daquele cliente (última mensagem dele, última resposta da equipe, não lidas e o resumo da IA se já existir).",
    input_schema: {
      type: "object",
      properties: {
        corretor: { type: "string", description: "Só as de um corretor, como foi falado." },
        cliente: { type: "string", description: "Nome do cliente para ver a conversa dele." }
      }
    }
  },
  {
    name: "financeiro_resumo",
    description: "Financeiro do mês (só do Matheus): recebido neste mês, previsto a receber neste mês, vencidos de meses anteriores e próximos 30 dias — a mesma conta da tela Financeiro.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "presenca_hoje",
    description: "Quem da equipe está/chegou na imobiliária hoje (Wi-Fi), com o horário de chegada, e se o Matheus está lá.",
    input_schema: { type: "object", properties: {} }
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
    name: "spotify",
    description:
      "Controla o Spotify do dono (Premium): tocar por busca (música, artista, playlist ou álbum), pausar, continuar, próxima, anterior, " +
      "volume e o que está tocando. Use quando ele pedir música ('Henry, toca Legião Urbana', 'pausa', 'aumenta o som', 'que música é essa?').",
    input_schema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ["tocar", "pausar", "continuar", "proxima", "anterior", "volume", "tocando"] },
        busca: { type: "string", description: "Só em tocar: o que ele pediu para ouvir, como foi falado." },
        tipo: { type: "string", enum: ["musica", "artista", "playlist", "album"], description: "Só em tocar; padrão musica." },
        volume: { type: "integer", minimum: 0, maximum: 100, description: "Só em volume, quando ele disser um número." },
        ajuste: { type: "string", enum: ["mais_alto", "mais_baixo"], description: "Só em volume, sem número ('aumenta', 'abaixa')." }
      },
      required: ["acao"]
    }
  },
  {
    name: "mudar_aparelho_spotify",
    description:
      "Passa a música do Spotify para outro aparelho (Alexa/Echo, computador, celular, caixa de som). Use quando ele pedir " +
      "'toca na Alexa', 'passa pra Alexa', 'joga pro Echo', 'volta pro computador', 'toca no celular', 'toca na caixa da sala'. " +
      "Se vierem várias opções, a ferramenta devolve a pergunta; depois chame de novo com o nome que ele escolher.",
    input_schema: {
      type: "object",
      properties: { aparelho: { type: "string", description: "O aparelho como ele falou (ex.: Alexa, computador, celular, caixa da sala, Echo do quarto)." } },
      required: ["aparelho"]
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
  context.chart = report.chart || null; // cena "comparativo": período x anterior
  context.reportMode = true;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

async function runBrokerReport(input, auth, context) {
  const spoken = String(input?.corretor || "").slice(0, 60);
  // Números do período já começam a carregar junto com o reconhecimento do corretor (antes era um depois do outro).
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "este_mes" }), saoPauloDateKey());
  const started = Date.now();
  const numbers = Promise.all([softRead("desempenho do corretor", readOverviewFor(auth, range)), softRead("meta do corretor", readTeamGoalFor(auth, range))]);
  const match = await announceBroker(context, "consultar_corretor", input, spoken);
  if (!match) return `Não achei o corretor "${spoken}". Corretores: ${(await brokerMatcher(context)).names.join(", ")}.`;
  const [overview, teamGoal] = await numbers;
  console.info(`[henry] tempos consultar_corretor: ${Date.now() - started} ms (periodo=${range.id || "intervalo"}).`);
  if (!overview && !teamGoal) return "Não consegui buscar os números desse corretor agora.";
  const report = buildHenryBrokerReport({ broker: { id: match.id, name: match.name }, range, overview, teamGoal, metric: String(input?.metrica || "") });
  await announceBroker(context, "consultar_corretor", input, spoken, { found: true, stats: report.stats, position: report.position || null });
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

async function runClientSearch(input, auth, context) {
  const queries = henryClientQueries(input);
  if (!queries.length) return "Diga o nome ou o telefone do cliente.";
  const withPhone = input?.incluir_telefone === true;
  const started = Date.now();
  const key = `clients:${auth?.profile?.id || ""}:${JSON.stringify(queries)}:${withPhone ? 1 : 0}`;
  const result = await withTimeout(cachedRead(key, () => searchHenryClientsMany(auth, queries, { withPhone })), CLIENT_TOOL_TIMEOUT_MS);
  console.info(`[henry] tempos buscar_clientes: ${Date.now() - started} ms (buscas=${queries.length}).`);
  context.detail = result.detail;
  return JSON.stringify({
    sugestao_de_fala: result.spoken,
    clientes: result.facts,
    ...(result.ambiguous ? { instrucao: "Há clientes com o mesmo nome: fale os que achou e termine perguntando qual deles (corretor e etapa), numa frase curta." } : {})
  });
}

async function runAwaiting(input, auth, context) {
  if (input?.cliente) {
    const name = String(input.cliente).slice(0, 60);
    const report = await withTimeout(cachedRead(`conversation:${auth?.profile?.id || ""}:${name.toLowerCase()}`, () => loadHenryClientConversation(auth, name)), CLIENT_TOOL_TIMEOUT_MS);
    if (!report) return "Diga o nome do cliente.";
    context.detail = report.detail;
    return JSON.stringify({ sugestao_de_fala: report.spoken, conversa: report.facts, instrucao: "Resumo da IA: fale no máximo uma frase, sem renda, valores ou documentos." });
  }
  let brokerId = "";
  if (input?.corretor) {
    const match = await announceBroker(context, "conversas_aguardando", input, String(input.corretor).slice(0, 60));
    if (!match) return `Não achei o corretor "${String(input.corretor).slice(0, 60)}".`;
    brokerId = match.id;
  }
  const report = await withTimeout(cachedRead(`awaiting:${auth?.profile?.id || ""}:${brokerId}`, () => loadHenryAwaiting(auth, { brokerId })), TOOL_TIMEOUT_MS);
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

// Ferramentas de leitura com o mesmo pedido em até ~45 s → mesma resposta do cache (só respostas boas entram).
async function runTool(name, input, auth, context) {
  // Tela bloqueada (HENRY-LOCK): ferramenta que lê o CRM ou abre tela nem roda (o modelo nem as recebe; esta é a 2ª trava).
  if (context.locked && isHenryToolLocked(HENRY_TOOL_ACCESS[name] || "leitura")) {
    return JSON.stringify({ bloqueado: true, instrucao: `A tela está bloqueada: não responda o dado; peça para desbloquear com a senha, numa frase curta (ex.: "${context.lockedPhrase}").` });
  }
  try {
    if (name === "relatorio_periodo") return await runPeriodReport(input || {}, auth, context);
    if (name === "consultar_corretor") return await runBrokerReport(input || {}, auth, context);
    if (name === "buscar_clientes" || name === "buscar_cliente") return await runClientSearch(input || {}, auth, context);
    if (name === "conversas_aguardando") return await runAwaiting(input || {}, auth, context);
    if (name === "financeiro_resumo") {
      const report = await withTimeout(cachedRead(`finance:${auth?.profile?.id || ""}`, () => loadHenryFinance(auth)), TOOL_TIMEOUT_MS);
      if (!report) return "O financeiro é só do Matheus.";
      context.detail = report.detail;
      return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
    }
    if (name === "presenca_hoje") {
      const report = await withTimeout(cachedRead(`presence:${auth?.profile?.id || ""}`, () => loadHenryPresence(auth)), TOOL_TIMEOUT_MS);
      context.detail = report.detail;
      return JSON.stringify({ sugestao_de_fala: report.spoken, presenca: report.facts });
    }
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
    if (name === "spotify") {
      const result = await withTimeout(runHenrySpotifyTool(input || {}), TOOL_TIMEOUT_MS);
      if (result.openUrl) {
        context.openUrl = result.openUrl;
        context.detail = { title: "Spotify", subtitle: "", sections: [{ title: "Abrir", rows: [{ label: `Buscar “${result.query}” no Spotify`, value: "", href: result.openUrl }] }] };
      }
      if (result.openSpotify) context.spotify = { action: "open_spotify", uri: result.openSpotify.uri };
      // Cena da música (dono, 2026-10-23): resultado real da busca/do play → achou (com capa) / tocando / erro.
      const event = result.command ? henryMusicResult(result.command, result.result) : result.openUrl ? henryMusicResult({ action: "tocar", query: result.query }, { ok: false, uri: "web" }) : null;
      if (event) {
        context.emit?.(event);
        context.music = { ...(context.music || {}), ...event.music };
        if (result.command?.action === "tocar" && result.result?.ok) context.musicPlayed = result.result.playing || { name: result.command.query };
      }
      return result.text;
    }
    if (name === "mudar_aparelho_spotify") {
      const result = await withTimeout(runHenrySpotifyDeviceTool(input || {}, { restoreVolume: context.spotifyVolume }), TOOL_TIMEOUT_MS);
      if (result.line) context.deviceLine = result.line;
      if (result.result?.ok && !result.result.already) context.spotifyMoved = true;
      const event = henryDeviceResult(result.result || { ok: false, reason: "failed" });
      context.emit?.(event);
      context.music = { ...(context.music || {}), ...event.music };
      return result.text;
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

// Mesma chamada, em stream (SSE, dono 2026-10-23: "ele demora muito para responder"): o texto chega aos pedaços (onText),
// e a 1ª frase já pode ir para a voz enquanto o resto é gerado. Devolve o MESMO formato da chamada normal (content,
// stop_reason, usage), remontado dos eventos — os blocos voltam iguais para as rodadas de ferramenta e pesquisa.
async function streamAnthropic(payload, { onText = null } = {}) {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) throw Object.assign(new Error("Assistente de voz não configurado (ANTHROPIC_API_KEY)."), { status: 503 });
  const fastControls = /haiku-5/.test(HENRY_MODEL) ? { thinking: { type: "disabled" }, output_config: { effort: "low" } } : {};
  const startedAt = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": token, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: HENRY_MODEL, ...samplingFor(HENRY_MODEL), ...payload, ...fastControls, stream: true }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Falha na IA (HTTP ${response.status}).`);
  }
  const message = { content: [], stop_reason: null, usage: {}, firstTokenMs: null };
  const partialJson = new Map();
  let toolStarted = false;
  const handle = (event) => {
    const index = Number(event?.index);
    if (event?.type === "message_start") message.usage = { ...(event.message?.usage || {}) };
    else if (event?.type === "content_block_start") {
      const block = { ...(event.content_block || {}) };
      if (block.type === "text") block.text = block.text || "";
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        toolStarted = true;
        partialJson.set(index, "");
      }
      message.content[index] = block;
    } else if (event?.type === "content_block_delta") {
      const block = message.content[index];
      const delta = event.delta || {};
      if (!block) return;
      if (delta.type === "text_delta") {
        block.text = `${block.text || ""}${delta.text || ""}`;
        if (message.firstTokenMs === null) message.firstTokenMs = Date.now() - startedAt;
        if (onText) {
          try {
            onText(delta.text || "", { toolStarted });
          } catch {
            // a voz antecipada nunca derruba a resposta
          }
        }
      } else if (delta.type === "input_json_delta") partialJson.set(index, `${partialJson.get(index) || ""}${delta.partial_json || ""}`);
      else if (delta.type === "citations_delta" && delta.citation) (block.citations ||= []).push(delta.citation);
    } else if (event?.type === "content_block_stop") {
      if (partialJson.has(index) && message.content[index]) {
        const raw = partialJson.get(index);
        try {
          message.content[index].input = raw ? JSON.parse(raw) : {};
        } catch {
          message.content[index].input = {};
        }
        partialJson.delete(index);
      }
    } else if (event?.type === "message_delta") {
      if (event.delta?.stop_reason) message.stop_reason = event.delta.stop_reason;
      if (event.usage) message.usage = { ...message.usage, ...event.usage };
    } else if (event?.type === "error") throw new Error(event.error?.message || "Falha na IA (stream).");
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (!data) continue;
      let event = null;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      handle(event);
    }
  }
  message.content = message.content.filter(Boolean);
  message.ms = Date.now() - startedAt;
  return message;
}

// Sistema = parte FIXA com cache de prompt (identidade, jeito, conhecimento de base, barreiras, ferramentas) + parte
// VARIÁVEL (data/hora de Brasília, estilo da tela, visão, lembretes, memória do dia, aberturas já usadas, dica sorteada).
// vision = visão ligada na configuração; withImage = veio quadro da câmera. webSearch = pesquisa na internet ligada.
function callModel(messages, { withImage = false, vision = false, style, reportMode = false, webSearch = false, notes = [], daySummary = "", usedOpenings = [], usedClosings = [], hint = "", repertoire = "", usedExpressions = [], tools = true, onText = null, lockNote = "" } = {}) {
  const dynamic = buildHenryDynamicPrompt({
    todayKey: saoPauloDateKey(),
    stylePrompt: buildHenryStylePrompt(style),
    visionNote: buildHenryVisionNote({ vision, withImage }),
    notes: notes.map((note) => note.text),
    daySummary,
    usedOpenings,
    usedClosings,
    hint,
    webSearch,
    repertoire,
    usedExpressions,
    lockNote
  });
  // Papo casual (tools = false): sem ferramentas e resposta curta — o modelo responde mais rápido.
  return streamAnthropic({
    max_tokens: reportMode ? MAX_REPORT_TOKENS : tools ? MAX_REPLY_TOKENS : MAX_SMALL_TALK_TOKENS,
    system: buildHenrySystemBlocks(dynamic),
    ...(tools ? { tools: henryToolsFor({ webSearch, locked: Boolean(lockNote) }) } : {}),
    messages
  }, { onText });
}

// Tela bloqueada (HENRY-LOCK): só as ferramentas que não leem o CRM (música; internet se ligada).
function henryToolsFor({ webSearch = false, locked = false } = {}) {
  const base = locked ? TOOLS.filter((tool) => !isHenryToolLocked(HENRY_TOOL_ACCESS[tool.name] || "leitura")) : TOOLS;
  return webSearch ? [...base, henryWebSearchTool()] : base;
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
async function rewriteDailyReport(auth, factual, { address, usedOpenings, plan }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
  try {
    const data = await withTimeout(
      callAnthropic({
        max_tokens: 400,
        system: buildReportRewritePrompt({ address, usedOpenings, hint: plan.hint, repertoire: plan.promptText, usedExpressions: plan.usedExpressions }),
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

// Spotify conectado (configurado + autorizado)? Sem ele o bom dia pula a pergunta da música. playing = já está tocando
// (dono, 2026-10-23): aí não pergunta "posso dar play?" e vai direto ao relatório. Leitura do player falhou → como antes.
async function morningMusicState() {
  const status = await readSpotifyStatus().catch(() => null);
  if (!status?.configured || !status?.connected) return { available: false, playing: false };
  const now = await readHenryNowPlaying().catch(() => null);
  return { available: true, playing: now?.isPlaying === true };
}

// Sugestão de música do bom dia (dono, 2026-10-24 — henry-morning-music-core.mjs): gosto do dono no Spotify quando o
// token tiver os escopos de leitura, senão o banco fixo; nunca a de ontem (henry_morning_music, só ids e o que tocar).
// A sugestão de hoje é gravada ANTES de responder (o "pode" chega segundos depois e toca exatamente ela). Falhou a leitura
// ou a gravação → null (abertura antiga: "posso dar play?" → estilo), nunca uma sugestão que não dá para tocar.
async function suggestMorningMusic(auth) {
  try {
    const [stored, taste] = await Promise.all([readSettingRow(MORNING_MUSIC_SETTING_ID), readHenrySpotifyTaste().catch(() => null)]);
    const history = morningSuggestionHistory(stored);
    const tasteItems = (taste ? spotifyTasteSuggestions(taste) : []).filter((entry) => safeHenryReply(entry.say) === entry.say);
    const offer = pickMorningSuggestion({ taste: tasteItems, recent: history.map((entry) => entry.id), lastKind: history[history.length - 1]?.kind || "" });
    if (!offer) return null;
    await writeSettingRow(auth, MORNING_MUSIC_SETTING_ID, rememberMorningSuggestion(stored, offer, saoPauloDateKey()));
    return offer;
  } catch (error) {
    console.warn(`[henry] sugestão de música do bom dia indisponível (${error?.name || "erro"}); usando a abertura de sempre.`);
    return null;
  }
}

// Resposta do dono à pergunta da música (step "music") ou do estilo (step "style"). null = era outra pergunta.
async function answerMorningMusic(auth, { step, question, image, style, address, emit = () => {}, locked = false }) {
  const text = String(question || "").trim();
  const classified = step === "music" ? classifyMorningMusicAnswer(text) : classifyMorningStyle(text);
  // "toca <outra coisa>" na sugestão: o pedido dele vai para a ferramenta do Spotify (nunca toca a sugestão no lugar).
  const answer = step === "music" && classified !== "rock" && classified !== "sertanejo" && isOtherMusicRequest(text) ? "other" : classified;
  if (answer === "other") return null;
  // Aceitou a sugestão do bom dia ("pode", "manda"): toca EXATAMENTE o sugerido. Sem sugestão de hoje gravada (falhou a
  // gravação), cai na pergunta do estilo de antes.
  const suggested = answer === "yes" && step === "music" ? todaysMorningSuggestion(await readSettingRow(MORNING_MUSIC_SETTING_ID).catch(() => null), saoPauloDateKey()) : null;
  if (answer === "yes" && !suggested) {
    rememberExchange(auth, text, MORNING_STYLE_QUESTION);
    return { reply: MORNING_STYLE_QUESTION, navigate: null, detail: null, morning: { step: "style" }, scene: { kind: "conversa" } };
  }
  if (answer === "no") return composeReportAnswer(auth, { question: text, image, style, address, locked });
  const target = suggested ? suggested.target : resolveMorningMusic(answer, style);
  const query = suggested ? suggested.target.query || suggested.say : target?.query || (answer === "sertanejo" ? "Sertanejo raiz" : "Rock");
  const choice = suggested ? suggested.choice || "sugestao" : answer;
  emit({ progress: "musica_busca", topic: "music", label: `Procurando “${query}” no Spotify…`, music: { stage: "search", query } });
  const music = await startHenryMorningMusic(target, MORNING_VOLUME);
  emit(henryMusicResult({ action: "tocar", query }, music));
  console.info(`[henry] bom dia com música: ${suggested ? `sugestão ${suggested.kind}` : answer} (${music.ok ? "tocando" : music.openSpotify ? "abrindo o app" : music.reason || "falhou"}).`);
  const spotify = music.openSpotify ? { action: "open_spotify", uri: music.openSpotify.uri, volume: MORNING_VOLUME } : null;
  return composeReportAnswer(auth, { question: text, image, style, address, prefix: morningMusicPrefix(choice, music), spotify, locked });
}

// Resposta à pergunta do aniversário (step "birthday"): sim → RASCUNHO na tela e na fala (nunca envia); não → ok.
async function answerMorningBirthday(auth, { question, address, locked = false }) {
  const text = String(question || "").trim();
  const answer = classifyYesNo(text);
  if (answer === "other") return null;
  if (locked && answer !== "no") return { reply: pick("locked", HENRY_LOCKED_PHRASES), navigate: null, detail: null, scene: { kind: "conversa" } };
  if (answer === "no") {
    rememberExchange(auth, text, "Beleza, fica pra depois.");
    return { reply: "Beleza, fica pra depois.", navigate: null, detail: null, scene: { kind: "conversa" } };
  }
  const extras = await cachedRead(`morning:${auth?.profile?.id || ""}`, () => loadHenryMorningExtras(auth)).catch(() => ({ birthdays: [] }));
  const names = (extras.birthdays || []).slice(0, 5);
  if (!names.length) return { reply: "Não achei aniversariante hoje agora. Confere na Agenda.", navigate: null, detail: null, scene: { kind: "conversa" } };
  const drafts = names.map((name) => ({ name, text: birthdayDraft(name, HENRY_OWNER_SPOKEN_NAME) }));
  const spokenDraft = safeHenryReply(`Rascunho pro ${drafts[0].name}: ${drafts[0].text} Está na tela pra você copiar e mandar.`);
  const reply = spokenDraft !== HENRY_FALLBACK_REPLY ? spokenDraft : "Rascunho pronto na tela, pra você copiar e mandar.";
  rememberExchange(auth, text, reply);
  const detail = { title: "Mensagem de aniversário", subtitle: "Rascunho — o Henry não envia nada", sections: [{ title: "Rascunhos", rows: drafts.map((draft) => ({ label: draft.name, value: draft.text })) }] };
  return { reply, navigate: null, detail, scene: { kind: "conversa" } };
}

// Relatório do dia (o "bom dia"): elogio (visão), números do Início, extras do bom dia (clientes novos desde ontem,
// simulações automáticas geradas) e, no fim, a pergunta dos aniversariantes (estado `birthday`). prefix = fala antes do
// relatório (música do bom dia), fora da reescrita do modelo.
async function composeReportAnswer(auth, { question = "", image = null, style = null, address = "", prefix = "", spotify = null, locked = false }) {
  // Tela bloqueada (HENRY-LOCK): o relatório do dia é dado do CRM — pede a senha (a música do bom dia, se houve, segue).
  if (locked) {
    const reply = [prefix, pick("locked", HENRY_LOCKED_PHRASES)].filter(Boolean).join(" ");
    rememberExchange(auth, String(question || "").trim() || "Bom dia, Henry", reply);
    return { reply, navigate: null, detail: null, spotify, scene: { kind: "conversa" } };
  }
  // Elogio com prazo curto: se a visão demorar, o relatório sai sem ele (a chamada termina sozinha e registra o custo).
  const compliment = image ? withTimeout(buildCompliment(auth, image, style), COMPLIMENT_TIMEOUT_MS).catch(() => {
    console.warn("[henry] elogio passou do prazo; relatório sem elogio.");
    return "";
  }) : "";
  const [complimentText, { inicio, ownerText }, day, extras] = await Promise.all([
    compliment,
    loadReportSources(auth),
    readHenryDay(),
    cachedRead(`morning:${auth?.profile?.id || ""}`, () => loadHenryMorningExtras(auth)).catch(() => ({ newClients: null, autoSimulations: null, birthdays: [] }))
  ]);
  const extrasText = safeHenryReply(composeMorningExtras(extras));
  const extraSentence = extrasText && extrasText !== HENRY_FALLBACK_REPLY ? extrasText : "";
  const memoryTurns = day.turns;
  const plan = planVocabulary("report", question, day.lexicon);
  // A barreira da fala troca a frase INTEIRA quando algo é sensível: tenta com elogio, sem elogio e, por fim, só o Início
  // (o elogio ou uma "atenção" nunca derrubam o relatório).
  const attempts = [{ ownerText, compliment: complimentText, address }, { ownerText, address }, { address }];
  let factual = "";
  let chosen = null;
  for (const options of attempts) {
    const base = composeHenryDailyReport(inicio, options);
    const text = base && extraSentence ? `${base} ${extraSentence}` : base;
    if (text && safeHenryReply(text) !== HENRY_FALLBACK_REPLY) {
      factual = safeHenryReply(text);
      chosen = options;
      break;
    }
  }
  if (!factual) return { reply: [prefix, `Olá, ${address || HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`].filter(Boolean).join(" "), navigate: null, detail: null, spotify };
  const rewritten = await rewriteDailyReport(auth, factual, { address, usedOpenings: openingsFrom(memoryTurns), plan });
  const fallbackBase = composeHenryDailyReport(inicio, { ...chosen, intro: pick("intro", HENRY_REPORT_INTROS) });
  const fallback = safeHenryReply(fallbackBase && extraSentence ? `${fallbackBase} ${extraSentence}` : fallbackBase);
  const reply = rewritten || (fallback !== HENRY_FALLBACK_REPLY ? fallback : factual);
  // Aniversariantes (só primeiros nomes): pergunta se prepara a mensagem — só RASCUNHO, nunca envia.
  const askedBirthday = safeHenryReply(birthdayQuestion(extras.birthdays));
  const birthdayAsk = askedBirthday && askedBirthday !== HENRY_FALLBACK_REPLY ? askedBirthday : "";
  const spoken = [prefix, reply, birthdayAsk].filter(Boolean).join(" ");
  console.info(`[henry] relatório do dia: ok (${rewritten ? "modelo" : "reserva"})${chosen?.compliment ? " (com elogio)" : ""}.`);
  // Na tela, os números exatos (a fala pode arredondar).
  const sentences = factual.split(/(?<=[.!?])\s+/).slice(1).filter((sentence) => sentence && sentence !== chosen?.compliment);
  const detail = sentences.length ? { title: "Relatório do dia", subtitle: "Números exatos de agora", sections: [{ title: "Hoje", rows: sentences.map((sentence) => ({ label: sentence, value: "" })) }] } : null;
  rememberExchange(auth, String(question || "").trim() || "Bom dia, Henry", spoken, plan);
  return { reply: spoken, navigate: null, detail, spotify, morning: birthdayAsk ? { step: "birthday" } : null, scene: { kind: pickHenryAnswerScene({ mode: "report" }) } };
}

// mode "report" = "bom dia, Henry" sem pergunta → com o Spotify conectado, primeiro a pergunta da música (bom dia em
// conversa, `morning`: music → style → relatório → birthday); sem Spotify, direto o relatório do dia (com a visão ligada e imagem, elogio antes), no jeito de
// amigo: o modelo reescreve o texto dos dados com trava de números; falhou → reserva com abertura sorteada.
// mode "question" = pergunta livre (com imagem quando a pergunta tem intenção visual e a visão está ligada).
// image = { mediaType, data } validada por parseHenryImage; só vive nesta chamada. style = readHenrySettings().style.
// webSearch = pesquisa na internet ligada (readHenrySettings().webSearch).
// onProgress(evento) = narração/cena do stream: { progress, topic, label, broker? } a cada ferramenta chamada (nunca lança).
// Devolve { reply (falado), navigate, detail (tela: relatório/corretor/cliente/fontes em lista; null nas respostas curtas),
// scene ({ kind, chart? } — cena da resposta, pickHenryAnswerScene), memoryCleared? }. A troca vai para a memória do dia DEPOIS da resposta (background).
// locked = tela de bloqueio ativa (HENRY-LOCK, conferido no servidor pela rota): conversa, música e internet seguem; nada do
// CRM (sem ferramentas de leitura/navegação, sem memória do dia nem lembretes no prompt, relatório pede a senha).
// lockCommand = "done" ("Henry, bloqueia" já bloqueou na rota) | "no_pin" (pediu para bloquear sem senha definida).
export async function answerHenry(auth, { mode = "question", question = "", history = [], image = null, style = null, vision = false, webSearch = false, onProgress = null, onFirstSentence = null, morning = null, spotifyVolume = null, locked = false, lockCommand = "" } = {}) {
  const address = henryAddressName(style);
  if (lockCommand) {
    const reply = lockCommand === "done" ? pick("lockDone", HENRY_LOCK_DONE_PHRASES) : "Ainda não tem senha. Define uma no cartão do Henry, em Alexa e Henry, que eu passo a travar.";
    rememberExchange(auth, String(question || "").trim(), reply);
    return { reply, navigate: null, detail: null, scene: { kind: "conversa" } };
  }
  const emit = (event) => {
    if (!event || typeof onProgress !== "function") return;
    try {
      onProgress(event);
    } catch {
      // o stream fechou (o dono interrompeu): segue sem a cena
    }
  };
  // Bom dia em conversa (dono, 2026-10-23): o passo vem da tela (janela de conversa de 40 s).
  const step = parseMorningState(morning)?.step || "";
  let musicState = null;
  if (mode === "report") {
    if (step === "music" || step === "style") {
      const handled = await answerMorningMusic(auth, { step, question, image, style, address, emit, locked });
      if (handled) return handled;
      // Era outra pergunta: segue como pergunta normal (sem a imagem do bom dia).
      mode = "question";
      image = null;
    } else if ((musicState = await morningMusicState()).playing) {
      const answer = await composeReportAnswer(auth, { question, image, style, address, prefix: MORNING_ALREADY_PLAYING, locked });
      return { ...answer, musicPlaying: true };
    } else if (musicState.available) {
      const [{ turns: todayTurns }, offer] = await Promise.all([readHenryDay(), suggestMorningMusic(auth)]);
      const name = address || HENRY_OWNER_SPOKEN_NAME;
      const avoid = openingsFrom(todayTurns);
      const reply = offer ? morningSuggestionLine(offer, name, { avoid }) : morningOpening(name, { avoid, random: Math.random });
      rememberExchange(auth, String(question || "").trim() || "Bom dia, Henry", reply);
      // Aquece os números do relatório enquanto ele responde.
      background(Promise.all([loadReportSources(auth), cachedRead(`morning:${auth?.profile?.id || ""}`, () => loadHenryMorningExtras(auth))]).catch(() => null));
      return { reply, navigate: null, detail: null, morning: { step: "music" }, scene: { kind: "conversa" } };
    } else {
      return composeReportAnswer(auth, { question, image, style, address, locked });
    }
  }
  if (step === "birthday") {
    const handled = await answerMorningBirthday(auth, { question, address, locked });
    if (handled) return handled;
  }

  const text = String(question || "").trim();
  // Lembretes e "esquece a conversa de hoje": sem o modelo.
  const command = await runMemoryCommand(auth, text);
  if (command) {
    if (!command.memoryCleared) rememberExchange(auth, text, command.reply);
    // Bloqueado: anota/apaga lembrete normalmente, mas a lista dos lembretes não vai para a tela.
    return { ...command, ...(locked ? { detail: null } : {}), scene: { kind: pickHenryAnswerScene({ memory: true }) } };
  }
  const [{ turns: storedTurns, lexicon }, storedNotes] = await Promise.all([readHenryDay(), readNotes()]);
  // Bloqueado (HENRY-LOCK): a conversa de hoje (pode ter dado do CRM) e os lembretes não entram no prompt; só a conversa
  // que a tela mandou desde o bloqueio.
  const memoryTurns = locked ? [] : storedTurns;
  const notes = locked ? [] : storedNotes;
  const day = modelHistoryFromDay(memoryTurns);
  // Memória do dia (servidor) manda; sem nada guardado, a conversa que a página mandou.
  const previous = memoryTurns.length ? sanitizeHistory(day.history) : sanitizeHistory(history);
  const lockedPhrase = locked ? pick("locked", HENRY_LOCKED_PHRASES) : "";
  const context = { locked, lockedPhrase, navigate: null, openUrl: null, spotify: null, brokers: null, detail: null, chart: null, tools: [], reportMode: false, question: text, emit, music: null, musicPlayed: null, deviceLine: "", spotifyMoved: false, spotifyVolume: Number.isInteger(spotifyVolume) && spotifyVolume >= 0 && spotifyVolume <= 100 ? spotifyVolume : null };
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
  const plan = planVocabulary("question", text, lexicon);
  // Papo casual sem pergunta dele em aberto: sem ferramentas (resposta mais rápida). Resposta a uma pergunta dele
  // ("É essa?", "Quer que eu abra?") sempre com ferramentas — exceto saudação/cortesia pura (isHenryGreeting, dono
  // 2026-10-24: "só falei boa noite"), que nunca liga ferramentas, mesmo com uma pergunta antiga dele no histórico.
  const greeting = !image && isHenryGreeting(text);
  const withTools = Boolean(image) || (!greeting && (accepted || /\?\s*$/.test(lastAssistant) || henryNeedsTools(text)));
  const hint = accepted ? "ele ACEITOU abrir o que você ofereceu: use abrir_tela ou abrir_cliente agora, sem perguntar de novo, e confirme em poucas palavras"
    : greeting ? "ele só te cumprimentou/agradeceu/se despediu: responda SÓ isso, numa frase curta e natural (ex.: \"Boa noite! Tudo certo por aqui.\"), sem números, sem resumo do CRM, sem dizer que vai verificar ou analisar nada e sem oferecer consulta"
    : plan.hint;
  const promptExtras = { lockNote: locked ? buildHenryLockNote(lockedPhrase) : "", notes, daySummary: day.summary, usedOpenings: openingsFrom(memoryTurns), usedClosings: closingsFrom(memoryTurns), hint, webSearch, repertoire: plan.promptText, usedExpressions: plan.usedExpressions, tools: withTools };
  // Tempos (só números, sem conteúdo): modelo (1º pedaço de texto e total), ferramentas, rodadas.
  const timing = { modelMs: 0, firstTokenMs: null, toolsMs: 0, rounds: 0, tools: withTools };
  // 1ª frase da resposta (sem ferramenta pedida nesta rodada): vai para a voz antes do resto terminar.
  let firstSentenceSent = false;
  let roundText = "";
  const onText = typeof onFirstSentence === "function"
    ? (piece, { toolStarted }) => {
        if (firstSentenceSent || toolStarted) return;
        roundText += piece;
        const match = roundText.match(/^\s*(.{20,}?[.!?])\s/);
        if (!match) return;
        firstSentenceSent = true;
        onFirstSentence(match[1].trim());
      }
    : null;
  const allBlocks = [];
  let replyText = "";
  let rounds = 0;
  try {
    for (; rounds <= MAX_TOOL_ROUNDS; rounds += 1) {
      roundText = "";
      const data = await callModel(messages, { withImage: Boolean(image), vision: vision || Boolean(image), style, reportMode: context.reportMode, ...promptExtras, onText });
      sumUsage(usage, data);
      timing.modelMs += Number(data.ms) || 0;
      timing.firstTokenMs = Number.isFinite(data.firstTokenMs) ? data.firstTokenMs : timing.firstTokenMs;
      timing.rounds += 1;
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
        context.tools.push({ name: block.name, input: block.input || {} }); // cena da resposta (pickHenryAnswerScene)
        if (block.name === "consultar_corretor" || (block.name === "consultar_crm" && block.input?.corretor)) continue;
        emit(henryProgressFor(block.name, block.input || {}));
      }
      const toolsStarted = Date.now();
      const results = await Promise.all(toolUses.map(async (block) => ({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input, auth, context) })));
      timing.toolsMs += Date.now() - toolsStarted;
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
  // Falas fixas da música só quando o pedido foi SÓ de música. Pedido composto ("toca X e depois me fala do Gabriel",
  // dono 2026-10-23) fica com a resposta do modelo, que confirma a música e responde o resto (antes a fala fixa
  // apagava a parte do corretor).
  const musicOnly = context.tools.length > 0 && context.tools.every((tool) => tool.name === "spotify" || tool.name === "mudar_aparelho_spotify");
  // Spotify fechado: fala fixa e curta enquanto a tela abre o app (o play vem depois, em /api/admin/henry/spotify/play).
  if (context.spotify && musicOnly) replyText = "Abrindo o Spotify…";
  // Tocou direto (aparelho aberto): "Pronto, tá tocando!" (ou outro começo, sem repetir hoje) + faixa e artista.
  else if (context.musicPlayed && musicOnly) replyText = [musicPlayingLine(context.musicPlayed, { opener: pickMusicPlayingOpener(openingsFrom(memoryTurns)) }), context.deviceLine].filter(Boolean).join(" ");
  // Troca de aparelho (dono, 2026-10-23): fala fixa e curta ("Pronto, passei pra Alexa.", "Voltou pro computador.").
  else if (context.deviceLine && musicOnly) replyText = context.deviceLine;
  const reply = safeHenryReply(stripUrls(replyText) || fallback, { screenFallback: Boolean(detail) });
  rememberExchange(auth, text, reply, accepted ? { ...plan, hint: "" } : plan);
  // Cena da resposta pelo que já aconteceu aqui (ferramentas, pesquisa) — sem chamada extra de IA.
  const kind = pickHenryAnswerScene({ tools: context.tools, webSearches: usage.webSearches });
  const scene = kind === "comparativo" && context.chart ? { kind, chart: context.chart } : kind === "musica" && context.music ? { kind, music: context.music } : { kind };
  return { reply, navigate: context.navigate, openUrl: context.openUrl, spotify: context.spotify, detail, scene, timing, ...(context.spotifyMoved ? { spotifyMoved: true } : {}) };
}

// Voz do servidor: ElevenLabs (endpoint de streaming) → OpenAI → null (o navegador fala com a melhor voz pt-BR dele).
// style = voz/tom/velocidade da tela; context = { previousText, nextText } quando a fala vai em partes (continuidade).
// Cada tentativa (ok ou falha) vai para ai_usage_log (henry_voice_tts, model = id do modelo do provedor).
// context.primaryOnly = só o 1º provedor da ordem (frases de espera: nunca numa voz diferente da resposta; falhou → sem som).
// context.profile = "call": chamado do aviso, com o perfil de voz próprio (buildElevenLabsSpeechRequest).
export async function synthesizeHenrySpeech(auth, text, style = null, context = {}) {
  if (!text) return null;
  const chain = henryProviderChain(providerEnv());
  for (const provider of context.primaryOnly ? chain.slice(0, 1) : chain) {
    const model = provider === "elevenlabs" ? elevenLabsModelFor({ modelId: ELEVENLABS_MODEL(), profile: context.profile }) : TTS_MODEL;
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
// Conjunto FIXO (HENRY_WAIT_PHRASES + confirmações + despedidas) sintetizado UMA vez por voz+estilo e FRASE, guardado aqui
// por 6 h (o navegador guarda na sessão): não é uma chamada de voz por frase de espera. Só o provedor principal (a mesma
// voz da resposta); sem voz do servidor → lista vazia e o Henry fica em silêncio enquanto pensa (nunca a voz do
// navegador). Custo em ai_usage_log (henry_voice_tts), como toda fala.
// Cache por frase (dono, 2026-10-23: "repete muito a mesma frase"): o pacote inteiro numa só chamada passava do tempo da
// função ou voltava pela metade (crédito/limite da ElevenLabs) e o navegador ficava o dia com poucas frases. Agora:
//   - sem ids → o pacote, com teto de tempo (NARRATION_BUDGET_MS): devolve o que ficou pronto, o resto vem depois;
//   - ids → só essas (pré-aquecimento em lotes e "frase ainda não usada hoje"), nunca sintetiza de novo o que já está aqui;
//   - frase que falhou não fica no cache (a próxima chamada tenta de novo).
const NARRATION_CACHE_MS = 6 * 60 * 60 * 1000;
const NARRATION_BUDGET_MS = 35 * 1000;
export const NARRATION_MAX_IDS = 6;
const narrationPhraseCache = new Map();
const shortSpeechCache = new Map();

function rememberBounded(map, key, value, max) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

export function henryNarrationVoiceKey(style) {
  const provider = henryVoiceProvider();
  return provider === "browser" ? "" : narrationVoiceKey(style, provider);
}

function narrationBundle() {
  return [...HENRY_ACK_ITEMS, ...HENRY_WAIT_PHRASES, ...HENRY_GOODBYES.map((text, index) => ({ id: `g${index + 1}`, text, topics: ["bye"] }))];
}

function narrationPhraseAudio(auth, style, voiceKey, phrase) {
  const key = `${voiceKey}|${phrase.id}|${phrase.text}`;
  const hit = narrationPhraseCache.get(key);
  if (hit && Date.now() - hit.at < NARRATION_CACHE_MS) return hit.promise;
  const promise = synthesizeHenrySpeech(auth, phrase.text, style, { primaryOnly: true }).catch(() => null);
  rememberBounded(narrationPhraseCache, key, { at: Date.now(), promise }, 600);
  promise.then((audio) => {
    if (!audio && narrationPhraseCache.get(key)?.promise === promise) narrationPhraseCache.delete(key);
  });
  return promise;
}

export async function getHenryNarration(auth, style, { ids = null } = {}) {
  const voiceKey = henryNarrationVoiceKey(style);
  if (!voiceKey) return { voiceKey: "", phrases: [] };
  const bundle = narrationBundle();
  const wanted = Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === "string").slice(0, NARRATION_MAX_IDS)) : null;
  const list = wanted ? bundle.filter((phrase) => wanted.has(phrase.id)) : bundle;
  const startedAt = Date.now();
  const phrases = [];
  // Duas por vez: não estoura o limite de pedidos simultâneos do plano da ElevenLabs.
  for (let index = 0; index < list.length; index += 2) {
    if (!wanted && Date.now() - startedAt > NARRATION_BUDGET_MS) break; // o resto vem no pré-aquecimento da tela
    const batch = list.slice(index, index + 2);
    const audios = await Promise.all(batch.map((phrase) => narrationPhraseAudio(auth, style, voiceKey, phrase)));
    batch.forEach((phrase, position) => {
      const audio = audios[position];
      if (audio) phrases.push({ id: phrase.id, text: phrase.text, topics: phrase.topics, audio: { base64: audio.base64, contentType: audio.contentType } });
    });
  }
  return { voiceKey, phrases };
}

// Frase curta com o nome do corretor ("Consultando a Carol."): sintetizada na hora, guardada por voz+texto(+perfil).
// profile = "call": chamado do aviso (cada variante sintetizada uma vez por voz e guardada, como as frases de espera).
export async function synthesizeHenryShort(auth, text, style, { profile = "" } = {}) {
  const voiceKey = henryNarrationVoiceKey(style);
  if (!voiceKey || !text) return null;
  const key = `${voiceKey}|${profile}|${text}`;
  const hit = shortSpeechCache.get(key);
  if (hit && Date.now() - hit.at < NARRATION_CACHE_MS) return hit.promise;
  const promise = synthesizeHenrySpeech(auth, text, style, { primaryOnly: true, profile }).catch(() => null);
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
    if (!response.ok) throw await elevenLabsFailure(response, "stt");
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
