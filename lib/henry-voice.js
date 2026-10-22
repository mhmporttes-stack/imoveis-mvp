import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { recordAiUsage } from "./ai-usage";
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
  VISION_QUESTION_NOTE,
  buildComplimentPrompt,
  henryEnabledFromSetting,
  henryVisionFromSetting,
  parseComplimentReply,
  rememberCompliment,
  composeHenryDailyReport,
  estimateHenryModelCostUsd,
  estimateHenryTtsCostUsd,
  resolveHenryNavigation,
  safeHenryReply,
  sanitizeHistory
} from "./henry-voice-core.mjs";

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
const HENRY_COMPLIMENTS_SETTING_ID = "henry_voice_compliments";
const TTS_INSTRUCTIONS ="Fale em português do Brasil, com sotaque brasileiro natural, tom cordial e profissional, ritmo ágil, como um assistente de escritório.";

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

export async function readHenrySettings() {
  const value = await readSettingRow(HENRY_SETTING_ID);
  return { enabled: henryEnabledFromSetting(value), vision: henryVisionFromSetting(value) };
}

// patch = { enabled?, vision? } (booleanos); o resto do registro é preservado.
export async function setHenrySettings(auth, patch = {}) {
  const current = await readSettingRow(HENRY_SETTING_ID);
  const next = { ...current };
  if (typeof patch.enabled === "boolean") next.disabled = !patch.enabled;
  if (typeof patch.vision === "boolean") next.vision = patch.vision;
  await writeSettingRow(auth, HENRY_SETTING_ID, next);
  return { enabled: henryEnabledFromSetting(next), vision: henryVisionFromSetting(next) };
}

export function isHenryVoiceConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// --- Relatório do dia (mesma fonte e mesma frase da tela Início) ------------------------------------------------------
// Dono: resumo ampliado do Início (INI-5, getPainelInicioDono — o mesmo que a Alexa fala); se falhar ou demorar, a frase
// do assistente do Início (getPainelInicio).
async function loadReportSources(auth) {
  const inicio = await getPainelInicio(auth);
  const owner = await withTimeout(getPainelInicioDono(auth, inicio), OWNER_SUMMARY_TIMEOUT_MS).catch((error) => {
    console.warn(`[henry] resumo do dono indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}); usando o do Início.`);
    return null;
  });
  return { inicio, ownerText: owner?.text || "" };
}

async function buildDailyReport(auth) {
  const { inicio, ownerText } = await loadReportSources(auth);
  return composeHenryDailyReport(inicio, { ownerText });
}

// --- Visão: elogio do "bom dia" (HENRY-2) ----------------------------------------------------------------------------
// A imagem só passa pela memória desta função; NUNCA é gravada nem logada. Guarda-se só o TEXTO dos últimos elogios
// (crm_settings henry_voice_compliments) para variar. Qualquer falha → "" (segue sem elogio, sem erro falado).
async function buildCompliment(auth, image) {
  if (!image) return "";
  const usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const memory = await readSettingRow(HENRY_COMPLIMENTS_SETTING_ID).catch(() => ({}));
    const recent = Array.isArray(memory.recent) ? memory.recent : [];
    const data = await callAnthropic({
      system: buildComplimentPrompt(recent),
      max_tokens: 120,
      messages: [{ role: "user", content: [imageBlock(image), { type: "text", text: "Elogio de hoje." }] }]
    });
    usage.inputTokens = Number(data.usage?.input_tokens) || 0;
    usage.outputTokens = Number(data.usage?.output_tokens) || 0;
    const text = parseComplimentReply((data.content || []).filter((block) => block.type === "text").map((block) => block.text).join(" "));
    await recordAiUsage({ feature: "henry_voice_vision", model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage) });
    if (text) await writeSettingRow(auth, HENRY_COMPLIMENTS_SETTING_ID, { recent: rememberCompliment(recent, text) }).catch(() => {});
    console.info(`[henry] elogio: ${text ? "ok" : "pulado"}.`);
    return text;
  } catch (error) {
    console.warn(`[henry] elogio falhou (${error?.name === "TimeoutError" ? "timeout" : "erro"}); segue sem elogio.`);
    await recordAiUsage({ feature: "henry_voice_vision", model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, success: false, errorMessage: "elogio falhou" });
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
  context.brokers ||= makeBrokerMatcher(await loadBrokerList().catch(() => []));
  const deps = {
    providers: getV2Providers(),
    brokers: context.brokers,
    today: () => saoPauloDateKey(),
    timeoutMs: TOOL_TIMEOUT_MS,
    onProviderError: (topic, error) => console.warn(`[henry] provedor falhou (assunto=${topic}): ${error?.message === "timeout" ? "timeout" : error?.name || "erro"}.`)
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

async function runTool(name, input, auth, context) {
  try {
    if (name === "consultar_crm") return await consultCatalog(input || {}, context);
    if (name === "relatorio_do_dia") {
      const report = await withTimeout(buildDailyReport(auth), OWNER_SUMMARY_TIMEOUT_MS + 3000);
      return report || "Relatório indisponível agora.";
    }
    if (name === "clientes_esfriados_pendentes") {
      const { items } = await withTimeout(listMyCooledDecisions(auth), TOOL_TIMEOUT_MS);
      return JSON.stringify({ aguardando_sua_decisao: (items || []).length });
    }
    if (name === "whatsapp_dos_corretores") {
      const { rows } = await withTimeout(getWhatsappSessionHealth(auth), TOOL_TIMEOUT_MS);
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

function systemPrompt() {
  const today = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return `Você é o Henry, assistente de voz do CRM do Matheus Machado Corretor de Imóveis (Marília/SP, Minha Casa Minha Vida). Quem fala com você é o dono, Matheus. Agora: ${today} (horário de Brasília).
Regras:
- Sua resposta será FALADA em voz alta: português do Brasil, 1 a 3 frases curtas, sem markdown, sem listas, sem emojis, sem siglas soletradas.
- Todo número ou nome do CRM vem SEMPRE de uma ferramenta. Nunca invente nem estime. Se a ferramenta não trouxer, diga que não conseguiu buscar.
- Você só CONSULTA. Não envia mensagem, não transfere cliente, não muda status nem cadastro. Se ele pedir uma ação dessas, diga que por voz isso ainda não é possível e ofereça abrir a tela certa com abrir_tela.
- Quando ele pedir para abrir, mostrar ou ir para uma tela, use abrir_tela e confirme em poucas palavras.
- Nunca fale CPF, renda, salário, FGTS, telefone, e-mail, valores em reais nem dados de financiamento; use só contagens e primeiros nomes.
- Se a pergunta não for sobre o CRM, responda em uma frase e volte ao trabalho.`;
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

function callModel(messages, { withImage = false } = {}) {
  return callAnthropic({ max_tokens: 600, system: withImage ? `${systemPrompt()}\n- ${VISION_QUESTION_NOTE}` : systemPrompt(), tools: TOOLS, messages });
}

// mode "report" = "bom dia, Henry" sem pergunta → relatório do dia (sem IA; com a visão ligada e imagem, elogio antes).
// mode "question" = pergunta livre (com imagem quando a pergunta tem intenção visual e a visão está ligada).
// image = { mediaType, data } validada por parseHenryImage; só vive nesta chamada.
export async function answerHenry(auth, { mode = "question", question = "", history = [], image = null } = {}) {
  if (mode === "report") {
    const [compliment, { inicio, ownerText }] = await Promise.all([buildCompliment(auth, image), loadReportSources(auth)]);
    // A barreira da fala troca a frase INTEIRA quando algo é sensível: tenta com elogio, sem elogio e, por fim, só o Início
    // (o elogio ou uma "atenção" nunca derrubam o relatório).
    const attempts = [{ ownerText, compliment }, { ownerText }, {}];
    let reply = "";
    for (const options of attempts) {
      const text = composeHenryDailyReport(inicio, options);
      if (text && safeHenryReply(text) !== HENRY_FALLBACK_REPLY) {
        reply = safeHenryReply(text);
        break;
      }
    }
    console.info(`[henry] relatório do dia: ${reply ? "ok" : "indisponível"}${reply && compliment && reply.includes(compliment) ? " (com elogio)" : ""}.`);
    return { reply: reply || `Olá, ${HENRY_OWNER_SPOKEN_NAME}. Não consegui montar o relatório agora.`, navigate: null };
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
      const data = await callModel(messages, { withImage: Boolean(image) });
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
    await recordAiUsage({ feature, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage) });
  } catch (error) {
    await recordAiUsage({ feature, model: HENRY_MODEL, triggeredBy: auth.profile?.id, ...usage, costUsd: estimateHenryModelCostUsd(usage), success: false, errorMessage: error?.message });
    throw error;
  }
  console.info(`[henry] pergunta: ok (rodadas=${rounds + 1}${context.navigate ? ", abriu tela" : ""}).`);
  const fallback = context.navigate ? `Abrindo ${context.navigate.label}.` : "Não consegui responder agora.";
  return { reply: safeHenryReply(replyText || fallback), navigate: context.navigate };
}

// Voz do servidor (OpenAI). Sem chave ou com falha → null, e o navegador fala com a voz dele (speechSynthesis).
export async function synthesizeHenrySpeech(auth, text) {
  const token = process.env.OPENAI_API_KEY;
  if (!token || !text) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, instructions: TTS_INSTRUCTIONS, response_format: "mp3" }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await recordAiUsage({ feature: "henry_voice_tts", model: TTS_MODEL, triggeredBy: auth.profile?.id, costUsd: estimateHenryTtsCostUsd(text) });
    return { base64: buffer.toString("base64"), contentType: "audio/mpeg" };
  } catch (error) {
    console.warn(`[henry] voz do servidor falhou (${error?.name === "TimeoutError" ? "timeout" : error?.message || "erro"}); o navegador fala.`);
    await recordAiUsage({ feature: "henry_voice_tts", model: TTS_MODEL, triggeredBy: auth.profile?.id, success: false, errorMessage: error?.message });
    return null;
  }
}
