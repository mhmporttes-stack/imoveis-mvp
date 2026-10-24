// Provedores de voz do Henry (decisão do dono, 2026-10-22: "usar a ElevenLabs como voz principal" — docs/BUSINESS_RULES.md
// HENRY-1, "Voz natural"). Núcleo PURO (sem rede, sem segredo): escolha do provedor, montagem do pedido à ElevenLabs,
// leitura da lista de vozes, custo estimado e a melhor voz pt-BR do navegador (reserva). Usado por lib/henry-voice.js,
// pelo navegador (components/henry/*) e pelos testes.
//
// Ordem: ElevenLabs (com ELEVENLABS_API_KEY) → OpenAI (com OPENAI_API_KEY) → voz do PC (Piper, só no app de desktop,
// fase 1.1 de 2026-10-23) → voz do navegador. As duas primeiras são do servidor (henryProviderChain); as reservas, do
// aparelho (henryReserveVoiceChain).
// Conferido na documentação oficial da ElevenLabs em 2026-10-22: modelo de menor latência com português =
// eleven_flash_v2_5 (~75 ms); endpoint POST /v1/text-to-speech/{voice_id}/stream (MP3 por padrão); voice_settings com
// stability, similarity_boost, style, use_speaker_boost e speed (1 = normal; a faixa não é documentada — usamos 0,92 a 1,10);
// lista de vozes em GET /v2/voices; preço da API Flash/Turbo US$ 0,04 por mil caracteres, demais US$ 0,08.

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_flash_v2_5";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128"; // padrão da API, disponível em todos os planos
export const HENRY_PROVIDER_LABELS = Object.freeze({
  elevenlabs: "ElevenLabs (voz natural)",
  openai: "OpenAI",
  "piper-local": "voz do PC (Piper)",
  browser: "voz do navegador"
});

export function chooseHenryVoiceProvider({ elevenLabsKey, openAiKey } = {}) {
  if (String(elevenLabsKey || "").trim()) return "elevenlabs";
  if (String(openAiKey || "").trim()) return "openai";
  return "browser";
}

// Sequência de tentativas: ElevenLabs falhou → OpenAI (se houver chave) → navegador.
export function henryProviderChain(env = {}) {
  const chain = [];
  if (String(env.elevenLabsKey || "").trim()) chain.push("elevenlabs");
  if (String(env.openAiKey || "").trim()) chain.push("openai");
  return chain;
}

// Reserva no aparelho quando o servidor não mandou áudio (ElevenLabs e OpenAI falharam ou não existem): no app de desktop
// (window.mmDesktop com speakLocal) o Piper do PC vem ANTES da voz do navegador; fora do app, só o navegador.
export function henryReserveVoiceChain({ desktopLocalVoice = false } = {}) {
  return desktopLocalVoice ? ["piper-local", "browser"] : ["browser"];
}

// ID de voz da ElevenLabs: só letras e números (evita montar URL com texto qualquer).
export function isElevenLabsVoiceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{10,40}$/.test(value);
}

// Velocidade da tela "Voz e personalidade" → voice_settings.speed.
export const ELEVENLABS_SPEED = Object.freeze({ calmo: 0.92, normal: 1, rapido: 1.1 });

// Tom → ajuste fino da voz (estabilidade mais baixa = mais expressiva; style moderado = mais conversacional).
// Tom amigo (padrão, dono 2026-10-22: "como se ele fosse um amigo batendo um papo"; depois "quero que ele seja mais
// expressivo"): estabilidade baixa (0,26) e estilo alto (0,6) = mais emoção e variação de entonação, menos "lido";
// abaixo de ~0,25 de estabilidade a voz começa a oscilar. Speaker boost ligado. Tom não informado = amigo.
const TONE_SETTINGS = Object.freeze({
  profissional: { stability: 0.45, style: 0.15 },
  carismatico: { stability: 0.35, style: 0.35 },
  descontraido: { stability: 0.26, style: 0.6 },
  executivo: { stability: 0.55, style: 0.1 }
});

export function elevenLabsVoiceSettings(style = {}) {
  const tone = TONE_SETTINGS[style?.tone] || TONE_SETTINGS.descontraido;
  return {
    stability: tone.stability,
    similarity_boost: 0.85,
    style: tone.style,
    use_speaker_boost: true,
    speed: ELEVENLABS_SPEED[style?.speed] || 1
  };
}

// Pronúncia brasileira do nome (pedido do dono, 2026-10-22: "fala o nome dele meio americanizado"). Só no que vai
// para a voz (ElevenLabs/OpenAI/navegador); o texto na tela continua "Henry".
export function pronounceForSpeech(text) {
  return feminineNumbers(laughForSpeech(String(text || "").replace(/\bHenry\b/gi, "Rênri")));
}

// Risada falada (dono, 2026-10-22: "mais risadas"). Com language_code "pt" o H é mudo ("haha" sai "a-a") e "kkk" vira
// "cá cá cá"; em português o R inicial soa como o H do inglês, então "rárá"/"rarará" soa como risada. Só na voz: na tela
// continua "haha". [PENDENTE DE VALIDAÇÃO] grafia escolhida pela fonética do português, sem teste de ouvido na
// ElevenLabs flash (sem chave no ambiente de desenvolvimento).
export function laughForSpeech(text) {
  return String(text || "")
    .replace(/\b(?:ha){3,}h?\b|\b(?:he){3,}\b|\bk{3,}\b|\b(?:rs){2,}\b/gi, "rarará")
    .replace(/\b(?:ha){2}h?\b|\b(?:he){2}\b/gi, "rárá");
}

// Concordância de gênero dos números na voz (dono, 2026-10-22: "21 prospecções" saía "vinte e UM prospecções").
// Só números inteiros seguidos de palavra feminina, e só quando a forma falada muda (1, 2 e centenas 200–900):
// "21 prospecções" → "vinte e uma prospecções", "2 simulações" → "duas simulações", "200 pessoas" → "duzentas pessoas".
const FEMININE_WORDS = new Set([
  "prospeccao", "prospeccoes", "simulacao", "simulacoes", "atividade", "atividades", "pessoa", "pessoas", "hora", "horas",
  "venda", "vendas", "reuniao", "reunioes", "mensagem", "mensagens", "conversa", "conversas", "aprovacao", "aprovacoes",
  "visita", "visitas", "vez", "vezes", "semana", "semanas", "meta", "metas", "tentativa", "tentativas", "ligacao", "ligacoes",
  "resposta", "respostas", "pendencia", "pendencias", "captacao", "captacoes", "campanha", "campanhas", "etapa", "etapas",
  "posicao", "posicoes", "casa", "casas", "unidade", "unidades", "familia", "familias", "parcela", "parcelas", "entrada",
  "entradas", "documentacao", "proposta", "propostas", "noticia", "noticias", "alerta", "atencao", "atencoes", "mil"
]);
const UNITS_F = ["", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const TEENS = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS_F = ["", "cento", "duzentas", "trezentas", "quatrocentas", "quinhentas", "seiscentas", "setecentas", "oitocentas", "novecentas"];

function underThousandFeminine(n) {
  if (n === 100) return "cem";
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUNDREDS_F[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10), u = rest % 10;
    if (t) parts.push(TENS[t]);
    if (u) parts.push(UNITS_F[u]);
  }
  return parts.join(" e ");
}

function normalizeWord(word) {
  return String(word || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function feminineNumbers(text) {
  return String(text || "").replace(/\b(\d{1,3})(?!\d)(?![.,]\d)(\s+)([A-Za-zÀ-ÿ]+)/g, (match, digits, space, word) => {
    const n = Number(digits);
    if (!FEMININE_WORDS.has(normalizeWord(word)) || n === 0) return match;
    const last = n % 10, lastTwo = n % 100, h = Math.floor(n / 100);
    const changes = ((last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12) || h >= 2;
    return changes ? `${underThousandFeminine(n)}${space}${word}` : match;
  });
}

// Chamado do aviso ("Ô, patrão?", HENRY-1; dono, 2026-10-23: "a chamada 'patrão?' está muito rápida e não está com tom
// de pergunta"). Perfil de voz PRÓPRIO, só para o vocativo (lista fechada HENRY_ALERT_VOCATIVES): modelo mais expressivo,
// mais devagar e menos estável (mais entonação). O resto da fala do Henry segue a velocidade da tela "Voz e personalidade".
// Conferido na documentação oficial em 2026-10-23: voice_settings.speed vai de 0,7 a 1,2; eleven_v3 NÃO aceita
// <break time/> (e a doc o chama de geração anterior) — por isso eleven_multilingual_v2 (português do Brasil, aceita a
// pausa). "…" no texto do chamado vira uma pausa de 0,3 s só na voz (na tela fica "…").
// [PENDENTE DE VALIDAÇÃO] valores escolhidos pela documentação, sem teste de ouvido (sem chave no ambiente de dev).
export const ELEVENLABS_CALL_MODEL = "eleven_multilingual_v2";
export const HENRY_CALL_VOICE_SETTINGS = Object.freeze({ stability: 0.35, similarity_boost: 0.85, style: 0.4, use_speaker_boost: true, speed: 0.85 });
export const HENRY_CALL_PAUSE = '<break time="0.3s"/>';

export function callSpeechText(text) {
  return String(text || "").replace(/\s*(?:…|\.{3})\s*/g, ` ${HENRY_CALL_PAUSE} `).replace(/\s+/g, " ").trim();
}

// Modelo usado de fato (custo e ai_usage_log): o do chamado ou o configurado.
export function elevenLabsModelFor({ modelId, profile } = {}) {
  if (profile === "call") return ELEVENLABS_CALL_MODEL;
  return String(modelId || "").trim() || ELEVENLABS_DEFAULT_MODEL;
}

// Pedido de voz (streaming). previousText/nextText melhoram a continuidade quando a fala vai em partes.
// outputFormat: padrão MP3 (Henry); o áudio ao cliente (lib/client-voice-audio.js) pede Opus para a nota de voz.
// profile = "call": chamado do aviso (perfil acima; ignora modelId, velocidade/tom da tela e o contexto).
export function buildElevenLabsSpeechRequest({ text, voiceId, modelId, style, previousText = "", nextText = "", outputFormat = ELEVENLABS_OUTPUT_FORMAT, profile = "" } = {}) {
  if (!isElevenLabsVoiceId(voiceId)) throw new Error("Voz da ElevenLabs inválida.");
  const call = profile === "call";
  const model = elevenLabsModelFor({ modelId, profile });
  const body = {
    text: call ? callSpeechText(pronounceForSpeech(text)) : pronounceForSpeech(text),
    model_id: model,
    voice_settings: call ? { ...HENRY_CALL_VOICE_SETTINGS } : elevenLabsVoiceSettings(style),
    apply_text_normalization: "auto"
  };
  if (!/multilingual_v2/.test(model)) body.language_code = "pt"; // a doc diz que multilingual_v2 não aceita
  if (previousText && !call) body.previous_text = pronounceForSpeech(previousText).slice(0, 600);
  if (nextText && !call) body.next_text = pronounceForSpeech(nextText).slice(0, 600);
  return {
    url: `${ELEVENLABS_API}/v1/text-to-speech/${voiceId}/stream?output_format=${encodeURIComponent(outputFormat || ELEVENLABS_OUTPUT_FORMAT)}`,
    body
  };
}

export function estimateElevenLabsCostUsd(text, modelId = ELEVENLABS_DEFAULT_MODEL) {
  const perThousand = /flash|turbo/.test(String(modelId)) ? 0.04 : 0.08;
  return (String(text || "").length / 1000) * perThousand;
}

// Resposta do GET /v2/voices → lista para a tela, quem fala português primeiro.
export function speaksPortuguese(voice) {
  const verified = Array.isArray(voice?.verified_languages) ? voice.verified_languages : [];
  if (verified.some((item) => /^pt/i.test(String(item?.language || "")) || /^pt/i.test(String(item?.locale || "")))) return true;
  const labels = voice?.labels && typeof voice.labels === "object" ? voice.labels : {};
  const text = `${labels.language || ""} ${labels.accent || ""}`.toLowerCase();
  return /\bpt\b|portugu|brazil|brasil/.test(text);
}

export function parseElevenLabsVoices(payload) {
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices
    .filter((voice) => isElevenLabsVoiceId(voice?.voice_id))
    .map((voice) => {
      const labels = voice.labels && typeof voice.labels === "object" ? voice.labels : {};
      const note = [labels.gender, labels.age, labels.accent, labels.description || labels.descriptive].filter(Boolean).join(", ");
      return { id: voice.voice_id, name: String(voice.name || voice.voice_id).slice(0, 60), note: note.slice(0, 80), portuguese: speaksPortuguese(voice) };
    })
    .sort((a, b) => Number(b.portuguese) - Number(a.portuguese) || a.name.localeCompare(b.name, "pt-BR"));
}

// Voz usada: a escolhida na tela → ELEVENLABS_VOICE_ID → 1ª da conta que fala português → 1ª da conta.
export function resolveElevenLabsVoiceId({ chosen, envVoiceId, voices = [] } = {}) {
  if (isElevenLabsVoiceId(chosen)) return chosen;
  if (isElevenLabsVoiceId(envVoiceId)) return envVoiceId;
  const list = Array.isArray(voices) ? voices : [];
  return (list.find((voice) => voice.portuguese) || list[0])?.id || "";
}

// Erro da ElevenLabs → frase clara para a tela. A chave do dono tem: Text to Speech = Acesso, Vozes = Ler,
// Modelos = Acesso, Usuário = Acesso (2026-10-22). O código usa: POST /v1/text-to-speech/{id}/stream,
// GET /v2/voices, GET /v1/user/subscription e POST /v1/speech-to-text (tocar para falar no celular — exige a permissão
// "Fala para Texto"/Speech to Text na chave; a ElevenLabs responde 401 "missing permission" ou 403 sem ela).
const PERMISSION_NAMES = Object.freeze({ tts: "Text to Speech", voices: "Vozes (ler)", user: "Usuário", stt: "Fala para Texto" });
export const ELEVENLABS_STT_PERMISSION_MESSAGE = "Libere 'Fala para Texto' na chave da ElevenLabs.";

// Créditos acabaram (dono, 2026-10-22): a ElevenLabs responde 401 com { detail: { status: "quota_exceeded" } } — não é
// problema de chave nem de permissão, então a frase diz só isso. payload = corpo JSON da resposta de erro (pode faltar).
export const ELEVENLABS_QUOTA_MESSAGE = "Os créditos da ElevenLabs acabaram. Recarregue o plano no painel da ElevenLabs.";
export function isElevenLabsQuotaExceeded(payload) {
  const detail = payload?.detail;
  const status = typeof detail === "string" ? detail : detail?.status || detail?.code || payload?.status || "";
  return /quota_exceeded/i.test(String(status)) || /quota_exceeded/i.test(String(detail?.message || ""));
}

export function describeElevenLabsError(status, what = "tts", payload = null) {
  const code = Number(status) || 0;
  if (isElevenLabsQuotaExceeded(payload)) return ELEVENLABS_QUOTA_MESSAGE;
  if (what === "stt" && (code === 401 || code === 403)) return ELEVENLABS_STT_PERMISSION_MESSAGE;
  const permission = PERMISSION_NAMES[what] || what;
  if (code === 401) return `A ElevenLabs recusou a chave (401): confira ELEVENLABS_API_KEY na Vercel e a permissão "${permission}".`;
  if (code === 403) return `A chave da ElevenLabs não tem a permissão "${permission}" (403). Libere no painel da ElevenLabs.`;
  if (code === 429) return "A ElevenLabs limitou os pedidos (429) ou o saldo de caracteres acabou.";
  if (code === 422) return "A ElevenLabs recusou o pedido (422): confira a voz e o modelo escolhidos.";
  return code ? `A ElevenLabs respondeu com erro (${code}).` : "Não consegui falar com a ElevenLabs agora.";
}

// GET /v1/user/subscription → saldo de caracteres do plano.
export function parseElevenLabsSubscription(payload) {
  const used = Number(payload?.character_count);
  const limit = Number(payload?.character_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return { used, limit, remaining: Math.max(0, limit - used), tier: String(payload?.tier || "").slice(0, 40) };
}

// --- Fala para texto (tocar para falar no celular) ----------------------------------------------------------------------
// No app instalado no iPhone o reconhecimento de voz do navegador não existe ou falha: o celular grava (MediaRecorder) e o
// servidor transcreve com o Scribe da ElevenLabs. Conferido na documentação oficial em 2026-10-22: POST /v1/speech-to-text,
// multipart/form-data com `file` + `model_id` ("scribe_v2"), `language_code` ISO-639-3 ("por" = português), resposta
// { text, language_code, words, audio_duration_secs? }; preço da API Scribe v2 US$ 0,22 por hora de áudio. Formatos aceitos
// incluem audio/mp4, audio/aac, audio/webm, audio/ogg, audio/mpeg e audio/wav. O áudio só passa pela memória da requisição.
export const ELEVENLABS_STT_MODEL = "scribe_v2";
export const ELEVENLABS_STT_LANGUAGE = "por";
export const ELEVENLABS_STT_USD_PER_HOUR = 0.22;
export const HENRY_AUDIO_MAX_MS = 20000;
// Teto do áudio em base64: 20 s de gravação do iPhone (AAC em audio/mp4; o Safari ignora o audioBitsPerSecond pedido e
// pode gravar a ~256 kbps = ~640 KB, ~850 mil caracteres em base64) com folga. A rota aceita o corpo correspondente.
export const HENRY_AUDIO_MAX_BASE64 = 2_000_000; // ~1,5 MB de áudio
const AUDIO_TYPES = Object.freeze({
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav"
});
// Safari às vezes rotula a gravação só de áudio como vídeo mp4 ou não rotula (Blob sem tipo): o conteúdo é AAC em mp4.
const UNLABELED_AUDIO_TYPES = new Set(["", "application/octet-stream", "video/mp4"]);

// data:<tipo>[; parâmetros];base64,<dados> (FileReader do navegador). O iPhone pode mandar o tipo com espaço e aspas
// (audio/mp4; codecs="mp4a.40.2") ou sem tipo nenhum (data:;base64,...). Devolve { audio: { mediaType, data } } ou
// { error, reason } com a frase certa: "longo demais" só quando passa do teto de tamanho.
export function checkHenryAudio(dataUrl) {
  const invalid = { error: "Não consegui ler a gravação. Toque no Henry e fale de novo.", reason: "format" };
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return invalid;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return invalid;
  const header = dataUrl.slice(5, comma);
  if (!/;\s*base64\s*$/i.test(header)) return invalid;
  const data = dataUrl.slice(comma + 1);
  if (data.length > HENRY_AUDIO_MAX_BASE64) return { error: "Gravação longa demais: fale por até 20 segundos.", reason: "too_long" };
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) return invalid;
  if (data.length < 200) return { error: "A gravação ficou curta demais. Toque no Henry e fale de novo.", reason: "too_short" };
  const declared = header.replace(/;\s*base64\s*$/i, "").split(";")[0].trim().toLowerCase();
  const mediaType = UNLABELED_AUDIO_TYPES.has(declared) ? "audio/mp4" : declared;
  if (!AUDIO_TYPES[mediaType]) return { error: "Formato de áudio não aceito. Atualize o app e tente de novo.", reason: "type" };
  return { audio: { mediaType, data } };
}

// Compatível com o uso antigo: { mediaType, data } ou null.
export function parseHenryAudio(dataUrl) {
  return checkHenryAudio(dataUrl).audio || null;
}

// Pedido à ElevenLabs (o servidor monta o FormData com estes campos + o arquivo).
export function buildElevenLabsTranscriptionRequest({ audio, modelId } = {}) {
  if (!audio?.mediaType || !AUDIO_TYPES[audio.mediaType]) throw new Error("Áudio inválido.");
  return {
    url: `${ELEVENLABS_API}/v1/speech-to-text`,
    fields: { model_id: String(modelId || "").trim() || ELEVENLABS_STT_MODEL, language_code: ELEVENLABS_STT_LANGUAGE, tag_audio_events: "false" },
    fileName: `fala.${AUDIO_TYPES[audio.mediaType]}`,
    mediaType: audio.mediaType
  };
}

export function parseElevenLabsTranscript(payload) {
  return String(payload?.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function estimateElevenLabsSttCostUsd(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return (value / 3600) * ELEVENLABS_STT_USD_PER_HOUR;
}

// --- Fala para texto AO VIVO enquanto aperta (REGRA OFICIAL — dono, 2026-10-24) ---------------------------------------
// "Ele já vai acompanhando a leitura… porém ele só responde quando eu tirar o dedo do Enter." Scribe v2 Realtime, conferido
// na documentação oficial em 2026-10-24: WebSocket wss://api.elevenlabs.io/v1/speech-to-text/realtime (model_id
// scribe_v2_realtime, audio_format pcm_16000, language_code, commit_strategy manual); o navegador manda
// { message_type: "input_audio_chunk", audio_base_64, commit, sample_rate } e recebe partial_transcript /
// committed_transcript. A chave NUNCA vai ao navegador: o servidor pede um token de uso único (POST
// /v1/single-use-token/realtime_scribe, vale 15 min, consumido na 1ª conexão) e só ele sai. Preço: US$ 0,39 por hora.
export const ELEVENLABS_STT_REALTIME_MODEL = "scribe_v2_realtime";
export const ELEVENLABS_STT_REALTIME_USD_PER_HOUR = 0.39;
export const ELEVENLABS_REALTIME_SAMPLE_RATE = 16000;
const ELEVENLABS_REALTIME_WS = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export function buildElevenLabsRealtimeTokenRequest() {
  return { url: `${ELEVENLABS_API}/v1/single-use-token/realtime_scribe`, method: "POST" };
}

// Só o token (texto curto, sem espaço); qualquer outra coisa = sem token (o navegador cai na gravação de sempre).
export function parseElevenLabsRealtimeToken(payload) {
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  return /^[A-Za-z0-9_\-.]{8,512}$/.test(token) ? token : "";
}

export function buildElevenLabsRealtimeUrl({ token } = {}) {
  const safe = parseElevenLabsRealtimeToken({ token });
  if (!safe) return "";
  const params = new URLSearchParams({
    model_id: ELEVENLABS_STT_REALTIME_MODEL,
    token: safe,
    audio_format: `pcm_${ELEVENLABS_REALTIME_SAMPLE_RATE}`,
    language_code: ELEVENLABS_STT_LANGUAGE,
    commit_strategy: "manual"
  });
  return `${ELEVENLABS_REALTIME_WS}?${params.toString()}`;
}

export function estimateElevenLabsRealtimeSttCostUsd(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return (value / 3600) * ELEVENLABS_STT_REALTIME_USD_PER_HOUR;
}

// --- Voz do navegador (reserva) ----------------------------------------------------------------------------------------
// A melhor voz pt-BR disponível: as "Natural"/"Online" (Edge, ex.: "Microsoft Antonio Online (Natural)") e a do Google
// ("Google português do Brasil") soam bem melhor que as vozes locais antigas.
export function scoreBrowserVoice(voice) {
  const lang = String(voice?.lang || "").toLowerCase().replace("_", "-");
  const name = String(voice?.name || "").toLowerCase();
  if (!lang.startsWith("pt")) return -1;
  let score = lang === "pt-br" ? 10 : 2;
  if (/natural|neural/.test(name)) score += 6;
  if (/online/.test(name)) score += 3;
  if (/google/.test(name)) score += 4;
  if (voice?.localService === false) score += 1;
  return score;
}

export function pickBestBrowserVoice(voices = []) {
  let best = null;
  let bestScore = -1;
  for (const voice of Array.isArray(voices) ? voices : []) {
    const score = scoreBrowserVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

// Uma frase por vez (o Chrome corta falas longas e pausa entre blocos grandes): enfileira todas de uma vez, sem buraco.
export function splitSentences(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  return value.match(/[^.!?…]+[.!?…]+["”']?|[^.!?…]+$/g).map((part) => part.trim()).filter(Boolean);
}
