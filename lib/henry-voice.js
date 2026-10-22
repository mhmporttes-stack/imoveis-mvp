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
const MAX_REPLY_TOKENS = 300; // resposta falada = 1 a 3 frases curtas (≤ 700 caracteres)
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

export async function readHenrySettings() {
  const value = await readSettingRow(HENRY_SETTING_ID);
  return { enabled: henryEnabledFromSetting(value), vision: henryVisionFromSetting(value), mobileWake: value.mobileWake === true, style: resolveStyle(value.style) };
}

// patch = { enabled?, vision?, mobileWake? } (booleanos) e style? (já validado por parseHenryStylePatch); o resto do registro
// é preservado. mobileWake = "Ouvir 'Henry' com o app aberto" no celular (nasce desligado: lá o padrão é tocar para falar).
export async function setHenrySettings(auth, patch = {}) {
  const current = await readSettingRow(HENRY_SETTING_ID);
  const next = { ...current };
  if (typeof patch.enabled === "boolean") next.disabled = !patch.enabled;
  if (typeof patch.vision === "boolean") next.vision = patch.vision;
  if (typeof patch.mobileWake === "boolean") next.mobileWake = patch.mobileWake;
  if (patch.style) next.style = mergeHenryStyle(current.style, patch.style);
  await writeSettingRow(auth, HENRY_SETTING_ID, next);
  return { enabled: henryEnabledFromSetting(next), vision: henryVisionFromSetting(next), mobileWake: next.mobileWake === true, style: resolveStyle(next.style) };
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

// Reaproveita o roteador da Alexa V2 (buildQuery + answerQuery): mesmos provedores, mesmas frases, mesmos números.
async function consultCatalog(input, context) {
  const assunto = TOPIC_IDS.includes(input?.assunto) ? input.assunto : "";
  if (!assunto) return "Assunto desconhecido.";
  context.brokers ||= makeBrokerMatcher(await cachedRead("brokers", () => loadBrokerList()).catch(() => []));
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

// Ferramentas de leitura com o mesmo pedido em até ~45 s → mesma resposta do cache (só respostas boas entram).
async function runTool(name, input, auth, context) {
  try {
    if (name === "consultar_crm") {
      const query = input || {};
      const key = `tool:${auth?.profile?.id || ""}:${JSON.stringify(query)}`;
      const text = await cachedRead(key, () => consultCatalog(query, context));
      if (context.providerFailed) dataCache.delete(key);
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

function systemPrompt(style) {
  const today = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return `Você é o Henry, assistente de voz do CRM do Matheus Machado Corretor de Imóveis (Marília/SP, Minha Casa Minha Vida). Quem fala com você é o dono, Matheus. Agora: ${today} (horário de Brasília).
Regras:
- Sua resposta será FALADA em voz alta: português do Brasil, 1 a 3 frases curtas, sem markdown, sem listas, sem emojis, sem siglas soletradas.
- Todo número ou nome do CRM vem SEMPRE de uma ferramenta. Nunca invente nem estime. Se a ferramenta não trouxer, diga que não conseguiu buscar.
- Você só CONSULTA. Não envia mensagem, não transfere cliente, não muda status nem cadastro. Se ele pedir uma ação dessas, diga que por voz isso ainda não é possível e ofereça abrir a tela certa com abrir_tela.
- Quando ele pedir para abrir, mostrar ou ir para uma tela, use abrir_tela e confirme em poucas palavras.
- Nunca fale CPF, renda, salário, FGTS, telefone, e-mail, valores em reais nem dados de financiamento; use só contagens e primeiros nomes.
- Se a pergunta não for sobre o CRM, responda em uma frase e volte ao trabalho.
- É uma conversa: perguntas curtas como "e ontem?" ou "e da Carol?" continuam o assunto anterior. Se a resposta tiver muitos itens, fale só o resumo e ofereça abrir a tela com o detalhe.
${buildHenryStylePrompt(style)}`;
}

// Chamada única à Anthropic (fetch direto, sem SDK). O corpo pode levar a imagem da webcam: nunca é logado.
async function callAnthropic(payload) {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) throw Object.assign(new Error("Assistente de voz não configurado (ANTHROPIC_API_KEY)."), { status: 503 });
  const fastControls = /haiku-5/.test(HENRY_MODEL) ? { thinking: { type: "disabled" }, output_config: { effort: "low" } } : {};
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": token, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: HENRY_MODEL, ...payload, ...fastControls }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Falha na IA (HTTP ${response.status}).`);
  return data;
}

// vision = visão ligada na configuração (estado mandado ao modelo a cada pedido); withImage = veio quadro da câmera.
function callModel(messages, { withImage = false, vision = false, style } = {}) {
  return callAnthropic({ max_tokens: MAX_REPLY_TOKENS, system: `${systemPrompt(style)}\n- ${buildHenryVisionNote({ vision, withImage })}`, tools: TOOLS, messages });
}

// mode "report" = "bom dia, Henry" sem pergunta → relatório do dia (sem IA; com a visão ligada e imagem, elogio antes).
// mode "question" = pergunta livre (com imagem quando a pergunta tem intenção visual e a visão está ligada).
// image = { mediaType, data } validada por parseHenryImage; só vive nesta chamada. style = readHenrySettings().style.
export async function answerHenry(auth, { mode = "question", question = "", history = [], image = null, style = null, vision = false } = {}) {
  const address = henryAddressName(style);
  if (mode === "report") {
    // Elogio com prazo curto: se a visão demorar, o relatório sai sem ele (a chamada termina sozinha e registra o custo).
    const compliment = image ? withTimeout(buildCompliment(auth, image, style), COMPLIMENT_TIMEOUT_MS).catch(() => {
      console.warn("[henry] elogio passou do prazo; relatório sem elogio.");
      return "";
    }) : "";
    const [complimentText, { inicio, ownerText }] = await Promise.all([compliment, loadReportSources(auth)]);
    // A barreira da fala troca a frase INTEIRA quando algo é sensível: tenta com elogio, sem elogio e, por fim, só o Início
    // (o elogio ou uma "atenção" nunca derrubam o relatório).
    const attempts = [{ ownerText, compliment: complimentText, address }, { ownerText, address }, { address }];
    let reply = "";
    for (const options of attempts) {
      const text = composeHenryDailyReport(inicio, options);
      if (text && safeHenryReply(text) !== HENRY_FALLBACK_REPLY) {
        reply = safeHenryReply(text);
        break;
      }
    }
    console.info(`[henry] relatório do dia: ${reply ? "ok" : "indisponível"}${reply && complimentText && reply.includes(complimentText) ? " (com elogio)" : ""}.`);
    return { reply: reply || `Olá, ${address || HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`, navigate: null };
  }

  const context = { navigate: null, brokers: null };
  const text = String(question || "").trim();
  const messages = [
    ...sanitizeHistory(history).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: image ? [imageBlock(image), { type: "text", text }] : text }
  ];
  const feature = image ? "henry_voice_vision" : "henry_voice_assistant";
  const usage = { inputTokens: 0, outputTokens: 0 };
  let replyText = "";
  let rounds = 0;
  try {
    for (; rounds <= MAX_TOOL_ROUNDS; rounds += 1) {
      const data = await callModel(messages, { withImage: Boolean(image), vision: vision || Boolean(image), style });
      usage.inputTokens += Number(data.usage?.input_tokens) || 0;
      usage.outputTokens += Number(data.usage?.output_tokens) || 0;
      const blocks = data.content || [];
      replyText = blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
      const toolUses = blocks.filter((block) => block.type === "tool_use");
      if (data.stop_reason !== "tool_use" || !toolUses.length || rounds === MAX_TOOL_ROUNDS) break;
      messages.push({ role: "assistant", content: blocks });
      const results = await Promise.all(toolUses.map(async (block) => ({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input, auth, context) })));
      messages.push({ role: "user", content: results });
    }
    background(recordAiUsage({ feature, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage) }));
  } catch (error) {
    background(recordAiUsage({ feature, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage), success: false, errorMessage: error?.message }));
    throw error;
  }
  console.info(`[henry] pergunta: ok (rodadas=${rounds + 1}${context.navigate ? ", abriu tela" : ""}).`);
  const fallback = context.navigate ? `Abrindo ${context.navigate.label}.` : "Não consegui responder agora.";
  return { reply: safeHenryReply(replyText || fallback), navigate: context.navigate };
}

// Voz do servidor: ElevenLabs (endpoint de streaming) → OpenAI → null (o navegador fala com a melhor voz pt-BR dele).
// style = voz/tom/velocidade da tela; context = { previousText, nextText } quando a fala vai em partes (continuidade).
// Cada tentativa (ok ou falha) vai para ai_usage_log (henry_voice_tts, model = id do modelo do provedor).
export async function synthesizeHenrySpeech(auth, text, style = null, context = {}) {
  if (!text) return null;
  for (const provider of henryProviderChain(providerEnv())) {
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
