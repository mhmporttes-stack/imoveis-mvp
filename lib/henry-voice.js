import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { makeBrokerMatcher, normalizeName } from "./alexa-v2/brokers.mjs";
import { answerQuery, buildQuery } from "./alexa-v2/router.mjs";
import { TOPIC_IDS } from "./alexa-v2/catalog.mjs";
import { ETAPAS, ETAPA_IDS } from "./alexa-v2/catalog-etapas.mjs";
import { PERIOD_IDS } from "./alexa-v2/periods.mjs";
import { sanitizeSpeech } from "./alexa-v2/sanitize.mjs";
import { firstName, saoPauloDateKey, saoPauloNow } from "./alexa-config-core.mjs";
import { planHenryVocabulary, vocabularyUsage } from "./henry-voice-lexicon.mjs";
import { openingSentencesFrom, trimCasualOffer, trimRepeatedClosing, trimRepeatedOpening, trimTrailingOffer } from "./henry-repetition-core.mjs";
import { buildHenryAlertNote, henryClientAlertsFromSetting, henryTeamArrivalsFromSetting, henryVoiceNoticesFromSetting } from "./henry-voice-client-alerts-core.mjs";
import { BIRTHDAY_ALERT_STEP, henryBirthdayAlertsFromSetting } from "./henry-birthday-alerts-core.mjs";
import { loadTodayBirthdays, prepareBirthdayConfirmation } from "./henry-birthday-alerts";
import { sendHenryTeamAlert } from "./henry-team-alert";
import { isTeamAlertRequest } from "./henry-team-alert-core.mjs";
import { approveMarketplaceByHenry } from "./henry-marketplace-approval";
import { buildHenryAwaySentence, isMarketplaceApprovalCommand } from "./henry-away-core.mjs";
import { HENRY_LOCK_DONE_PHRASES, HENRY_LOCKED_PHRASES, buildHenryLockNote, isHenryToolLocked } from "./henry-lock-core.mjs";
import { henryPulseFromSetting } from "./henry-pulse-core.mjs";
import { HENRY_TRAINING_FEATURE, HENRY_TRAINING_SANDBOX_KEYS, parseTrainingSandbox } from "./henry-training-core.mjs";
import { normalizeSpotifyCommand, simulatedSpotifyDeviceTool, spotifyControlLine, spotifyVolumeLine } from "./henry-spotify-core.mjs";
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
  sanitizeHistory,
  withReportIntro,
  HENRY_CUT_REPLY_RETRY,
  HENRY_BARRED_CASUAL_RETRY,
  isBarredForSpeech,
  isCrmQuestion,
  isCutReply
} from "./henry-voice-core.mjs";
import { buildHenryStylePrompt, buildHenryTtsInstructions, henryAddressName, henrySampleText, mergeHenryStyle, resolveHenryStyle } from "./henry-voice-style.mjs";
import {
  ELEVENLABS_API,
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_STT_MODEL,
  ELEVENLABS_STT_REALTIME_MODEL,
  buildElevenLabsRealtimeTokenRequest,
  buildElevenLabsRealtimeUrl,
  estimateElevenLabsRealtimeSttCostUsd,
  parseElevenLabsRealtimeToken,
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
import { HENRY_BROKER_METRIC_IDS, HENRY_COMPARE_METRIC_IDS, HENRY_FUNNEL_SEGMENT_IDS, HENRY_PERIOD_IDS, buildHenryFunnelSegmentReport, buildHenryBrokerComparison, buildHenryBrokerReport, buildHenryNewClientsAnswer, buildHenryFunnelReport, buildHenryRankingReport, buildHenryStageReasonsReport, buildHenryStageWaitingReport, buildHenryTeamGoalSizeSpeech, buildHenryTeamGoalSpeech, buildHenryStaleClientsSpeech, henryBottleneckPlan, henryBottleneckStage, henryClientQueries, henryStaleNote, buildHenryPeriodReport, henryPeriodFromText, henryReportKind, previousHenryPeriod, resolveHenryPeriod } from "./henry-reports-core.mjs";
import { findHenryClientsByName, loadHenryAwaiting, loadHenryBrokerCards, loadHenryClientConversation, loadHenryFinance, loadHenryFunnelSegment, loadHenryLeadOrigins, loadHenryOverview, loadHenryOwnerMetaToday, loadHenryPresence, loadHenryProperties, loadHenryStageClients, loadHenryStageCounts, loadHenryStageReasons, loadHenryTeamGoal, searchHenryClientsMany } from "./henry-reports";
import { henryAgreementReply, henryAlreadyOpenReply, henryBareComplaintReply, henryComplaintFallbackHint, henryComplaintFallbackRequest, henryDeepenHint, henryDeepenRequest, henryDeepenSpeech, henryDiagnosisDeepenRequest, henryDropRepeatedBottleneck, henryScreenOpenRequest, henryShortenedReply, henryFarewellReply, henryRepeatSummaryReply, isBareHenryComplaint, isHenryShortenRequest, henryClaimedActionWithoutTool, henryClaimedLookupWithoutTool, henryPendingFollowUp, henryPendingHint, henryScreenDeflection, HENRY_DEFLECT_RETRY, henryPlaceClientReply, isHenryPlanRequest, stripInternalTalk, henryDirectRoute, henryGreetingReply, henryResumeTopic, isHenryDiagnosisQuestion, henryPromiseRetry, henryPromisedAction, henryQuestionPart, henryRepeatedAfterComplaint, henryTurnHint, henryUnansweredRetry, isCasualRequest, isHenryAgreement, isHenryComplaint, isPersonalQuestion, isVagueClientReference, pickComplaintReply, replyAnswersQuestion, stripSpeechLabel } from "./henry-voice-turn.mjs";
import { decideClientOpen, isAcceptance, offeredToOpen } from "./henry-navigation-core.mjs";
import { HENRY_AREAS, HENRY_AREA_IDS, HENRY_AREA_PERIOD_IDS, resolveAreaPeriod } from "./henry-areas-core.mjs";
import { HENRY_SUBSTATUS, HENRY_SUBSTATUS_IDS, buildHenryStageCountReport, henryStageStatuses, resolveHenryStageRequest } from "./henry-stage-counts-core.mjs";
import { loadHenryArea } from "./henry-areas";
import { readHenryNowPlaying, readHenrySpotifyTaste, readSpotifyStatus, runHenrySpotifyDeviceTool, runHenrySpotifyTool, startHenryMorningMusic } from "./henry-spotify";
import { loadHenryMorningExtras } from "./henry-morning";
import {
  MORNING_STYLE_QUESTION,
  birthdayDraft,
  birthdayQuestion,
  MORNING_GENRES,
  classifyMorningMusicReply,
  classifyMorningStyle,
  classifyYesNo,
  composeMorningExtras,
  dropReportGreeting,
  dropNightClosing,
  MORNING_ALREADY_PLAYING,
  morningMusicChangeLine,
  morningMusicPrefix,
  morningOpening,
  parseMorningState
} from "./henry-morning-core.mjs";
import {
  MORNING_MUSIC_SETTING_ID,
  isOtherMusicRequest,
  morningArtistTarget,
  morningConfirmLine,
  morningGenreTarget,
  morningSuggestionHistory,
  morningSuggestionMatchesGenre,
  morningSuggestionLine,
  morningStyleAcceptLine,
  morningStyleFallbacks,
  morningSuggestionTarget,
  rememberMorningConfirm,
  pickMorningSuggestion,
  rememberMorningSuggestion,
  todaysMorningConfirm,
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
import { composePositiveDailyFacts, greetingOf, hasPositiveContent, isTodayRange, pickSlowDayPhrase, positiveSpeech, wantsPositiveSummary } from "./henry-reports-positive-core.mjs";
import {
  HENRY_DAY_MEMORY_SETTING_ID,
  HENRY_NOTES_SETTING_ID,
  MEMORY_REPLIES,
  addNote,
  appendDayTurns,
  dayLexiconState,
  dayTurns,
  modelHistoryFromDay,
  casualModelHistory,
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
const MUSIC_TOOL_NAMES = new Set(["spotify", "mudar_aparelho_spotify"]);
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
  // Modo treino: a próxima troca da rodada precisa ver a memória desta → a rodada espera (flushHenryTraining).
  const training = trainingStore.getStore();
  if (training) {
    training.pending.push(Promise.resolve(promise).catch(() => null));
    return;
  }
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

// --- Modo treino (dono, 2026-10-24 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", lib/henry-training-core.mjs) ---------
// Rodada de treino = o MESMO answerHenry, dentro deste contexto: memória do dia, lembretes, sugestão de música e elogios
// vivem só na memória da rodada (`settings`, devolvida ao navegador entre um cenário e outro); qualquer outra gravação em
// crm_settings é ignorada; música e troca de aparelho do Spotify são simuladas (nada toca); custo em ai_usage_log com a
// origem henry_training (somado em `costUsd`). Ferramentas de leitura do CRM rodam de verdade.
const trainingStore = new AsyncLocalStorage();
const TRAINING_SANDBOXED_SETTINGS = new Set(HENRY_TRAINING_SANDBOX_KEYS);

export async function withHenryTraining(sandbox, fn) {
  const store = { settings: parseTrainingSandbox(sandbox), pending: [], costUsd: 0 };
  return trainingStore.run(store, async () => {
    try {
      const result = await fn();
      return { result, sandbox: store.settings, costUsd: store.costUsd };
    } finally {
      await flushHenryTraining();
    }
  });
}

// Espera as gravações da troca anterior (memória do dia da rodada, custo) antes da próxima.
export async function flushHenryTraining() {
  const store = trainingStore.getStore();
  if (!store) return;
  while (store.pending.length) await Promise.all(store.pending.splice(0));
}

// Dono simulado (modelo barato, mesma chamada à Anthropic do Henry): devolve o texto cru (limpo em cleanTrainingOwnerLine).
export async function askHenryTrainingOwner(auth, { system, user }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
  try {
    const data = await callAnthropic({ max_tokens: 80, system, messages: [{ role: "user", content: user }] });
    sumUsage(usage, data);
    logModelUsage(auth, HENRY_TRAINING_FEATURE, usage);
    return (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
  } catch (error) {
    if (usage.inputTokens) logModelUsage(auth, HENRY_TRAINING_FEATURE, usage, { success: false, errorMessage: error?.message });
    throw error;
  }
}

// --- Liga/desliga (crm_settings): Henry nasce LIGADO; a visão (webcam) nasce DESLIGADA ---------------------------------
async function readSettingRow(id) {
  const training = trainingStore.getStore();
  if (training && TRAINING_SANDBOXED_SETTINGS.has(id)) {
    // Memória do dia começa VAZIA na rodada (dia novo); lembretes/música começam dos reais (leitura) até a rodada mudar.
    if (Object.hasOwn(training.settings, id)) return structuredClone(training.settings[id]);
    if (id === HENRY_DAY_MEMORY_SETTING_ID) return {};
  }
  const { data, error } = await getSupabaseAdminClient().from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.setting_value || {};
}

async function writeSettingRow(auth, id, value) {
  const training = trainingStore.getStore();
  if (training) {
    if (TRAINING_SANDBOXED_SETTINGS.has(id)) training.settings[id] = structuredClone(value);
    return;
  }
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
// turns = trocas de hoje: as aberturas já faladas saem do repertório por SEMELHANÇA (dono, 2026-10-25).
function planVocabulary(mode, question, lexicon, turns = []) {
  const hour = Math.floor(saoPauloNow().minutes / 60);
  return { ...planHenryVocabulary({ mode, question, state: lexicon, hour, saidOpenings: openingSentencesFrom(turns) }), hint: pickDayHint(lexicon.hints) };
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

// Aviso de cliente novo/transferido falado (lib/henry-voice-client-alerts.js): vai para a memória do dia como uma troca
// (contexto com o nome completo + o que foi falado), para "ela/ele" da pergunta seguinte ter a quem se referir. Mesma
// escrita única da memória do dia (henry_day_memory) — nenhuma outra escrita do Henry.
export function rememberHenryAlert(auth, context, spoken) {
  if (!context || !spoken) return;
  rememberExchange(auth, context, spoken);
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
  return { enabled: henryEnabledFromSetting(value), vision: henryVisionFromSetting(value), webSearch: henryWebSearchFromSetting(value), mobileWake: value.mobileWake === true, clientAlerts: henryClientAlertsFromSetting(value), teamArrivals: henryTeamArrivalsFromSetting(value), voiceNotices: henryVoiceNoticesFromSetting(value), birthdayAlerts: henryBirthdayAlertsFromSetting(value), pulse: henryPulseFromSetting(value), style: resolveStyle(value.style) };
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
  if (typeof patch.birthdayAlerts === "boolean") next.birthdayAlerts = patch.birthdayAlerts; // "Avisar aniversariantes" (nasce ligado)
  // Pulso do CRM (rascunho HENRY-1 "Pulso"): patch já validado por parseHenryPulsePatch; o resto do pulso é preservado.
  if (patch.pulse) next.pulse = { ...(current.pulse && typeof current.pulse === "object" ? current.pulse : {}), ...patch.pulse };
  if (patch.style) next.style = mergeHenryStyle(current.style, patch.style);
  await writeSettingRow(auth, HENRY_SETTING_ID, next);
  return { enabled: henryEnabledFromSetting(next), vision: henryVisionFromSetting(next), webSearch: henryWebSearchFromSetting(next), mobileWake: next.mobileWake === true, clientAlerts: henryClientAlertsFromSetting(next), teamArrivals: henryTeamArrivalsFromSetting(next), voiceNotices: henryVoiceNoticesFromSetting(next), birthdayAlerts: henryBirthdayAlertsFromSetting(next), pulse: henryPulseFromSetting(next), style: resolveStyle(next.style) };
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
    // Meta do dia do pré-cálculo recente (Treino 4: ~9 s na hora); a mesma conta da tela (loadHenryOwnerMetaToday).
    const owner = await withTimeout(getPainelInicioDono(auth, inicioPromise, { loadMeta: () => loadHenryOwnerMetaToday(auth) }), OWNER_SUMMARY_TIMEOUT_MS).catch((error) => {
      console.warn(`[henry] resumo do dono indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}); usando o do Início.`);
      return null;
    });
    return { inicio: await inicioPromise, ownerText: owner?.text || "", ownerRows: Array.isArray(owner?.rows) ? owner.rows : null };
  });
}

// Pré-aquecimento: números do relatório + lista de corretores (usada para entender "e da Carol?") no cache curto.
export async function warmHenryReport(auth) {
  await Promise.all([loadReportSources(auth), cachedRead("brokers", () => loadBrokerList()).catch(() => [])]);
}

// positive (resumo — dono, 2026-10-24): só o que foi bom; pergunta direta ("quantos aguardam documentos?") → texto completo.
async function buildDailyReport(auth, { positive = false, turns = [] } = {}) {
  const { inicio, ownerText, ownerRows } = await loadReportSources(auth);
  const full = composeHenryDailyReport(inicio, { ownerText });
  if (!positive || !full) return full;
  const facts = composePositiveDailyFacts({ leadsToday: inicio?.kpis?.leadsToday?.total ?? null, rows: ownerRows });
  const text = facts.positive ? facts.text : pickSlowDayPhrase({ today: true, turns });
  return JSON.stringify({ sugestao_de_fala: text, ...positiveInstruction(true, !facts.positive) });
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
      "aprovações, conversão, desempenho, ranking, pontos, resumo e métricas por corretor). Devolve uma frase pronta com os números da tela. " +
      "Clientes por etapa, parados/sem contato (sem_contato; 'quem está parado há mais tempo' = formato lista), sem atendimento e fila da roleta são os de AGORA (sem período). Etapa com formato lista, da equipe: vem quantos são e os mais antigos na etapa.",
    input_schema: {
      type: "object",
      properties: {
        assunto: { type: "string", enum: TOPIC_IDS, description: "Assunto do catálogo. 'etapa' exige o campo etapa; assuntos de um corretor exigem corretor." },
        periodo: { type: "string", enum: PERIOD_IDS, description: "Período; padrão hoje." },
        formato: { type: "string", enum: ["numero", "lista"], description: "numero = quantidade; lista = nomes." },
        etapa: { type: "string", enum: ETAPA_IDS, description: "Etapa = aba da tela Clientes (simulacao = aba Simulação inteira: aguardando simulação, simulação automática, realizada e enviada)." },
        situacao: { type: "string", enum: HENRY_SUBSTATUS_IDS, description: "Só no assunto etapa: o sub-status da tela Clientes quando ele disser um (" + HENRY_SUBSTATUS.slice(0, 6).map((item) => `${item.id} = ${item.label}`).join("; ") + "…)." },
        corretor: { type: "string", description: "Nome do corretor como foi falado." },
        outro_corretor: { type: "string", description: "Segundo corretor, só para o assunto 'comparar'." },
        detalhe: { type: "string", enum: ["tamanho"], description: "Só em meta_equipe: 'tamanho' = quantas ações a meta do dia soma (equipe e por corretor), quantas já foram feitas e quantas faltam ('quanto a equipe precisa fazer por dia pra bater a meta?')." }
      },
      required: ["assunto"]
    }
  },
  {
    name: "relatorio_do_dia",
    description: "Resumo do dia da tela Início do dono: clientes novos de hoje (lead = cliente novo, um número só), clientes aguardando resposta (e quem espera há mais tempo), simulações a conferir, atividades atrasadas e clientes aguardando documentos.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "clientes_esfriados_pendentes",
    description: "Quantos casos de clientes frios aguardam a decisão do dono (caixinha 'Clientes frios' do cabeçalho). Na fala, diga 'cliente frio', nunca 'esfriado'.",
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
      "Relatório de um PERÍODO (semanal, mensal, últimos 7/15/30/90 dias, semana/mês passado, intervalo de datas): clientes novos por origem (lead = cliente novo), " +
      "funil (atendimento, simulação, documentação, aprovação, venda), ranking e pontos por corretor, Meta Diária da equipe, clientes " +
      "aguardando resposta e clientes frios agora, e comparação com o período anterior. Use para qualquer pergunta de período além de hoje/ontem " +
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
    name: "ranking_periodo",
    description:
      "Ranking/pontuação dos corretores num PERÍODO além de hoje/ontem (esta semana, semana passada, este mês, mês passado, " +
      "últimos N dias, intervalo de datas): quem lidera e os pontos. Mesmos números da tela de Desempenho/Pontuação. " +
      "Ranking de hoje ou ontem continua no consultar_crm.",
    input_schema: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "Padrão: esta_semana. intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      }
    }
  },
  {
    name: "comparar_corretores",
    description:
      "Compara TODOS os corretores numa métrica e num período e devolve do maior para o menor (ou do menor para o maior): " +
      "'qual corretor mais fez simulações nos últimos 30 dias?', 'quem mais vendeu no mês?', 'quem menos atendeu hoje?', " +
      "'olha os corretores um por um e me diz quem mais…'. Mesmos números do Desempenho por corretor (os mesmos do consultar_corretor). " +
      "A tabela completa aparece sozinha na tela.",
    input_schema: {
      type: "object",
      properties: {
        metrica: { type: "string", enum: HENRY_COMPARE_METRIC_IDS, description: "O indicador comparado (simulações = simulacoes, clientes novos recebidos = novos_clientes)." },
        ordem: { type: "string", enum: ["mais", "menos"], description: "mais = quem mais fez (padrão); menos = quem menos fez." },
        posicao: { type: "integer", minimum: 1, maximum: 10, description: "Só quando ele perguntar uma posição ('quem ficou em segundo?' = 2): fala quem está nela." },
        seguintes: { type: "boolean", description: "Só em 'e os outros?' depois de saber quem liderou: fala quem vem depois." },
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "Período dito (ou o da conversa). Padrão: este_mes. intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      },
      required: ["metrica"]
    }
  },
  {
    name: "funil_periodo",
    description:
      "Funil de um PERÍODO além de hoje/ontem (esta semana, semana passada, este mês, mês passado, últimos N dias, intervalo): " +
      "clientes no funil, atendimentos, simulações, documentação, enviados para aprovação, aprovados e vendas — o mesmo funil da tela " +
      "de Desempenho. Funil de hoje/ontem (quantos clientes em cada etapa agora) continua no consultar_crm.",
    input_schema: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "Padrão: este_mes. intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      }
    }
  },
  {
    name: "funil_recorte",
    description:
      "ORIGEM (por onde entraram) de um RECORTE do funil de um período: os atendidos que NÃO viraram simulação (sem_simulacao), " +
      "os que viraram (com_simulacao) ou todos os atendidos. Mesmos números do funil_periodo (atendidos − simulações = os que não " +
      "viraram). Use para 'qual a origem desses 63 que não viraram simulação?', 'de onde vieram os que não fizeram simulação?', " +
      "'por onde entraram os que viraram simulação?'. Devolve quantos por origem (prospecção, Marketplace, WhatsApp pessoal, link " +
      "pessoal, anúncio, campanha, site, cadastro manual…) e a lista por origem aparece sozinha na tela.",
    input_schema: {
      type: "object",
      properties: {
        recorte: { type: "string", enum: HENRY_FUNNEL_SEGMENT_IDS, description: "sem_simulacao = atendidos que não viraram simulação; com_simulacao = viraram; atendidos = todos os atendidos." },
        periodo: { type: "string", enum: HENRY_PERIOD_IDS, description: "O período da conversa (o mesmo do funil/atendimentos falado antes). intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." }
      },
      required: ["recorte"]
    }
  },
  {
    name: "buscar_imoveis",
    description:
      "Imóveis e empreendimentos cadastrados no CRM (telas Imóveis e Empreendimentos): nome, tipo, construtora, local, quartos, " +
      "entrega e situação. Com 'busca' (nome, bairro, construtora ou código) acha o imóvel; sem busca, devolve quantos há e alguns " +
      "nomes para perguntar qual. Preço só aparece na tela.",
    input_schema: {
      type: "object",
      properties: {
        busca: { type: "string", description: "Nome, bairro, construtora ou código como ele falou; vazio quando ele não disse qual." },
        tipo: { type: "string", enum: ["imovel", "empreendimento"], description: "Só quando ele disser imóvel ou empreendimento." }
      }
    }
  },
  {
    name: "consultar_area",
    description:
      "Lê QUALQUER outra área do CRM pelas mesmas telas (acesso total, só leitura). Use quando a pergunta não for das outras ferramentas: " +
      HENRY_AREA_IDS.map((id) => `${id} = ${HENRY_AREAS[id].descricao}`).join("; ") +
      ". Devolve a sugestão de fala e os números; o detalhe completo aparece sozinho na tela.",
    input_schema: {
      type: "object",
      properties: {
        area: { type: "string", enum: HENRY_AREA_IDS, description: "A área do CRM perguntada." },
        periodo: { type: "string", enum: HENRY_AREA_PERIOD_IDS, description: "Período dito; sem período, o padrão da área. Agenda aceita futuro (amanha, proximos_7_dias, proxima_semana, proximos_30_dias). intervalo exige inicio e fim." },
        inicio: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        fim: { type: "string", description: "AAAA-MM-DD (só com periodo=intervalo)." },
        corretor: { type: "string", description: "Só quando ele falar de UM corretor/pessoa da equipe, como foi falado." },
        cliente: { type: "string", description: "Nome do cliente (obrigatório em historico_cliente)." },
        busca: { type: "string", description: "Em etiquetas: o nome da etiqueta perguntada." }
      },
      required: ["area"]
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
      "último contato/atendimento, próxima atividade, simulação (feita/enviada), documentos, análise da CCA, origem, as 3 últimas movimentações " +
      "e em qual WhatsApp está a conversa (whatsapp: número oficial ou WhatsApp pessoal de quem, Número 1 ou 2, e de quem foi a última mensagem). " +
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
    name: "aniversariantes_hoje",
    description:
      "Lista os clientes que fazem aniversário HOJE (mesma regra da Agenda), com o corretor responsável e se o cliente é do " +
      "próprio Matheus. Use quando ele perguntar quem faz aniversário hoje.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "avisar_corretor_aniversario",
    description:
      "Prepara NA TELA o aviso interno ao corretor responsável de que o cliente faz aniversário hoje (e, se o cliente for do " +
      "Matheus, o rascunho da mensagem para ele mesmo enviar). NÃO envia nada: o aviso só sai quando ele confirmar no botão da " +
      "tela. Use quando ele pedir para avisar o corretor do aniversário ou preparar a mensagem de aniversário.",
    input_schema: {
      type: "object",
      properties: { cliente: { type: "string", description: "Primeiro nome do cliente, se ele disser; vazio = todos os aniversariantes de hoje." } }
    }
  },
  {
    name: "enviar_alerta_corretor",
    description:
      "ENVIA na hora um recado interno a uma pessoa ATIVA da equipe (corretor, associado ou gestor; nunca cliente): a mesma " +
      "mensagem da Supervisão da Meta Diária, que fica fixada no meio da tela dela até ela dar OK ou responder, com aviso no " +
      "celular. Use quando ele pedir \"peça/pede para a Carol…\", \"chama o Gabriel\", \"avisa a Bruna que…\", \"manda um recado " +
      "pro…\". Envia direto, sem perguntar se pode (decisão do Matheus). O texto é curto, para a pessoa ler, falando do Matheus " +
      "na 3ª pessoa (ex.: \"O Matheus pediu para você ir até a sala dele.\"); se ele ditou o texto, use o dele com correção leve. " +
      "Se a ferramenta devolver várias pessoas, pergunte qual e chame de novo com o nome escolhido.",
    input_schema: {
      type: "object",
      properties: {
        destinatario: { type: "string", description: "Nome da pessoa da equipe como ele falou (ex.: Carol, Gabriel Souza)." },
        texto: { type: "string", description: "O recado pronto para a pessoa ler, curto (até 2 frases)." }
      },
      required: ["destinatario", "texto"]
    }
  },
  {
    name: "aprovar_atendimento_marketplace",
    description:
      "LIBERA na hora o atendimento de clientes do Marketplace que chegaram com a extensão desligada e escreveram algo " +
      "diferente de \"esse item ainda está disponível?\" — eles ficam aguardando a aprovação do Matheus e, aprovados, vão " +
      "para a roleta dos corretores (ou a fila, se ninguém estiver liberado). Use quando ele disser \"pode atender\", " +
      "\"aprova\", \"libera\" sobre esses clientes. Sem nome = todos os que aguardam; com nome = só aquele cliente.",
    input_schema: {
      type: "object",
      properties: { cliente: { type: "string", description: "Primeiro nome do cliente, se ele disser; vazio = todos os que aguardam aprovação." } }
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
// Dado do cache fora da validade: a frase crua da Alexa ("Última atualização há N minutos.") NÃO entra (Treino 4, 2026-10-25:
// saía duplicada na meta da equipe); a idade fica em context.staleMinutes e consultar_crm põe UMA menção natural só acima de
// 1 hora (henryStaleNote). full = também os dados do provedor (frase própria do Henry, ex.: meta da equipe).
// Ferramentas de período do Henry (Treino 5): nunca "só consigo ver de hoje e de ontem".
const HENRY_PERIOD_TOOLS_NOTE = "Esse assunto no consultar_crm é só de hoje/ontem, mas você TEM os outros períodos: funil_periodo (funil, aprovados, vendas), ranking_periodo (ranking/pontos), relatorio_periodo (clientes novos, Meta Diária e o resto), consultar_corretor (um corretor) e comparar_corretores (quem mais/menos). Chame a ferramenta certa agora; nunca diga que só consegue ver hoje e ontem.";
const HENRY_CATALOG_RETRY_NOTE = "Essa combinação de assunto e campos não existe no consultar_crm. Escolha o assunto certo (meta da equipe = meta_equipe; bateu/quanto falta = meta_equipe com detalhe tamanho; etapa exige o campo etapa; de um corretor exige corretor) ou a ferramenta certa e chame de novo. Nunca fale de ferramenta, consulta ou sistema para ele; se não der, diga só que não conseguiu ver isso agora.";
async function consultCatalog(input, context, { full = false } = {}) {
  const assunto = TOPIC_IDS.includes(input?.assunto) ? input.assunto : "";
  if (!assunto) return full ? { text: "Assunto desconhecido.", data: null } : "Assunto desconhecido.";
  await brokerMatcher(context);
  const deps = {
    providers: getV2Providers(),
    brokers: context.brokers,
    today: () => saoPauloDateKey(),
    timeoutMs: TOOL_TIMEOUT_MS,
    staleText: (minutes) => {
      context.staleMinutes = Math.max(Number(context.staleMinutes) || 0, Number(minutes) || 0);
      return "";
    },
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
  if (!built.ok) {
    // Recusa de período do catálogo da Alexa ("Isso eu só sei para hoje e ontem."): o Henry TEM ferramentas de período
    // (Treino 5: virava "só consigo ver de hoje e de ontem") — vai uma instrução ao modelo, nunca a frase da Alexa.
    if (/^isso eu s[oó] sei para\b/i.test(String(built.speech || ""))) {
      const text = JSON.stringify({ instrucao: HENRY_PERIOD_TOOLS_NOTE });
      return full ? { text, data: null } : text;
    }
    // "Não entendi." do catálogo (combinação de assunto/campos que não existe) virava "A ferramenta não entendeu essa
    // consulta" na fala (Treino 8): vai uma instrução ao modelo, nunca a frase crua.
    if (!built.speech || /^n[aã]o entendi\.?$/i.test(String(built.speech).trim())) {
      const text = JSON.stringify({ instrucao: HENRY_CATALOG_RETRY_NOTE });
      return full ? { text, data: null } : text;
    }
    const text = sanitizeSpeech(built.speech);
    return full ? { text, data: null } : text;
  }
  const answered = await answerQuery(built.q, deps, built.note || "");
  const text = sanitizeSpeech(answered.text);
  return full ? { text, data: answered.failed ? null : answered.data || null } : text;
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
  // Resumo positivo (dono, 2026-10-24): fala só o que foi bom; pergunta direta de uma métrica → números completos.
  const positive = wantsPositiveSummary(context.question);
  const report = buildHenryPeriodReport({
    positive,
    slowDayPhrase: positive ? pickSlowDayPhrase({ today: isTodayRange(range), turns: context.dayTurns }) : "",
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
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts, ...positiveInstruction(positive, report.weak) });
}

// Ranking de um período (Treino, 2026-10-25): leitura do mesmo overview do relatório do período (cache curto).
async function runRankingPeriod(input, auth, context) {
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "esta_semana" }), saoPauloDateKey());
  const report = buildHenryRankingReport({ range, overview: await softRead("ranking do período", readOverviewFor(auth, range)) });
  if (!report) return "Não consegui buscar o ranking desse período agora.";
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

// Comparação entre corretores (dono, 2026-10-25: "qual corretor mais realizou simulações?" → não conseguiu): o MESMO
// overview do consultar_corretor (Desempenho por corretor), ordenado por uma métrica — os números batem com os individuais.
async function runBrokerComparison(input, auth, context) {
  const metric = String(input?.metrica || "");
  if (!HENRY_COMPARE_METRIC_IDS.includes(metric)) return `Diga qual indicador comparar: ${HENRY_COMPARE_METRIC_IDS.join(", ")}.`;
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "este_mes" }), saoPauloDateKey());
  const report = buildHenryBrokerComparison({ range, overview: await softRead("comparação dos corretores", readOverviewFor(auth, range)), metric, order: input?.ordem === "menos" ? "menos" : "mais", position: Number.isInteger(input?.posicao) ? input.posicao : null, others: input?.seguintes === true });
  if (!report) return "Não consegui comparar os corretores agora.";
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

// Funil de um período (Treino 2, 2026-10-25: "como tá o funil desse mês?" → "só consigo ver de hoje ou de ontem"): o
// funil do Desempenho (FUNIL-PAINEL, docs/METRICAS_FUNIL.md MET-4) do mesmo overview do relatório do período.
async function runFunnelPeriod(input, auth, context) {
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "este_mes" }), saoPauloDateKey());
  // Plano ("cadê o plano pra subir essa taxa?", Treino 8): o gargalo + 2 ações práticas (henryBottleneckPlan); com quem
  // está parado na etapa de cima do gargalo AGORA (loadHenryStageClients, mesma leitura do "e os vinte esperando?").
  // directTopic = o assunto da rota direta desta fala (a mesma leitura; vale mesmo sem a memória do dia).
  const plan = context.directTopic === "plano" || isHenryPlanRequest(context.question, context.dayTurns);
  // Funil pedido pela rota direta ("me fala do funil", Treino 9): as etapas e o gargalo numa frase curta no fim (sem
  // perguntar se ele quer) — é pergunta do funil, não resumo de desempenho.
  const funnelAsked = !plan && context.directTopic === "funil";
  const positive = !plan && !funnelAsked && wantsPositiveSummary(context.question);
  const report = buildHenryFunnelReport({
    bottleneckLine: funnelAsked,
    range,
    overview: await softRead("funil do período", readOverviewFor(auth, range)),
    // Pergunta de gargalo ("onde a gente tá errando?", "não fecha"): a fala é o gargalo calculado (Treino 7).
    diagnosis: plan || context.directTopic === "diagnostico" || isHenryDiagnosisQuestion(context.question),
    positive,
    slowDayPhrase: positive ? pickSlowDayPhrase({ today: isTodayRange(range), turns: context.dayTurns }) : ""
  });
  if (!report) return "Não consegui buscar o funil desse período agora.";
  context.detail = report.detail;
  if (plan) {
    const gargalo = report.facts?.gargalo && typeof report.facts.gargalo === "object" ? report.facts.gargalo : null;
    const etapa = henryBottleneckStage(gargalo);
    const stage = etapa ? await softRead("clientes da etapa", cachedRead(`stage:${auth?.profile?.id || ""}:${etapa}`, () => loadHenryStageClients(auth, etapa))) : null;
    const planned = henryBottleneckPlan(gargalo, stage);
    return JSON.stringify({ sugestao_de_fala: planned.spoken, numeros: report.facts, plano: planned.acoes, instrucao: "Plano pedido: diga o gargalo e as 2 ações da sugestão, curtas; nunca invente número." });
  }
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts, ...positiveInstruction(positive, report.weak) });
}

// Recorte do funil por origem (dono, 2026-10-26: "Qual origem desses 63?" — os atendidos que não viraram simulação). Mesmo
// período e mesma definição do funil_periodo (getFunnelCohortStages); a fala = as 3 maiores origens, a lista na tela.
const readSegmentFor = (auth, range, segment) => cachedRead(`segment:${segment}:${periodKey(auth, range)}`, () => loadHenryFunnelSegment(auth, range, segment));
async function runFunnelSegment(input, auth, context) {
  const segment = HENRY_FUNNEL_SEGMENT_IDS.includes(input?.recorte) ? input.recorte : "sem_simulacao";
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "ultimos_7_dias" }), saoPauloDateKey());
  const data = await softRead("recorte do funil", readSegmentFor(auth, range, segment));
  if (!data) return "Não consegui separar esses clientes por origem agora.";
  const report = buildHenryFunnelSegmentReport({ range, segment, ...data });
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
}

// O catálogo da Alexa só tem ranking e funil de hoje/ontem ("Isso eu só sei para hoje ou ontem."). Pedido para outro
// período (no campo ou na pergunta: "ranking da semana", "funil desse mês") vai para runRankingPeriod/runFunnelPeriod —
// nunca para a recusa.
function catalogPeriodFor(query, question, assunto) {
  if (query?.assunto !== assunto) return null;
  const periodo = HENRY_PERIOD_IDS.includes(query.periodo) ? query.periodo : henryPeriodFromText(question, saoPauloDateKey())?.periodo;
  if (!periodo || periodo === "hoje" || periodo === "ontem") return null;
  return { periodo, ...(periodo === "intervalo" ? henryPeriodFromText(question, saoPauloDateKey()) : {}) };
}
const rankingPeriodFor = (query, question) => catalogPeriodFor(query, question, "ranking");
const STAGE_WAITING_IDS = new Set(["aprovados", "aprovacao", "documentacao", "simulacao"]);
// Etapas em que a lista "esperando" (loadHenryStageClients, ETAPA_STATUSES) tem os MESMOS status da aba da tela Clientes.
const HENRY_WAITING_LIST_IDS = new Set(["aprovados", "documentacao"]);

// Rota direta ("quantos o Gabriel tem aguardando simulação?" → etapa da equipe, sem corretor): o corretor dito na pergunta
// (nome inteiro, um só corretor; "equipe" na fala = da equipe).
function brokerNamedInQuestion(matcher, question) {
  const said = ` ${normalizeName(question)} `;
  if (!matcher || /\bequipe\b/.test(said)) return "";
  const found = matcher.entries.filter((entry) => entry.keys.some((key) => key && said.includes(` ${key} `)));
  return found.length === 1 ? found[0].name : "";
}

// Etapa/sub-status AGORA pelos contadores da tela Clientes (henry-stage-counts-core.mjs). Corretor falado e não achado →
// diz quem existe; leitura que falhou → "não consegui ver", nunca zero.
async function runStageCount(request, query, auth, context) {
  let broker = null;
  if (!query.corretor) {
    const named = brokerNamedInQuestion(await brokerMatcher(context), context.question);
    if (named) query = { ...query, corretor: named };
  }
  if (query.corretor) {
    const spoken = String(query.corretor).slice(0, 60);
    const match = await announceBroker(context, "consultar_crm", query, spoken);
    if (!match) return `Não achei o corretor "${spoken}". Corretores: ${(await brokerMatcher(context)).names.join(", ")}.`;
    broker = { id: match.id, name: match.name, gender: match.gender || "" };
  }
  const statuses = query.formato === "lista" ? henryStageStatuses(request) : null;
  const key = `stage-counts:${auth?.profile?.id || ""}:${broker?.id || ""}:${statuses ? statuses.join(",") : ""}`;
  const counters = await softRead("clientes por etapa", cachedRead(key, () => loadHenryStageCounts(auth, { brokerId: broker?.id || "", statuses })));
  const report = buildHenryStageCountReport({ request, counters, broker, rows: counters?.rows || null });
  if (!report) return broker ? `Não consegui ver os clientes de ${firstName(broker.name)} nessa etapa agora.` : "Não consegui ver os clientes dessa etapa agora.";
  if (broker) await announceBroker(context, "consultar_crm", query, String(query.corretor).slice(0, 60), { found: true }).catch(() => null);
  if (report.detail) context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts, instrucao: "Mesmos números da tela Clientes: diga a etapa e, se ele perguntou um sub-status, o número dele. Nunca diga zero se o número não veio." });
}
// Assuntos do catálogo que são a fotografia de AGORA (clientes por etapa, parados/sem contato, sem atendimento, fila da
// roleta, aguardando ação, atrasados): pedido com período longo ("há mais tempo", "este mês") vira o agora — nunca a recusa
// de período do catálogo, que o modelo lia como "esse assunto não está disponível" (Treino 6).
const NOW_CATALOG_TOPICS = new Set(["etapa", "sem_contato", "sem_atendimento", "fila_roleta", "acao_pendente", "atividades_atrasadas", "reunioes_atrasadas", "atencao"]);
const funnelPeriodFor = (query, question) => catalogPeriodFor(query, question, "funil");

async function runBrokerReport(input, auth, context) {
  const spoken = String(input?.corretor || "").slice(0, 60);
  // Números do período já começam a carregar junto com o reconhecimento do corretor (antes era um depois do outro).
  const range = resolveHenryPeriod(periodInput(input, context, { periodo: "este_mes" }), saoPauloDateKey());
  const started = Date.now();
  const metric = String(input?.metrica || "");
  // Mesma leitura (readOverviewFor: cache curto + pré-cálculo) do comparar_corretores. A Meta Diária do período só entra
  // quando a fala usa ela (resumo ou metrica "meta") — Treino 7: "quantas simulações o Eduardo rodou nos últimos 30 dias?"
  // esperava 9,3 s pela meta de 30 dias calculada na hora, que a resposta nem usa.
  const needsGoal = !HENRY_BROKER_METRIC_IDS.includes(metric) || metric === "meta";
  const numbers = Promise.all([softRead("desempenho do corretor", readOverviewFor(auth, range)), needsGoal ? softRead("meta do corretor", readTeamGoalFor(auth, range)) : null]);
  const match = await announceBroker(context, "consultar_corretor", input, spoken);
  if (!match) return `Não achei o corretor "${spoken}". Corretores: ${(await brokerMatcher(context)).names.join(", ")}.`;
  const [overview, teamGoal] = await numbers;
  console.info(`[henry] tempos consultar_corretor: ${Date.now() - started} ms (periodo=${range.id || "intervalo"}, meta=${needsGoal ? "sim" : "não"}).`);
  if (!overview && !teamGoal) return "Não consegui buscar os números desse corretor agora.";
  const positive = !metric && wantsPositiveSummary(context.question);
  const report = buildHenryBrokerReport({ broker: { id: match.id, name: match.name }, range, overview, teamGoal, metric, positive, slowDayPhrase: positive ? pickSlowDayPhrase({ today: isTodayRange(range), turns: context.dayTurns }) : "" });
  await announceBroker(context, "consultar_corretor", input, spoken, { found: true, stats: report.stats, position: report.position || null });
  context.detail = report.detail;
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts, ...positiveInstruction(positive && !metric, report.weak) });
}

// Resumo positivo (REGRA OFICIAL, dono 2026-10-24, HENRY-1): instrução que acompanha a sugestão de fala.
function positiveInstruction(positive, weak) {
  if (!positive) return { instrucao: "Pergunta direta: responda o número pedido, inclusive zero (ex.: \"Nenhuma simulação foi realizada hoje.\")." };
  if (weak) return { instrucao: "Resumo sem nada de bom para contar: fale só a frase de ânimo da sugestão, sem número e sem listar o que faltou." };
  return { instrucao: "Resumo de desempenho: fale só o que está na sugestão (o que foi bom), em tom animado; não fale zero, pendência, atraso nem cliente aguardando — isso fica na tela." };
}

// Assuntos do catálogo da Alexa que são RESUMO de desempenho: no Henry, a frase pronta passa pelo filtro positivo quando a
// pergunta é geral (a Alexa continua falando a frase completa).
const POSITIVE_CATALOG_TOPICS = new Set(["resumo", "desempenho", "equipe_resumo", "corretor_resumo", "funil"]);
function positiveCatalogAnswer(text, query, context) {
  if (!POSITIVE_CATALOG_TOPICS.has(query?.assunto) || query?.formato === "lista" || !wantsPositiveSummary(context.question)) return text;
  const kept = positiveSpeech(text);
  const weak = !hasPositiveContent(kept);
  const today = !query?.periodo || query.periodo === "hoje";
  const spoken = weak ? [greetingOf(kept), pickSlowDayPhrase({ today, turns: context.dayTurns })].filter(Boolean).join(" ") : kept;
  return JSON.stringify({ sugestao_de_fala: spoken, ...positiveInstruction(true, weak) });
}

async function runClientSearch(input, auth, context) {
  const queries = henryClientQueries(input);
  if (!queries.length) return "Diga o nome ou o telefone do cliente.";
  const withPhone = input?.incluir_telefone === true;
  const started = Date.now();
  // Nome repetido: desempate pelo que o Henry falou há pouco (Treino 6: a Jeniffer da lista dos aprovados, não a arquivada).
  const recentText = (Array.isArray(context.dayTurns) ? context.dayTurns : []).filter((turn) => turn?.role === "assistant" && turn.text).slice(-6).map((turn) => String(turn.text)).join("\n").slice(-2000);
  const key = `clients:${auth?.profile?.id || ""}:${JSON.stringify(queries)}:${withPhone ? 1 : 0}:${recentText.length}:${recentText.slice(-120)}`;
  const result = await withTimeout(cachedRead(key, () => searchHenryClientsMany(auth, queries, { withPhone, recentText })), CLIENT_TOOL_TIMEOUT_MS);
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

// Acesso total (REGRA OFICIAL do dono, 2026-10-26 — HENRY-1 "Leitura ampla"): as demais áreas do CRM pelas MESMAS funções das
// telas (lib/henry-areas.js; montagem em lib/henry-areas-core.mjs). Só leitura; cache curto de 45 s como as outras leituras.
async function runAreaTool(input, auth, context) {
  const area = HENRY_AREA_IDS.includes(input?.area) ? input.area : "";
  if (!area) return `Diga qual área: ${HENRY_AREA_IDS.join(", ")}.`;
  const range = resolveAreaPeriod(area, HENRY_AREA_PERIOD_IDS.includes(input?.periodo) ? input : { ...input, ...(henryPeriodFromText(context.question, saoPauloDateKey()) || {}) }, saoPauloDateKey());
  let broker = null;
  if (input?.corretor) {
    const match = await announceBroker(context, "consultar_area", input, String(input.corretor).slice(0, 60));
    if (!match) return `Não achei "${String(input.corretor).slice(0, 60)}" na equipe. Pessoas: ${(await brokerMatcher(context)).names.join(", ")}.`;
    broker = { id: match.id, name: match.name };
  }
  const query = typeof input?.busca === "string" ? input.busca.slice(0, 60) : "";
  const client = typeof input?.cliente === "string" ? input.cliente.slice(0, 60) : "";
  const key = `area:${auth?.profile?.id || ""}:${area}:${range.startDate}_${range.endDate}:${broker?.id || ""}:${query.toLowerCase()}:${client.toLowerCase()}`;
  const report = await withTimeout(cachedRead(key, () => loadHenryArea(area, auth, { range, broker, query, client })), REPORT_TIMEOUT_MS);
  if (!report) return "Não consegui ler essa área agora.";
  if (report.detail) context.detail = report.detail;
  if (report.ambiguous) return JSON.stringify({ varios_clientes: report.facts?.varios_clientes || [], instrucao: "Há clientes com esse nome: pergunte qual deles (primeiro nome, etapa e responsável), numa frase curta." });
  return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts, tela: HENRY_AREAS[area].tela });
}

// Modo treino: a ferramenta `spotify` não toca nada; responde como se o comando tivesse dado certo (o texto do Henry é
// o que se treina, não o Spotify).
function trainingSpotifyTool(input) {
  const command = normalizeSpotifyCommand(input || {});
  if (command.error) return { text: "Comando de música não entendido. Pergunte, curto, o que ele quer ouvir." };
  // Só o pedido (sem faixa de verdade): a confirmação põe o pedido dentro da frase (musicPlayingLine com query).
  const playing = command.action === "tocar" && command.query ? { query: command.query } : null;
  return { text: `Modo treino: nada tocou de verdade. Considere que o comando "${command.action}" deu certo e confirme em poucas palavras.`, command, result: { ok: true, ...(playing ? { playing } : {}) } };
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
    if (name === "ranking_periodo") return await runRankingPeriod(input || {}, auth, context);
    if (name === "funil_periodo") return await runFunnelPeriod(input || {}, auth, context);
    if (name === "funil_recorte") return await runFunnelSegment(input || {}, auth, context);
    if (name === "comparar_corretores") return await runBrokerComparison(input || {}, auth, context);
    if (name === "buscar_imoveis") {
      const busca = typeof input?.busca === "string" ? input.busca.slice(0, 60) : "";
      const tipo = input?.tipo === "imovel" || input?.tipo === "empreendimento" ? input.tipo : "";
      const report = await withTimeout(cachedRead(`properties:${tipo}:${busca.toLowerCase()}`, () => loadHenryProperties({ query: busca, tipo })), TOOL_TIMEOUT_MS);
      context.detail = report.detail;
      return JSON.stringify({
        sugestao_de_fala: report.spoken,
        imoveis: report.facts,
        ...(report.ambiguous ? { instrucao: busca ? "Mais de um (ou nenhum) imóvel com esse nome: diga os nomes da sugestão e pergunte qual, numa frase curta." : "Ele não disse qual imóvel: a conversa de outro dia você não guarda. Diga isso em poucas palavras e pergunte qual, citando os nomes da sugestão." } : {})
      });
    }
    if (name === "consultar_area") return await runAreaTool(input || {}, auth, context);
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
      let query = input || {};
      // Clientes por etapa são a fotografia de AGORA (Treino 5, 2026-10-25: "e os vinte esperando?" com periodo "este_mes" →
      // "Isso eu só sei para hoje e ontem" → "só consigo ver de hoje e de ontem"): período longo vira o agora.
      // Treino 6 (2026-10-25: "quem tá parado há mais tempo no CRM?" → sem_contato com período longo → instrução das
      // ferramentas de período, que não têm "parados" → "não tá disponível por essa via"): todo assunto que é a situação de
      // AGORA (NOW_CATALOG_TOPICS) faz o mesmo.
      if (NOW_CATALOG_TOPICS.has(query.assunto) && query.periodo && query.periodo !== "hoje" && query.periodo !== "ontem") query = { ...query, periodo: "hoje" };
      const rankingPeriod = rankingPeriodFor(query, context.question);
      if (rankingPeriod) return await runRankingPeriod(rankingPeriod, auth, context);
      const funnelPeriod = funnelPeriodFor(query, context.question);
      if (funnelPeriod) return await runFunnelPeriod(funnelPeriod, auth, context);
      // Clientes novos da equipe (Treino 3, 2026-10-25: "12" numa rodada e "2" nas outras no mesmo dia): a contagem é SEMPRE
      // a do Início (leads = clientes novos, REGRA OFICIAL do dono — loadHenryLeadOrigins/leadOriginBreakdown), a mesma do
      // relatório do dia e do relatório do período. A lista de nomes e o "do corretor" continuam no catálogo.
      if (query.assunto === "clientes_novos" && !query.corretor && query.formato !== "lista" && (!query.periodo || HENRY_PERIOD_IDS.includes(query.periodo))) {
        const range = resolveHenryPeriod({ periodo: query.periodo || "hoje" }, saoPauloDateKey());
        const answer = buildHenryNewClientsAnswer({ range, leads: await softRead("clientes novos", readLeadsFor(auth, range)) });
        return answer || "Não consegui buscar os clientes novos agora.";
      }
      // Ranking da EQUIPE de hoje/ontem (Treino 4, 2026-10-25: "Ranking hoje: 1º Gabriel e 2º Bruna."): a mesma leitura e a
      // mesma fala do ranking de qualquer período (runRankingPeriod → overview do Desempenho, deriveRanking = slimOverview.ranking).
      if (query.assunto === "ranking" && !query.corretor && query.formato !== "lista" && (!query.periodo || query.periodo === "hoje" || query.periodo === "ontem")) {
        return await runRankingPeriod({ periodo: query.periodo || "hoje" }, auth, context);
      }
      // Nomes dos clientes novos da equipe (Treino 4: "me passa o nome deles" → "estão na tela"): a MESMA leitura da contagem
      // (Início), com os primeiros nomes quando são poucos.
      if (query.assunto === "clientes_novos" && !query.corretor && query.formato === "lista" && (!query.periodo || HENRY_PERIOD_IDS.includes(query.periodo))) {
        const range = resolveHenryPeriod({ periodo: query.periodo || "hoje" }, saoPauloDateKey());
        const answer = buildHenryNewClientsAnswer({ range, leads: await softRead("clientes novos", readLeadsFor(auth, range)), names: true });
        return answer || "Não consegui buscar os clientes novos agora.";
      }
      // Tamanho da Meta Diária da equipe (Treino 5: "quanto a equipe precisa fechar por dia pra bater a meta?" → "Não tenho
      // esse número fixo"): ações previstas, feitas e faltando — o MESMO pré-cálculo/tela da Meta Diária (loadHenryTeamGoal).
      if (query.assunto === "meta_equipe" && query.detalhe === "tamanho" && !query.corretor) {
        const periodo = query.periodo === "ontem" ? "ontem" : "hoje";
        const range = resolveHenryPeriod({ periodo }, saoPauloDateKey());
        const spoken = buildHenryTeamGoalSizeSpeech({ goal: await softRead("meta da equipe", readTeamGoalFor(auth, range)), periodo });
        return spoken || "Não consegui buscar a meta da equipe agora.";
      }
      // Clientes esperando numa etapa, da equipe (Treino 5: "e os vinte esperando?"): quantos e os mais antigos na etapa, com
      // até 3 primeiros nomes na fala e a lista na tela (loadHenryStageClients, mesmos status da contagem do catálogo).
      // Motivo de quem está parado (Treino 13: "por que tanto aprovado que não fecha?" depois do gargalo já dito): o que o CRM
      // tem dos 3 mais antigos (última movimentação, próxima atividade) — só pela rota direta (henryBottleneckFollowUp).
      if (query.assunto === "etapa" && !query.corretor && query.formato === "motivo" && STAGE_WAITING_IDS.has(query.etapa)) {
        const stage = await softRead("motivo da etapa", cachedRead(`stage-reasons:${auth?.profile?.id || ""}:${query.etapa}`, () => loadHenryStageReasons(auth, query.etapa)));
        const report = buildHenryStageReasonsReport({ etapa: query.etapa, stage, today: saoPauloDateKey(), stageLabel: ETAPAS[query.etapa]?.label || "" });
        if (report.detail) context.detail = report.detail;
        return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
      }
      // Clientes por etapa e por sub-status AGORA, da equipe ou de um corretor (bug real, dono 2026-10-26: "quantos clientes o
      // Gabriel tem com status simulação enviada/realizada?" → "nenhum na etapa de simulação" com a aba Simulação dele em 5):
      // os MESMOS contadores da tela Clientes (loadHenryStageCounts → getSimulationClientCounters), etapa = aba da tela,
      // situação = filtro de status da tela (campo situacao ou o rótulo dito na pergunta). A lista "esperando" da equipe de
      // aprovados/documentação (mesmos status da aba) continua na leitura de sempre logo abaixo.
      const stageRequest = query.assunto === "etapa" && query.periodo !== "ontem" && query.formato !== "motivo"
        ? resolveHenryStageRequest({ etapa: query.etapa, situacao: query.situacao, question: context.question })
        : null;
      const keepsWaitingList = !query.corretor && query.formato === "lista" && !stageRequest?.sub && HENRY_WAITING_LIST_IDS.has(stageRequest?.etapa);
      if (stageRequest && !keepsWaitingList) return await runStageCount(stageRequest, query, auth, context);
      if (query.assunto === "etapa" && !query.corretor && query.formato === "lista" && query.periodo !== "ontem" && STAGE_WAITING_IDS.has(query.etapa)) {
        const stage = await softRead("clientes da etapa", cachedRead(`stage:${auth?.profile?.id || ""}:${query.etapa}`, () => loadHenryStageClients(auth, query.etapa)));
        const report = stage ? buildHenryStageWaitingReport({ etapa: query.etapa, total: stage.total, rows: stage.rows, today: saoPauloDateKey(), stageLabel: ETAPAS[query.etapa]?.label || "" }) : null;
        if (!report) return "Não consegui buscar os clientes dessa etapa agora.";
        if (report.detail) context.detail = report.detail;
        return JSON.stringify({ sugestao_de_fala: report.spoken, numeros: report.facts });
      }
      // Parados da equipe em lista (Treino 8: "quem tá há mais tempo sem retorno no CRM?" → parados + conversas, 11,8 s): os
      // MESMOS dados do catálogo (sem_contato, mais antigos primeiro), fala montada com quantos e os 3 mais antigos.
      if (query.assunto === "sem_contato" && query.formato === "lista" && !query.corretor && query.periodo !== "ontem") {
        const result = await consultCatalog({ ...query, periodo: "hoje" }, context, { full: true });
        const report = result.data ? buildHenryStaleClientsSpeech(result.data) : null;
        if (!report) return result.text;
        if (report.detail) context.detail = report.detail;
        return report.spoken;
      }
      const named = [query.corretor, query.outro_corretor].filter(Boolean);
      for (const spoken of named) await announceBroker(context, name, query, spoken).catch(() => null);
      const key = `tool:${auth?.profile?.id || ""}:${JSON.stringify(query)}`;
      // Meta da equipe (Treino 2, 2026-10-25: "como tá a meta do dia pra equipe?" → "ainda não batemos… Quer que eu traga o
      // número exato?"): o percentual E quem bateu, dados do MESMO catálogo da Alexa (nenhuma conta nova); a fala é a do Henry
      // (buildHenryTeamGoalSpeech — Treino 4: "A meta da equipe está em 0 por cento." era robótico).
      const answer = await cachedRead(key, async () => {
        context.staleMinutes = 0;
        const teamGoal = query.assunto === "meta_equipe" && !query.corretor && query.formato !== "lista" && (!query.periodo || query.periodo === "hoje" || query.periodo === "ontem");
        if (!teamGoal) return { text: await consultCatalog(query, context), staleMinutes: context.staleMinutes };
        const periodo = query.periodo || "hoje";
        const [main, who] = await Promise.all([
          consultCatalog(query, context, { full: true }),
          consultCatalog({ assunto: "meta_bateram", periodo }, context, { full: true }).catch(() => ({ text: "", data: null }))
        ]);
        const spoken = main.data && who.data ? buildHenryTeamGoalSpeech({ percent: main.data.percent, hitters: who.data.items || [], periodo }) : null;
        return { text: spoken || [main.text, who.text].filter(Boolean).join(" "), staleMinutes: context.staleMinutes };
      });
      if (context.providerFailed) dataCache.delete(key);
      for (const spoken of named) await announceBroker(context, name, query, spoken, { found: true }).catch(() => null);
      // Dado com mais de 1 hora: UMA menção natural no fim (nunca o "Última atualização há…" da Alexa).
      const note = henryStaleNote(answer.staleMinutes);
      return positiveCatalogAnswer(note ? `${answer.text} ${note}` : answer.text, query, context);
    }
    if (name === "relatorio_do_dia") {
      const report = await withTimeout(buildDailyReport(auth, { positive: wantsPositiveSummary(context.question), turns: context.dayTurns }), OWNER_SUMMARY_TIMEOUT_MS + 3000);
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
    if (name === "aniversariantes_hoje") {
      const { events, users } = await withTimeout(loadTodayBirthdays(auth), TOOL_TIMEOUT_MS);
      const clientes = events.slice(0, 12).map((event) => ({ nome: firstName(event.clientName), corretor: event.own ? "o próprio Matheus" : firstName(users.get(event.receiverId)?.name) }));
      context.detail = events.length ? { title: "Aniversariantes de hoje", subtitle: `${events.length} cliente${events.length === 1 ? "" : "s"}`, sections: [{ title: "Hoje", rows: events.slice(0, 30).map((event) => ({ label: event.clientName || "Cliente", value: event.own ? "Seu" : firstName(users.get(event.receiverId)?.name) })) }] } : null;
      return JSON.stringify({ total: events.length, clientes });
    }
    // Única ferramenta de escrita (interna) do Henry, e ela mesma NÃO escreve: só põe a confirmação na tela; o envio sai pelo
    // botão (POST mode "birthday_notice", lib/henry-birthday-alerts.js sendHenryBirthdayNotices).
    if (name === "avisar_corretor_aniversario") {
      const prepared = await withTimeout(prepareBirthdayConfirmation(auth, { name: typeof input?.cliente === "string" ? input.cliente.slice(0, 60) : "", signature: HENRY_OWNER_SPOKEN_NAME }), TOOL_TIMEOUT_MS);
      if (prepared.detail) context.detail = prepared.detail;
      return JSON.stringify({ sugestao_de_fala: prepared.reply, enviado: false, instrucao: "Nada foi enviado: diga que deixou na tela para ele confirmar." });
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
    // 2ª escrita interna (dono, 2026-10-25, "Sem sim, ele apenas envia"): recado pela mensagem da Supervisão, direto.
    // Treino nunca envia (simula). Mesmo recado repetido na mesma resposta não sai duas vezes.
    if (name === "enviar_alerta_corretor") {
      const key = `${String(input?.destinatario || "").trim().toLowerCase()}|${String(input?.texto || "").trim().toLowerCase()}`;
      context.teamAlerts ||= new Set();
      if (context.teamAlerts.has(key)) return JSON.stringify({ enviado: true, instrucao: "Esse recado já foi enviado nesta resposta; não envie de novo." });
      const result = await withTimeout(sendHenryTeamAlert(auth, { destinatario: input?.destinatario, texto: input?.texto }, { training: Boolean(trainingStore.getStore()) }), TOOL_TIMEOUT_MS);
      if (result.sent || result.simulated) context.teamAlerts.add(key);
      if (result.detail) context.detail = result.detail;
      return JSON.stringify({
        sugestao_de_fala: result.reply,
        enviado: result.sent,
        ...(result.options ? { varias_pessoas: result.options, instrucao: "NADA foi enviado: pergunte qual delas, numa frase curta." } : {}),
        ...(result.sent ? { instrucao: "Já foi enviado. Confirme curto com a sugestão de fala." } : {}),
        ...(result.simulated ? { instrucao: "Modo treino: nada foi enviado de verdade. Diga a sugestão de fala." } : {})
      });
    }
    // 3ª escrita interna (dono, 2026-10-26, MKT-2m): libera o atendimento do acumulado do Marketplace pela entrega de
    // sempre (roleta). Treino nunca aprova (simula). Uma vez por resposta.
    if (name === "aprovar_atendimento_marketplace") {
      if (context.marketplaceApproved) return JSON.stringify({ instrucao: "Já foi liberado nesta resposta; não chame de novo." });
      const result = await withTimeout(approveMarketplaceByHenry(auth, { cliente: typeof input?.cliente === "string" ? input.cliente : "" }, { training: Boolean(trainingStore.getStore()) }), TOOL_TIMEOUT_MS);
      context.marketplaceApproved = true;
      if (result.detail) context.detail = result.detail;
      return JSON.stringify({
        sugestao_de_fala: result.reply,
        liberados: result.approved,
        instrucao: result.simulated ? "Modo treino: nada foi liberado de verdade. Diga a sugestão de fala." : "Confirme curto com a sugestão de fala."
      });
    }
    if (name === "spotify") {
      const result = trainingStore.getStore() ? trainingSpotifyTool(input) : await withTimeout(runHenrySpotifyTool(input || {}, { baseVolume: context.spotifyVolume }), TOOL_TIMEOUT_MS);
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
        if (result.command?.action === "tocar" && result.result?.ok) context.musicPlayed = result.result.playing || { query: result.command.query };
      }
      // Pedido de volume do dono que o Spotify APLICOU (dono, 2026-10-24): a tela troca o "volume do dono" por este e
      // cancela a subida pendente (nunca volta ao volume antigo por cima do pedido).
      if (result.command?.action === "volume" && result.result?.ok && Number.isInteger(result.result.volume)) {
        context.spotifyVolumeSet = result.result.volume;
      }
      // Fala fixa do volume aplicado (Treino 4): "Baixei o som." — só quando o Spotify confirmou (ou o modo treino).
      const volumeLine = spotifyVolumeLine(result.command, result.result);
      if (volumeLine) context.volumeLine = volumeLine;
      // Próxima faixa aplicada (Treino 7): "Troquei a música." (junto com a troca de aparelho, se houver).
      const controlLine = spotifyControlLine(result.command, result.result);
      if (controlLine) context.controlLine = controlLine;
      return result.text;
    }
    if (name === "mudar_aparelho_spotify") {
      // Modo treino: sucesso simulado coerente (Treino 7 — antes "não foi trocado de verdade" virava "Não consegui trocar").
      const result = trainingStore.getStore()
        ? simulatedSpotifyDeviceTool(input || {})
        : await withTimeout(runHenrySpotifyDeviceTool(input || {}, { restoreVolume: context.spotifyVolume }), TOOL_TIMEOUT_MS);
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

// Frase pronta da ferramenta da rota direta (texto do catálogo ou sugestao_de_fala do relatório). Falha/recusa = "" (o
// modelo fala o resultado, nunca uma frase de erro como se fosse número).
const DIRECT_NOT_SPEECH = /^(não consegui|nao consegui|assunto desconhecido|não entendi|ferramenta desconhecida|isso eu só sei|ainda não tenho esse histórico)/i;
// any (speak "always"): frase sem número também vale (nomes dos clientes novos).
// fixed (diagnóstico/plano): a sugestão de fala montada vale mesmo com a instrução ao modelo junto.
function henryDirectSpeech(content, { any = false, fixed = false } = {}) {
  let text = String(content || "").trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      text = typeof parsed?.sugestao_de_fala === "string" && (fixed || !parsed.instrucao) ? parsed.sugestao_de_fala.trim() : "";
    } catch {
      text = "";
    }
  }
  return text && !DIRECT_NOT_SPEECH.test(text) && (any || /\d|nenhum|ningu[eé]m|\bn[aã]o\b/i.test(text)) ? text : "";
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
  let textEmitted = false;
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
          textEmitted = true;
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
  // Stream que acabou sem o fim da mensagem (sem stop_reason): a resposta parou no meio. Antes o pedaço virava a resposta
  // (Treino, 2026-10-25: "Nenhuma delas"). Agora é erro — callModel tenta de novo sem stream se nada foi para a voz.
  if (!message.stop_reason) throw Object.assign(new Error("Resposta da IA interrompida no meio (stream sem fim)."), { code: "stream_incomplete", textEmitted });
  message.content = message.content.filter(Boolean);
  message.ms = Date.now() - startedAt;
  return message;
}

// Sistema = parte FIXA com cache de prompt (identidade, jeito, conhecimento de base, barreiras, ferramentas) + parte
// VARIÁVEL (data/hora de Brasília, estilo da tela, visão, lembretes, memória do dia, aberturas já usadas, dica sorteada).
// vision = visão ligada na configuração; withImage = veio quadro da câmera. webSearch = pesquisa na internet ligada.
function callModel(messages, { withImage = false, vision = false, style, reportMode = false, webSearch = false, notes = [], daySummary = "", usedOpenings = [], usedClosings = [], hint = "", repertoire = "", usedExpressions = [], tools = true, onText = null, lockNote = "", alertNote = "", toolChoice = null } = {}) {
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
    lockNote,
    alertNote
  });
  // Papo casual (tools = false): sem ferramentas e resposta curta — o modelo responde mais rápido.
  const payload = {
    max_tokens: reportMode ? MAX_REPORT_TOKENS : tools ? MAX_REPLY_TOKENS : MAX_SMALL_TALK_TOKENS,
    system: buildHenrySystemBlocks(dynamic),
    ...(tools ? { tools: henryToolsFor({ webSearch, locked: Boolean(lockNote) }) } : {}),
    // Rodada que OBRIGA uma ferramenta (Treino 3: prometeu buscar e não buscou; pergunta ignorada duas vezes).
    ...(tools && toolChoice ? { tool_choice: toolChoice } : {}),
    messages
  };
  // Stream interrompido antes de qualquer texto ir para a voz: uma nova tentativa, sem stream. Com texto já falado, o erro
  // segue visível (a voz já começou; outra resposta por cima confundiria).
  return streamAnthropic(payload, { onText }).catch(async (error) => {
    if (error?.code !== "stream_incomplete" || error.textEmitted) throw error;
    console.warn("[henry] stream interrompido; nova tentativa sem stream.");
    const started = Date.now();
    const data = await callAnthropic(payload);
    return { ...data, ms: Date.now() - started, firstTokenMs: null };
  });
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
  const training = trainingStore.getStore();
  if (training) {
    // Modo treino: tudo na origem própria (henry_training), somado para o relatório da rodada.
    const costUsd = estimateHenryModelCostUsd(usage) + webSearches * HENRY_WEB_SEARCH_USD;
    training.costUsd += costUsd;
    background(recordAiUsage({ feature: HENRY_TRAINING_FEATURE, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...tokens, cacheCreationTokens: cacheWriteTokens, cacheReadTokens, costUsd, ...extra }));
    return;
  }
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
    // Treino 11: relatório do bom dia sem fechamento de fim de dia ("Bom descanso, amanhã a gente segue").
    return safe === HENRY_FALLBACK_REPLY ? null : dropNightClosing(safe) || null;
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

// Oferta de música de fundo do bom dia (dono, 2026-10-26 — henry-morning-music-core.mjs): "Que tal uma música de fundo?
// Posso escolher ou você tem alguma de preferência?"; a escolha dele é um artista da lista rock/blues animada, sorteado,
// nunca o de ontem (henry_morning_music guarda id, estilo e o artista). Gravada ANTES de responder (o "ok" chega segundos
// depois e toca exatamente ela). Falhou a leitura ou a gravação → null (abertura antiga: "posso dar play?" → estilo).
async function suggestMorningMusic(auth) {
  try {
    const stored = await readSettingRow(MORNING_MUSIC_SETTING_ID);
    const history = morningSuggestionHistory(stored);
    const offer = pickMorningSuggestion({ lastQuery: history[history.length - 1]?.target?.query || "" });
    if (!offer) return null;
    await writeSettingRow(auth, MORNING_MUSIC_SETTING_ID, rememberMorningSuggestion(stored, offer, saoPauloDateKey()));
    return offer;
  } catch (error) {
    console.warn(`[henry] sugestão de música do bom dia indisponível (${error?.name || "erro"}); usando a abertura de sempre.`);
    return null;
  }
}

// Resposta do dono à pergunta da música (step "music"), do estilo (step "style") ou do "É essa?" do cantor (step
// "music_confirm"). null = era outra pergunta. Desde 2026-10-24 (dono: "eu posso ou falar qual estilo ou responder o
// cantor e ele procura"): aceite curto = a sugestão de hoje; estilo = playlist do gênero; cantor = busca o artista.
async function answerMorningMusic(auth, { step, question, image, style, address, emit = () => {}, locked = false }) {
  const text = String(question || "").trim();
  if (step === "music_confirm") return answerMorningConfirm(auth, { text, image, style, address, emit, locked });
  const reply = classifyMorningMusicReply(text);
  let answer = reply.kind;
  // Pergunta do estilo (reserva "rock ou sertanejo"): sim/tanto faz = rock, como sempre.
  if (step === "style" && !["genre", "artist"].includes(answer)) {
    const legacy = classifyMorningStyle(text);
    answer = legacy === "rock" || legacy === "sertanejo" ? "genre" : legacy;
    if (answer === "genre") reply.genre = MORNING_GENRES.find((item) => item.id === legacy);
  }
  // "toca <outra coisa>" que não virou estilo nem cantor: o pedido dele vai para a ferramenta do Spotify.
  if (answer === "yes" && step === "music" && isOtherMusicRequest(text)) answer = "other";
  if (answer === "other") return null;
  // Aceitou a sugestão do bom dia ("pode", "manda"): toca EXATAMENTE o sugerido. Sem sugestão de hoje gravada (falhou a
  // gravação), cai na pergunta do estilo de antes.
  // undefined = a leitura falhou (nunca regrava o registro por cima do histórico nesse caso).
  const stored = answer === "yes" || answer === "artist" || (answer === "genre" && step === "music") ? await readSettingRow(MORNING_MUSIC_SETTING_ID).catch(() => undefined) : null;
  // Treino 10: o gênero pedido é o da sugestão de hoje ("pode ser um sertanejo mesmo, tanto faz o cantor") = toca a sugestão.
  const todays = answer === "yes" || answer === "genre" ? todaysMorningSuggestion(stored ?? null, saoPauloDateKey()) : null;
  // Treino 12: "Pode, mas … um sertanejo mais animado" = trocar (o "mas" anula o aceite; qualificador = outra busca), nunca
  // a sugestão, mesmo com o gênero dela.
  const suggested = answer === "yes" || (answer === "genre" && !reply.mood && !reply.change && morningSuggestionMatchesGenre(todays, reply.genre)) ? todays : null;
  if (answer === "yes" && !suggested) {
    rememberExchange(auth, text, MORNING_STYLE_QUESTION);
    return { reply: MORNING_STYLE_QUESTION, navigate: null, detail: null, morning: { step: "style" }, scene: { kind: "conversa" } };
  }
  if (answer === "no") return composeReportAnswer(auth, { question: text, image, style, address, locked, greeted: true });
  let target;
  let query;
  let choice;
  if (suggested) {
    // Rock/blues: só o artista da lista, nome exato, com o filtro (registro antigo "clima de Suits" do mesmo dia também
    // vira artista da lista — nunca a playlist genérica que trouxe música mexicana; dono, 2026-10-26).
    target = morningSuggestionTarget(suggested);
    query = target?.query || suggested.say;
    choice = suggested.choice || "sugestao";
  } else if (answer === "genre") {
    // Gosto do Spotify só é lido aqui (playlist dele com o gênero no nome); sem os escopos = null, sem chamada.
    const taste = await readHenrySpotifyTaste().catch(() => null);
    ({ target, query, choice } = morningGenreTarget(reply.genre, { style, taste, mood: reply.mood || "" }));
  } else {
    target = morningArtistTarget(reply.query);
    query = target?.query || "";
    choice = "artista";
  }
  emit({ progress: "musica_busca", topic: "music", label: `Procurando “${query}” no Spotify…`, music: { stage: "search", query } });
  let music = trainingStore.getStore() ? { ok: true, reason: "", playing: { name: query }, uri: "" } : await startHenryMorningMusic(target, { acceptBest: answer !== "artist" });
  // Escolha automática e o artista sorteado não apareceu com o nome exato: outros 2 artistas da lista (dono, 2026-10-26).
  // "um rock blues" pedido na resposta usa a mesma lista (morningGenreTarget) e a mesma reserva.
  const rockBluesPick = suggested || (answer === "genre" && target?.strict ? { kind: "style", genre: "rock-blues", target } : null);
  if (rockBluesPick && music.reason === "not_found") {
    for (const fallback of morningStyleFallbacks(rockBluesPick, { tried: [query] })) {
      music = await startHenryMorningMusic(fallback, { acceptBest: true });
      if (music.reason !== "not_found") break;
    }
  }
  emit(henryMusicResult({ action: "tocar", query }, music));
  console.info(`[henry] bom dia com música: ${suggested ? `sugestão ${suggested.kind}` : answer === "genre" ? `estilo ${reply.genre?.id || ""}` : answer} (${music.ok ? "tocando" : music.openSpotify ? "abrindo o app" : music.reason || "falhou"}).`);
  // Cantor que não bateu na busca: pergunta "Achei X, de Y. É essa?" sem tocar (regra da busca, HENRY-1 "Interação").
  if (music.reason === "confirm" && music.candidate) {
    const line = morningConfirmLine(music.candidate);
    const saved = line && safeHenryReply(line) === line && stored !== undefined
      ? await writeSettingRow(auth, MORNING_MUSIC_SETTING_ID, rememberMorningConfirm(stored, music.candidate, saoPauloDateKey())).then(() => true).catch(() => false)
      : false;
    if (saved) {
      rememberExchange(auth, text, line);
      return { reply: line, navigate: null, detail: null, morning: { step: "music_confirm" }, scene: { kind: "conversa" } };
    }
  }
  const spotify = music.openSpotify ? { action: "open_spotify", uri: music.openSpotify.uri, quiet: true } : null;
  // Treino 12: pediu OUTRA música (não a sugestão) e tocou → confirma curto o que vai tocar antes do relatório.
  // Aceitou a escolha dele → "Lá vai um rock blues animado de fundo." (dono, 2026-10-26).
  const changeLine = !music.ok ? "" : suggested ? morningStyleAcceptLine(suggested) : morningMusicChangeLine(answer === "genre" ? { genre: reply.genre, mood: reply.mood || "" } : { artist: reply.query });
  const prefix = music.reason === "confirm" || music.reason === "not_found" ? "Não achei esse no Spotify, mas bora pro dia." : [changeLine, morningMusicPrefix(choice, music)].filter(Boolean).join(" ");
  // Treino 5: o Treino guarda O QUE tocou (morningMusic) — a resposta falada não anuncia a música (ela já está tocando).
  const report = await composeReportAnswer(auth, { question: text, image, style, address, prefix, spotify, locked, greeted: true });
  return music.ok ? { ...report, morningMusic: query } : report;
}

// "É essa?" do cantor (step "music_confirm"): sim → toca o candidato guardado; não → relatório sem música; outra coisa →
// fluxo normal (null). Candidato perdido (gravação falhou) → relatório com a frase de sempre.
async function answerMorningConfirm(auth, { text, image, style, address, emit, locked }) {
  const answer = classifyYesNo(text);
  if (answer === "other") return null;
  if (answer === "no") return composeReportAnswer(auth, { question: text, image, style, address, prefix: "Beleza, sem música então.", locked, greeted: true });
  const confirm = todaysMorningConfirm(await readSettingRow(MORNING_MUSIC_SETTING_ID).catch(() => null), saoPauloDateKey());
  const query = confirm?.name || "";
  if (query) emit({ progress: "musica_busca", topic: "music", label: `Procurando “${query}” no Spotify…`, music: { stage: "search", query } });
  const music = !confirm ? { ok: false, reason: "failed" } : trainingStore.getStore() ? { ok: true, reason: "", playing: { name: query }, uri: "" } : await startHenryMorningMusic({ uri: confirm.uri });
  if (confirm) emit(henryMusicResult({ action: "tocar", query }, music));
  console.info(`[henry] bom dia com música: confirmação (${music.ok ? "tocando" : music.openSpotify ? "abrindo o app" : music.reason || "falhou"}).`);
  const spotify = music.openSpotify ? { action: "open_spotify", uri: music.openSpotify.uri, quiet: true } : null;
  const report = await composeReportAnswer(auth, { question: text, image, style, address, prefix: morningMusicPrefix("artista", music), spotify, locked, greeted: true });
  return music.ok ? { ...report, morningMusic: query } : report;
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

// Resposta à pergunta do aviso de aniversariante (step "birthday_alert", dono 2026-10-24): sim → CONFIRMAÇÃO na tela (o aviso
// ao corretor só sai pelo botão; cliente do dono = rascunho com copiar/abrir WhatsApp, nunca enviado); não → ok.
async function answerBirthdayAlert(auth, { question, locked = false }) {
  const text = String(question || "").trim();
  const answer = classifyYesNo(text);
  if (answer === "other") return null;
  if (locked && answer !== "no") return { reply: pick("locked", HENRY_LOCKED_PHRASES), navigate: null, detail: null, scene: { kind: "conversa" } };
  if (answer === "no") {
    rememberExchange(auth, text, "Beleza, deixo quieto.");
    return { reply: "Beleza, deixo quieto.", navigate: null, detail: null, scene: { kind: "conversa" } };
  }
  const prepared = await prepareBirthdayConfirmation(auth, { signature: HENRY_OWNER_SPOKEN_NAME });
  const reply = safeHenryReply(prepared.reply, { screenFallback: Boolean(prepared.detail) });
  rememberExchange(auth, text, reply);
  return { reply, navigate: null, detail: prepared.detail, scene: { kind: "conversa" } };
}

// Relatório do dia (o "bom dia"): elogio (visão), números do Início, extras do bom dia (clientes novos desde ontem,
// simulações automáticas geradas) e, no fim, a pergunta dos aniversariantes (estado `birthday`). prefix = fala antes do
// relatório (música do bom dia), fora da reescrita do modelo.
// greeted = a pergunta da música do bom dia já cumprimentou: o relatório começa sem nova saudação (dropReportGreeting).
async function composeReportAnswer(auth, { question = "", image = null, style = null, address = "", prefix = "", spotify = null, locked = false, greeted = false }) {
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
  const [complimentText, { inicio, ownerText, ownerRows }, day, extras] = await Promise.all([
    compliment,
    loadReportSources(auth),
    readHenryDay(),
    cachedRead(`morning:${auth?.profile?.id || ""}`, () => loadHenryMorningExtras(auth)).catch(() => ({ newClients: null, autoSimulations: null, birthdays: [] }))
  ]);
  const extrasText = safeHenryReply(composeMorningExtras(extras));
  const extraSentence = extrasText && extrasText !== HENRY_FALLBACK_REPLY ? extrasText : "";
  // "Enquanto você estava fora…" (dono, 2026-10-26, todo dia, janela fora do expediente): fala literal do dono, fora da reescrita do modelo (a
  // reescrita do resumo positivo tiraria o "aguardando sua aprovação"), depois do relatório e antes do aniversário.
  const awayText = safeHenryReply(buildHenryAwaySentence(extras?.away));
  const awaySentence = awayText && awayText !== HENRY_FALLBACK_REPLY ? awayText : "";
  const memoryTurns = day.turns;
  const plan = planVocabulary("report", question, day.lexicon, memoryTurns);
  // A barreira da fala troca a frase INTEIRA quando algo é sensível: tenta com elogio, sem elogio e, por fim, só o Início
  // (o elogio ou uma "atenção" nunca derrubam o relatório). screenText = relatório completo, só para a TELA.
  const attempts = [{ ownerText, compliment: complimentText, address }, { ownerText, address }, { address }];
  let screenText = "";
  let chosen = null;
  for (const options of attempts) {
    const base = composeHenryDailyReport(inicio, options);
    const text = base && extraSentence ? `${base} ${extraSentence}` : base;
    if (text && safeHenryReply(text) !== HENRY_FALLBACK_REPLY) {
      screenText = safeHenryReply(text);
      chosen = options;
      break;
    }
  }
  if (!screenText) return { reply: [prefix, `Olá, ${address || HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`].filter(Boolean).join(" "), navigate: null, detail: null, spotify };
  // Resumo positivo (REGRA OFICIAL, dono 2026-10-24, HENRY-1): a FALA só traz o que foi bom (sem zero, aguardando,
  // atrasado nem "atenções"); nada de bom → saudação + frase curta de ânimo, sem número e sem repetir no dia.
  const good = composePositiveDailyFacts({ leadsToday: inicio?.kpis?.leadsToday?.total ?? null, rows: ownerRows, extras });
  const greeting = greetingOf(chosen?.ownerText || inicio?.assistant?.text || "") || `Olá, ${HENRY_OWNER_SPOKEN_NAME}.`;
  const body = good.positive ? good.text : pickSlowDayPhrase({ today: true, turns: memoryTurns });
  const positiveText = (intro = "") => {
    for (const compliment of [chosen?.compliment || "", ""]) {
      const text = safeHenryReply(withReportIntro(`${greeting} ${body}`, compliment, address, intro));
      if (text !== HENRY_FALLBACK_REPLY) return text;
    }
    return "";
  };
  const factual = positiveText();
  if (!factual) return { reply: [prefix, `Olá, ${address || HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`].filter(Boolean).join(" "), navigate: null, detail: null, spotify };
  // Dia fraco: a frase de ânimo já está pronta (sem modelo, sem abertura).
  const rewritten = good.positive ? await rewriteDailyReport(auth, factual, { address, usedOpenings: openingsFrom(memoryTurns), plan }) : null;
  const fallback = good.positive ? positiveText(pick("intro", HENRY_REPORT_INTROS)) || HENRY_FALLBACK_REPLY : factual;
  const composed = rewritten || (fallback !== HENRY_FALLBACK_REPLY ? fallback : factual);
  const reply = greeted ? dropReportGreeting(composed) : composed;
  // Aniversariantes (só primeiros nomes): pergunta se prepara a mensagem — só RASCUNHO, nunca envia.
  const askedBirthday = safeHenryReply(birthdayQuestion(extras.birthdays));
  const birthdayAsk = askedBirthday && askedBirthday !== HENRY_FALLBACK_REPLY ? askedBirthday : "";
  const spoken = [prefix, reply, awaySentence, birthdayAsk].filter(Boolean).join(" ");
  console.info(`[henry] relatório do dia: ok (${rewritten ? "modelo" : "reserva"})${good.positive ? "" : " (dia tranquilo)"}${chosen?.compliment ? " (com elogio)" : ""}.`);
  // Na tela, o relatório COMPLETO com os números exatos (a fala só traz o que foi bom e pode arredondar).
  const sentences = screenText.split(/(?<=[.!?])\s+/).slice(1).filter((sentence) => sentence && sentence !== chosen?.compliment);
  if (awaySentence) sentences.push(awaySentence);
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
export async function answerHenry(auth, { mode = "question", question = "", history = [], image = null, style = null, vision = false, webSearch = false, onProgress = null, onFirstSentence = null, morning = null, spotifyVolume = null, locked = false, lockCommand = "", alertState = "" } = {}) {
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
    if (step === "music" || step === "style" || step === "music_confirm") {
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
      const said = todayTurns.filter((turn) => turn?.role === "assistant").map((turn) => turn.text);
      const reply = offer ? morningSuggestionLine(offer, name, { avoid, said }) : morningOpening(name, { avoid, random: Math.random });
      rememberExchange(auth, String(question || "").trim() || "Bom dia, Henry", reply);
      // Aquece os números do relatório enquanto ele responde.
      background(Promise.all([loadReportSources(auth), cachedRead(`morning:${auth?.profile?.id || ""}`, () => loadHenryMorningExtras(auth))]).catch(() => null));
      return { reply, navigate: null, detail: null, morning: { step: "music" }, scene: { kind: "conversa" } };
    } else {
      return composeReportAnswer(auth, { question, image, style, address, locked });
    }
  }
  // "pode atender" (liberar o acumulado do Marketplace, MKT-2m) não é o "sim" do aniversário.
  if (step === "birthday" && !isMarketplaceApprovalCommand(question)) {
    const handled = await answerMorningBirthday(auth, { question, address, locked });
    if (handled) return handled;
  }
  if (step === BIRTHDAY_ALERT_STEP) {
    const handled = await answerBirthdayAlert(auth, { question, locked });
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
  const context = { locked, lockedPhrase, dayTurns: memoryTurns, navigate: null, openUrl: null, spotify: null, brokers: null, detail: null, chart: null, tools: [], reportMode: false, question: text, emit, music: null, musicPlayed: null, deviceLine: "", spotifyMoved: false, spotifyVolume: Number.isInteger(spotifyVolume) && spotifyVolume >= 0 && spotifyVolume <= 100 ? spotifyVolume : null };
  const messages = [
    ...previous.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: image ? [imageBlock(image), { type: "text", text }] : text }
  ];
  if (webSearch && looksLikeWebQuery(text)) emit({ progress: "internet", topic: "internet", label: "Pesquisando na internet…" });
  const feature = image ? "henry_voice_vision" : "henry_voice_assistant";
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
  // "Quer que eu abra?" → "sim/abre/pode": aceite da sugestão vira a ação, sem perguntar de novo.
  const lastAssistant = [...previous].reverse().find((turn) => turn.role === "assistant")?.text || "";
  // Treino 11: "me mostra o WhatsApp" = abre o Chat na hora (rota direta abrir_tela), mesmo junto de "pode abrir".
  const screenOpen = !image && !locked ? henryScreenOpenRequest(text) : "";
  const accepted = !screenOpen && isAcceptance(text) && offeredToOpen(lastAssistant);
  // "Pode abrir" logo depois de ele dizer que a tela já está aberta (Treino 7): resposta fixa, sem modelo.
  // Cliente citado por lugar ("o cliente da Vila Carvalho, ele já respondeu?", Treino 8): o cadastro não tem bairro → a
  // pergunta do nome, fixa, sem modelo (antes: "a consulta não voltou" sem ferramenta nenhuma).
  const fixedReply = !image && !accepted ? henryAlreadyOpenReply(text, lastAssistant) || (locked ? "" : henryPlaceClientReply(text)) : "";
  // Treino 9: despedida do fim do dia ("por hoje é isso, pode fechar a agenda"), concordância sem pergunta dele em aberto
  // ("agora sim, o número de vendas já resolve") e reclamação sem pista ("não foi isso que eu perguntei") = respostas fixas,
  // curtas, sem o modelo, sem ferramenta e sem repetir número.
  const saidToday = memoryTurns.filter((turn) => turn?.role === "assistant").map((turn) => turn.text);
  // Treino 10: 2ª reclamação sem pista logo depois da pergunta genérica ("o que você queria?") = o último pedido dele com
  // conteúdo (henryComplaintFallbackRequest), nunca a pergunta de novo.
  const reinterpreted = !image && !accepted && !fixedReply && !locked ? henryComplaintFallbackRequest(text, memoryTurns.length ? memoryTurns : previous) : "";
  // Treino 11: "você tá falando a mesma coisa de novo" depois de uma resposta que JÁ atendeu (gargalo, números) = aprofundar
  // (quem está parado na etapa do gargalo, com nomes e dias), nunca "você queria o quê?".
  // Treino 12: reclamação com a pergunta do gargalo ("quero saber onde a gente perde o cliente") depois de uma resposta que
  // JÁ disse o gargalo = aprofundar também; na releitura da 2ª reclamação, o pedido relido passa pela mesma regra.
  const deepen = !image && !accepted && !fixedReply && !locked ? (reinterpreted ? henryDiagnosisDeepenRequest(reinterpreted, memoryTurns.length ? memoryTurns : previous) : henryDeepenRequest(text, memoryTurns.length ? memoryTurns : previous)) : null;
  // Dono, 2026-10-26: insistência ("Todo cliente tem uma origem", "quero que você me diga", "por que você não abre a lista?")
  // = refazer o último pedido dele com a ferramenta; "Certo" logo depois de uma promessa ("Vou puxar … agora mesmo") =
  // cumprir a promessa agora — nunca "Beleza!" nem "abra a tela".
  const pending = !image && !accepted && !fixedReply && !locked && !reinterpreted && !deepen ? henryPendingFollowUp(text, memoryTurns.length ? memoryTurns : previous) : null;
  // Treino 10: "me dá aquela visão de novo" = o último resumo falado hoje (memória do dia), fixo, nunca a câmera.
  const turnReply = !image && !accepted && !fixedReply && !pending
    ? henryFarewellReply(text, { name: address || HENRY_OWNER_SPOKEN_NAME, said: saidToday })
      || henryAgreementReply(text, lastAssistant, saidToday)
      || (!locked ? henryRepeatSummaryReply(text, memoryTurns.length ? memoryTurns : previous) : "")
      || (reinterpreted || deepen ? "" : (lastAssistant && isBareHenryComplaint(text) ? henryBareComplaintReply(saidToday) : ""))
    : "";
  if (fixedReply || turnReply) {
    rememberExchange(auth, text, fixedReply || turnReply);
    return { reply: fixedReply || turnReply, navigate: null, detail: null, scene: { kind: "conversa" }, timing: { modelMs: 0, firstTokenMs: null, toolsMs: 0, rounds: 0, tools: false, direct: "", toolNames: [] } };
  }
  const plan = planVocabulary("question", text, lexicon, memoryTurns);
  // Papo casual sem pergunta dele em aberto: sem ferramentas (resposta mais rápida). Resposta a uma pergunta dele
  // ("É essa?", "Quer que eu abra?") sempre com ferramentas — exceto saudação/cortesia pura (isHenryGreeting, dono
  // 2026-10-24: "só falei boa noite"), que nunca liga ferramentas, mesmo com uma pergunta antiga dele no histórico.
  const greeting = !image && isHenryGreeting(text);
  // Pergunta pessoal a ele ("como foi teu dia?", Treino 3) é papo: sem ferramentas, como o cumprimento.
  // Treino 4: pedido de piada (isCasualRequest) e concordância ("agora sim, três vendas…", isHenryAgreement — só sem pergunta
  // dele em aberto) também são papo, sem ferramentas.
  // Treino 5: "aquele cliente, como é que tá?" sem nome (isVagueClientReference) = pergunta o nome, sem ferramentas.
  // Treino 7: "voltando pro assunto do cliente" sem nome do cliente na conversa = pergunta o nome, sem ferramentas.
  // Treino 10: "tá longo demais, resume" = a última resposta em uma frase, sem consulta nova (sem ferramentas).
  const personal = !image && !greeting && !accepted && !screenOpen && !pending && (isPersonalQuestion(text) || isCasualRequest(text) || isVagueClientReference(text) || Boolean(henryResumeTopic(text, previous)?.needsName) || (isHenryAgreement(text) && !/\?\s*$/.test(lastAssistant)) || (isHenryShortenRequest(text) && Boolean(lastAssistant)));
  const withTools = Boolean(image) || (!greeting && !personal && (accepted || Boolean(reinterpreted) || Boolean(pending) || Boolean(deepen) || Boolean(screenOpen) || /\?\s*$/.test(lastAssistant) || henryNeedsTools(text))) || (!image && isMarketplaceApprovalCommand(text));
  // Rota direta (Treino 3, lib/henry-voice-turn.mjs): pergunta clara roda a ferramenta antes do modelo.
  // Recado à equipe ("peça para a Carol vir até a minha sala", dono 2026-10-25): vai para enviar_alerta_corretor.
  const teamAlert = withTools && !image && !locked && isTeamAlertRequest(text);
  // "pode atender"/"aprova"/"libera" (dono, 2026-10-26, MKT-2m): vai para aprovar_atendimento_marketplace.
  const marketplaceApproval = !image && !locked && !teamAlert && isMarketplaceApprovalCommand(text);
  // Período herdado lido na conversa do dia INTEIRA (Treino 4: o "ranking dessa semana" já tinha saído da janela do modelo).
  // Treino 11: aprofundar = a rota do gargalo (ou nenhuma: o modelo, com henryDeepenHint) — nunca a rota do pedido de antes
  // (daria a mesma frase de novo).
  const direct = withTools && !image && !accepted && !locked ? (deepen ? deepen.route : henryDirectRoute(reinterpreted || text, { turns: memoryTurns.length ? memoryTurns : previous, today: saoPauloDateKey() }) || (pending ? henryDirectRoute(pending.request, { turns: memoryTurns.length ? memoryTurns : previous, today: saoPauloDateKey() }) : null)) : null;
  // Leitura do pedido (Treino 2, 2026-10-25 — lib/henry-voice-turn.mjs): pedido com duas partes, cumprimento + pergunta,
  // "não foi isso que eu perguntei" e "bora voltar pro funil" viram uma instrução desta resposta (antes da dica de variação).
  const complaint = !greeting && Boolean(lastAssistant) && isHenryComplaint(text);
  const turnHint = greeting || accepted ? "" : henryTurnHint({ text, lastAssistant, turns: previous, direct });
  // Treino 10: releitura sem rota direta → o modelo responde o pedido de antes (nunca "o que você queria?" de novo).
  const answerHint = deepen && !direct ? henryDeepenHint(deepen.request, lastAssistant) : reinterpreted && !direct ? henryComplaintFallbackHint(reinterpreted) : pending && !direct ? henryPendingHint(pending) : turnHint;
  const hint = accepted ? "ele ACEITOU abrir o que você ofereceu: use abrir_tela ou abrir_cliente agora, sem perguntar de novo, e confirme em poucas palavras"
    : greeting ? "ele só te cumprimentou/agradeceu/se despediu: responda SÓ isso, numa frase curta e natural (ex.: \"Boa noite! Tudo certo por aqui.\"), sem números, sem resumo do CRM, sem dizer que vai verificar ou analisar nada e sem oferecer consulta"
    : [teamAlert ? "ele pediu um recado para alguém da equipe: use enviar_alerta_corretor agora (envia direto, sem perguntar se pode) e confirme com a sugestão de fala" : "", marketplaceApproval ? "ele mandou liberar o atendimento dos clientes do Marketplace que aguardam aprovação: use aprovar_atendimento_marketplace agora e confirme com a sugestão de fala" : "", answerHint, plan.hint].filter(Boolean).join("; ");
  // Treino 11: papo leva só as 2 últimas trocas, sem resumo do dia nem lembretes (contexto menor, resposta mais rápida).
  const casual = greeting || personal;
  if (casual) {
    const recent = casualModelHistory(previous);
    messages.splice(0, messages.length - 1, ...recent.map((turn) => ({ role: turn.role, content: turn.text })));
  }
  const promptExtras = { lockNote: locked ? buildHenryLockNote(lockedPhrase) : "", alertNote: locked ? "" : buildHenryAlertNote(alertState), notes: casual ? [] : notes, daySummary: casual ? "" : day.summary, usedOpenings: openingsFrom(memoryTurns), usedClosings: closingsFrom(memoryTurns), hint, webSearch, repertoire: plan.promptText, usedExpressions: plan.usedExpressions, tools: withTools };
  // Tempos (só números, sem conteúdo): modelo (1º pedaço de texto e total), ferramentas, rodadas.
  const timing = { modelMs: 0, firstTokenMs: null, toolsMs: 0, rounds: 0, tools: withTools, direct: direct?.name || "" };
  // Abertura repetida (dono, 2026-10-25: "'Ok, vou dar uma olhada nos números'. É tudo a mesma coisa"): a abertura
  // parecida com uma de hoje ou de "vou olhar" sai do começo da resposta (trimRepeatedOpening, lib/henry-repetition-core.mjs)
  // — na 1ª frase antecipada e na resposta final, com a MESMA regra (a voz antecipada só vale se bater com a final).
  // Saudação pura fica como veio.
  const usedOpeningSentences = greeting ? null : openingSentencesFrom(memoryTurns);
  const trimOpening = (value, options) => (usedOpeningSentences ? trimRepeatedOpening(value, usedOpeningSentences, options) : value);
  // 1ª frase da resposta (sem ferramenta pedida nesta rodada): vai para a voz antes do resto terminar.
  let firstSentenceSent = false;
  let roundText = "";
  const onText = typeof onFirstSentence === "function"
    ? (piece, { toolStarted }) => {
        if (firstSentenceSent || toolStarted) return;
        roundText += piece;
        const match = roundText.match(/^\s*(.{20,}?[.!?])\s/);
        if (!match) return;
        const first = trimOpening(match[1].trim(), { allowEmpty: true });
        // A frase toda era abertura: espera a próxima (sem voz antecipada se a resposta acabar nela).
        if (!first) return;
        firstSentenceSent = true;
        onFirstSentence(first);
      }
    : null;
  const allBlocks = [];
  let replyText = "";
  let rounds = 0;
  // Resposta cortada a uma pergunta do CRM ("Nenhuma delas"): uma rodada extra pedindo a resposta completa.
  const crmQuestion = !greeting && isCrmQuestion(text);
  let cutRetried = false;
  // Pergunta ignorada (Treino 2, 2026-10-25: "bota uma música tranquila e depois me diz quantos clientes novos entraram" só
  // tocou a música; "e aí, beleza? como tá o movimento hoje?" → "Tô bem, e você?"): a parte-pergunta ficou sem NENHUMA
  // ferramenta do CRM e a resposta sem conteúdo → UMA rodada extra pedindo só essa parte. O que já foi dito sobre a música
  // fica na frente da resposta.
  const questionPart = greeting || complaint || locked ? "" : henryQuestionPart(text);
  let unansweredRetried = false;
  let answeredBeforeRetry = "";
  // Promessa sem ação (Treino 3: "Vou puxar o funil deste mês agora…" sem ferramenta): UMA rodada que obriga a ferramenta.
  let promiseRetried = false;
  // Ação dita como feita sem a ferramenta (Treino 6: "Já abaixei o volume." sem nenhuma): UMA rodada que obriga a ferramenta.
  let claimRetried = false;
  // Papo barrado pela fala (Treino 11): UMA rodada extra.
  let barredRetried = false;
  // Mandou olhar a tela no lugar de responder (dono, 2026-10-26): UMA rodada que obriga a ferramenta.
  let deflectRetried = false;
  let forceTool = false;
  let skipModel = false;
  try {
    // Rota direta: a ferramenta roda já (sem esperar o modelo escolher). Frase pronta da ferramenta (speak) ou música tocando
    // = resposta sem nenhuma rodada do modelo; senão o modelo recebe o resultado como se tivesse pedido a ferramenta.
    // Treino 4: música + pergunta (direct.also) roda as duas ferramentas JUNTAS; volume e aparelho também respondem sem o
    // modelo (fala fixa curta: "Baixei o som.", "Passei a música pra Alexa.").
    if (direct) {
      context.directTopic = direct.topic;
      const steps = [direct, ...(direct.also ? [direct.also] : [])];
      const stamp = Date.now().toString(36);
      const blocks = steps.map((step, index) => ({ type: "tool_use", id: `toolu_direto_${stamp}_${index}`, name: step.name, input: step.input }));
      for (const block of blocks) {
        context.tools.push({ name: block.name, input: block.input });
        emit(henryProgressFor(block.name, block.input));
      }
      const toolsStarted = Date.now();
      // sequential (próxima faixa + troca de aparelho, Treino 7): um comando do Spotify depois do outro, nunca juntos.
      const contents = [];
      if (direct.sequential) for (const block of blocks) contents.push(await runTool(block.name, block.input, auth, context));
      else contents.push(...(await Promise.all(blocks.map((block) => runTool(block.name, block.input, auth, context)))));
      timing.toolsMs += Date.now() - toolsStarted;
      const musicDone = (step) => (step.name === "spotify" ? (step.input?.acao === "volume" ? Boolean(context.volumeLine) : step.input?.acao === "proxima" ? Boolean(context.controlLine) : Boolean(context.musicPlayed || context.spotify)) : step.name === "mudar_aparelho_spotify" && Boolean(context.deviceLine));
      // null = esta parte precisa do modelo; "" = já respondida pela fala fixa da música.
      const parts = steps.map((step, index) => {
        if (MUSIC_TOOL_NAMES.has(step.name)) return musicDone(step) ? "" : null;
        // Tela pedida (Treino 11): aberta = "Abrindo <tela>." (a frase de sempre da navegação, logo abaixo).
        if (step.name === "abrir_tela") return context.navigate ? "" : null;
        // speak "fixed" (diagnóstico e plano, Treino 8): a frase montada do gargalo é a resposta, também depois de "não foi isso".
        const fixed = step.speak === "fixed";
        const spoken = step.speak && (fixed || !complaint) && !context.providerFailed ? henryDirectSpeech(contents[index], { any: step.speak === "always" || fixed, fixed }) : "";
        return spoken || null;
      });
      if (parts.every((part) => part !== null)) {
        skipModel = true;
        replyText = parts.filter(Boolean).join(" ");
        if (direct.topic === "aprofundar") replyText = henryDeepenSpeech(replyText);
        else if (complaint && direct.speak === "fixed") replyText = `Foi mal. ${replyText}`;
      } else {
        messages.push({ role: "assistant", content: blocks });
        messages.push({ role: "user", content: blocks.map((block, index) => ({ type: "tool_result", tool_use_id: block.id, content: contents[index] })) });
      }
    }
    for (; !skipModel && rounds <= MAX_TOOL_ROUNDS; rounds += 1) {
      roundText = "";
      const toolChoice = forceTool ? { type: "any" } : null;
      forceTool = false;
      const data = await callModel(messages, { withImage: Boolean(image), vision: vision || Boolean(image), style, reportMode: context.reportMode, ...promptExtras, onText, toolChoice });
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
      if (data.stop_reason !== "tool_use" || !toolUses.length || rounds === MAX_TOOL_ROUNDS) {
        if (withTools && crmQuestion && !cutRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length && isCutReply(replyText)) {
          cutRetried = true;
          console.warn("[henry] resposta cortada para pergunta do CRM; nova rodada.");
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text) });
          messages.push({ role: "user", content: HENRY_CUT_REPLY_RETRY });
          continue;
        }
        const crmToolUsed = context.tools.some((tool) => !MUSIC_TOOL_NAMES.has(tool.name));
        if (withTools && questionPart && !unansweredRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length && !crmToolUsed && !replyAnswersQuestion(replyText)) {
          unansweredRetried = true;
          console.warn("[henry] parte-pergunta do pedido sem resposta; nova rodada.");
          if (context.musicPlayed) answeredBeforeRetry = replyText;
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text).length ? blocks.filter((block) => block.type === "text" && block.text) : [{ type: "text", text: "…" }] });
          messages.push({ role: "user", content: henryUnansweredRetry(questionPart) });
          // A 2ª chance OBRIGA uma ferramenta (Treino 3: a meta da equipe ficou sem ferramenta mesmo na rodada extra) — menos
          // com a música já tocando (a ferramenta obrigatória poderia tocar de novo).
          forceTool = !context.musicPlayed;
          continue;
        }
        if (withTools && !promiseRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length && henryPromisedAction(replyText)) {
          promiseRetried = true;
          console.warn("[henry] prometeu buscar e não buscou; nova rodada com ferramenta obrigatória.");
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text) });
          messages.push({ role: "user", content: henryPromiseRetry() });
          forceTool = !context.musicPlayed;
          continue;
        }
        // Dono, 2026-10-26: "O detalhe por cliente você só encontra abrindo a lista" / "Lá você vê a origem" sem ter buscado
        // (nenhuma ferramenta do CRM, ou nenhuma resposta com número) → a mesma rodada que obriga a ferramenta.
        if (withTools && !deflectRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length && henryScreenDeflection(replyText) && (!crmToolUsed || !/\d/.test(replyText))) {
          deflectRetried = true;
          console.warn("[henry] mandou olhar a tela sem responder; nova rodada com ferramenta obrigatória.");
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text) });
          messages.push({ role: "user", content: HENRY_DEFLECT_RETRY });
          forceTool = true;
          continue;
        }
        // Treino 8: "Não achei nenhum cliente chamado Joana" / "a consulta não voltou" sem nenhuma ferramenta de leitura =
        // busca dita sem busca → a mesma rodada que obriga a ferramenta (pesquisa na internet e imagem não contam).
        const claimed = withTools && !claimRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length
          ? henryClaimedActionWithoutTool(replyText, context.tools.map((tool) => tool.name)) || (!image && !usage.webSearches && !locked ? henryClaimedLookupWithoutTool(replyText, context.tools.map((tool) => tool.name)) : null)
          : null;
        // Treino 11: papo (piada, cumprimento, pergunta pessoal) que a barreira da fala barraria → UMA rodada pedindo outra
        // resposta sem número nem palavra barrada (nunca "abra a tela" quando não há tela).
        if ((greeting || personal) && !image && !barredRetried && rounds < MAX_TOOL_ROUNDS && !toolUses.length && isBarredForSpeech(replyText)) {
          barredRetried = true;
          console.warn("[henry] papo barrado pela fala; nova rodada.");
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text) });
          messages.push({ role: "user", content: HENRY_BARRED_CASUAL_RETRY });
          continue;
        }
        if (claimed) {
          claimRetried = true;
          console.warn(`[henry] disse que fez (${claimed.kind}) sem a ferramenta; nova rodada com ferramenta obrigatória.`);
          messages.push({ role: "assistant", content: blocks.filter((block) => block.type === "text" && block.text) });
          messages.push({ role: "user", content: claimed.retry });
          forceTool = true;
          continue;
        }
        break;
      }
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
    if (timing.rounds) logModelUsage(auth, feature, usage); // rota direta sem modelo: nada a registrar
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
  // Só o texto do MODELO perde a abertura repetida (as falas fixas da música abaixo já variam sozinhas).
  // Rótulo no começo ("Feito: são 3 vendas…", Treino 5; "Suspense:", Treino 1) sai da fala (stripSpeechLabel).
  // Cumprimento puro nunca traz número nem assunto do CRM (Treino 7: "boa tarde" → "…a equipe já fez 4 atendimentos").
  if (greeting) replyText = henryGreetingReply(replyText, text);
  replyText = stripSpeechLabel(trimOpening(replyText));
  // Fechamento repetido ("é só chamar" a cada agradecimento — Treino, 2026-10-25): o final parecido com um de hoje sai.
  // Vale também para cumprimento/agradecimento (é onde o bordão aparece).
  replyText = trimRepeatedClosing(replyText, promptExtras.usedClosings);
  const musicOnly = context.tools.length > 0 && context.tools.every((tool) => MUSIC_TOOL_NAMES.has(tool.name));
  // Treino 9: papo casual (cumprimento, pergunta pessoal, piada, concordância) termina sem oferta ("Quer que eu dê mais uma, ou
  // prefere saber do CRM?", "Qualquer coisa, é só chamar."); resposta da rota direta (o número já veio) termina sem oferecer
  // outra consulta ("Quer que eu veja em qual etapa a gente mais perde gente?") — oferta de abrir tela continua.
  if (greeting || personal) replyText = trimCasualOffer(replyText);
  else if (direct && !skipModel) replyText = trimTrailingOffer(replyText, { keepOpen: true });
  // Treino 12: "tá longo demais, resume" → o resumo mantém o período da resposta resumida e não começa com "Vendas?".
  if (!direct && lastAssistant && isHenryShortenRequest(text)) replyText = henryShortenedReply(replyText, lastAssistant, memoryTurns.length ? memoryTurns : previous);
  // Reclamação respondida com a MESMA resposta (Treino 2: "não foi isso que eu perguntei" → "Foram 3 vendas" de novo): troca
  // por uma frase que reconhece e pergunta o que ele queria saber.
  // Com rota direta a pergunta nova é clara ("quanto falta pra fechar essas vendas" → funil): os mesmos números são a resposta
  // certa (Treino 5), não repetição.
  // Treino 13: a mesma frase do gargalo (mesmas etapas + mesma queda) nunca sai duas vezes no dia — resumo pedido é exceção.
  if (!isHenryShortenRequest(text)) replyText = henryDropRepeatedBottleneck(replyText, saidToday);
  if (complaint && !direct && henryRepeatedAfterComplaint(replyText, lastAssistant)) {
    replyText = pickComplaintReply(memoryTurns.filter((turn) => turn?.role === "assistant").map((turn) => turn.text));
  }
  // Pedido composto respondido na rodada extra: a confirmação da música (do modelo, ou a fala fixa) vai na frente.
  if (unansweredRetried && context.musicPlayed && replyText) {
    const musicLine = answeredBeforeRetry && !replyAnswersQuestion(answeredBeforeRetry) ? answeredBeforeRetry : musicPlayingLine(context.musicPlayed, { opener: pickMusicPlayingOpener(openingsFrom(memoryTurns)) });
    if (!replyText.startsWith(musicLine)) replyText = `${musicLine} ${replyText}`;
  }
  // Spotify fechado: fala fixa e curta enquanto a tela abre o app (o play vem depois, em /api/admin/henry/spotify/play).
  if (context.spotify && musicOnly) replyText = "Abrindo o Spotify…";
  // Tocou direto (aparelho aberto): "Pronto, tá tocando!" (ou outro começo, sem repetir hoje) + faixa e artista.
  else if (context.musicPlayed && musicOnly) replyText = [musicPlayingLine(context.musicPlayed, { opener: pickMusicPlayingOpener(openingsFrom(memoryTurns)) }), context.deviceLine].filter(Boolean).join(" ");
  // Troca de aparelho (dono, 2026-10-23): fala fixa e curta ("Pronto, passei pra Alexa.", "Voltou pro computador.").
  else if (context.deviceLine && musicOnly) replyText = [context.controlLine, context.deviceLine].filter(Boolean).join(" ");
  // Volume aplicado (Treino 4, 2026-10-25: "Baixei o som. Se quiser, é só falar de novo que eu ajusto de novo."): só a frase curta.
  else if (context.volumeLine && musicOnly) replyText = context.volumeLine;
  else if (context.controlLine && musicOnly) replyText = context.controlLine;
  // Música + pergunta respondidas pela rota direta: a confirmação da música vai na frente da resposta.
  if (skipModel && direct?.also && (context.musicPlayed || context.spotify)) {
    const musicLine = context.spotify ? "Abrindo o Spotify…" : musicPlayingLine(context.musicPlayed, { opener: pickMusicPlayingOpener(openingsFrom(memoryTurns)) });
    replyText = `${musicLine} ${replyText}`.trim();
  }
  // Barreira final (Treino 6): continua dizendo que fez a ação sem a ferramenta dela → diz que não fez (nunca a mentira).
  const stillClaimed = henryClaimedActionWithoutTool(replyText, context.tools.map((tool) => tool.name));
  if (stillClaimed) {
    console.warn(`[henry] resposta dizia que fez (${stillClaimed.kind}) sem a ferramenta; trocada.`);
    replyText = stillClaimed.fail;
  }
  // Treino 8: continua dizendo que buscou e não achou sem ter buscado → diz que ainda não buscou (nunca a mentira).
  const stillLookup = withTools && !image && !usage.webSearches && !locked ? henryClaimedLookupWithoutTool(replyText, context.tools.map((tool) => tool.name)) : null;
  if (stillLookup) {
    console.warn("[henry] resposta dizia que buscou sem ferramenta; trocada.");
    replyText = stillLookup.fail;
  }
  // Treino 8: "A ferramenta não entendeu essa consulta" — fala interna nunca chega ao dono (stripInternalTalk).
  replyText = stripInternalTalk(replyText);
  // Português do Brasil (Treino 6: "Tens razão, desculpa."): "Tem razão".
  replyText = replyText.replace(/\b([Tt])ens razão\b/g, "$1em razão");
  const reply = safeHenryReply(stripUrls(replyText) || fallback, { screenFallback: Boolean(detail), casualFallback: (greeting || personal) && !detail && !context.navigate });
  rememberExchange(auth, text, reply, accepted ? { ...plan, hint: "" } : plan);
  // Cena da resposta pelo que já aconteceu aqui (ferramentas, pesquisa) — sem chamada extra de IA.
  const kind = pickHenryAnswerScene({ tools: context.tools, webSearches: usage.webSearches });
  const scene = kind === "comparativo" && context.chart ? { kind, chart: context.chart } : kind === "musica" && context.music ? { kind, music: context.music } : { kind };
  timing.toolNames = context.tools.map((tool) => tool.name); // Treino: quais ferramentas rodaram (só os nomes)
  return { reply, navigate: context.navigate, openUrl: context.openUrl, spotify: context.spotify, detail, scene, timing, ...(context.spotifyMoved ? { spotifyMoved: true } : {}), ...(Number.isInteger(context.spotifyVolumeSet) ? { spotifyVolumeSet: context.spotifyVolumeSet } : {}) };
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

// --- Fala para texto AO VIVO no aperte-para-falar (REGRA OFICIAL — dono, 2026-10-24) ---------------------------------
// Devolve só o endereço do WebSocket com um token de USO ÚNICO (15 min, consumido na conexão) — a chave nunca sai do
// servidor. Nenhum áudio passa por aqui. Falha = { url: "" } (o navegador segue com a gravação de sempre).
export async function createHenryLiveSttUrl() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { url: "", reason: "sem_chave" };
  const { url, method } = buildElevenLabsRealtimeTokenRequest();
  try {
    const response = await fetch(url, { method, headers: { "xi-api-key": key }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      console.warn(`[henry] token da fala ao vivo recusado (${response.status}).`);
      return { url: "", reason: `status_${response.status}` };
    }
    const wsUrl = buildElevenLabsRealtimeUrl({ token: parseElevenLabsRealtimeToken(await response.json().catch(() => null)) });
    return wsUrl ? { url: wsUrl } : { url: "", reason: "token_invalido" };
  } catch (error) {
    console.warn(`[henry] token da fala ao vivo falhou (${error?.name === "TimeoutError" ? "timeout" : "erro"}).`);
    return { url: "", reason: "erro" };
  }
}

// Custo da sessão ao vivo (henry_voice_stt, modelo scribe_v2_realtime): o navegador informa quanto áudio enviou; o
// servidor limita a 27 s (25 s de teto da gravação + folga). Só números.
export async function recordHenryLiveSttUsage(auth, { durationMs = 0, ok = true } = {}) {
  const seconds = Math.min(27, Math.max(0, Number(durationMs) || 0) / 1000);
  if (!seconds) return;
  background(recordAiUsage({
    feature: "henry_voice_stt",
    model: ELEVENLABS_STT_REALTIME_MODEL,
    triggeredBy: auth.profile?.id,
    costUsd: estimateElevenLabsRealtimeSttCostUsd(seconds),
    ...(ok ? {} : { success: false, errorMessage: "elevenlabs stt ao vivo: falhou (gravação de reserva)" })
  }));
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
