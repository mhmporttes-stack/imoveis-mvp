// Provedores de voz do Henry (decisão do dono, 2026-10-22: "usar a ElevenLabs como voz principal" — docs/BUSINESS_RULES.md
// HENRY-1, "Voz natural"). Núcleo PURO (sem rede, sem segredo): escolha do provedor, montagem do pedido à ElevenLabs,
// leitura da lista de vozes, custo estimado e a melhor voz pt-BR do navegador (reserva). Usado por lib/henry-voice.js,
// pelo navegador (components/henry/*) e pelos testes.
//
// Ordem: ElevenLabs (com ELEVENLABS_API_KEY) → OpenAI (com OPENAI_API_KEY) → voz do navegador.
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

// ID de voz da ElevenLabs: só letras e números (evita montar URL com texto qualquer).
export function isElevenLabsVoiceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{10,40}$/.test(value);
}

// Velocidade da tela "Voz e personalidade" → voice_settings.speed.
export const ELEVENLABS_SPEED = Object.freeze({ calmo: 0.92, normal: 1, rapido: 1.1 });

// Tom → ajuste fino da voz (estabilidade mais baixa = mais expressiva; style moderado = mais conversacional).
const TONE_SETTINGS = Object.freeze({
  profissional: { stability: 0.45, style: 0.15 },
  carismatico: { stability: 0.35, style: 0.35 },
  descontraido: { stability: 0.35, style: 0.3 },
  executivo: { stability: 0.55, style: 0.1 }
});

export function elevenLabsVoiceSettings(style = {}) {
  const tone = TONE_SETTINGS[style?.tone] || TONE_SETTINGS.profissional;
  return {
    stability: tone.stability,
    similarity_boost: 0.85,
    style: tone.style,
    use_speaker_boost: true,
    speed: ELEVENLABS_SPEED[style?.speed] || 1
  };
}

// Pedido de voz (streaming). previousText/nextText melhoram a continuidade quando a fala vai em partes.
export function buildElevenLabsSpeechRequest({ text, voiceId, modelId, style, previousText = "", nextText = "" } = {}) {
  if (!isElevenLabsVoiceId(voiceId)) throw new Error("Voz da ElevenLabs inválida.");
  const model = String(modelId || "").trim() || ELEVENLABS_DEFAULT_MODEL;
  const body = {
    text: String(text || ""),
    model_id: model,
    voice_settings: elevenLabsVoiceSettings(style),
    apply_text_normalization: "auto"
  };
  if (!/multilingual_v2/.test(model)) body.language_code = "pt"; // a doc diz que multilingual_v2 não aceita
  if (previousText) body.previous_text = String(previousText).slice(0, 600);
  if (nextText) body.next_text = String(nextText).slice(0, 600);
  return {
    url: `${ELEVENLABS_API}/v1/text-to-speech/${voiceId}/stream?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
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
// Modelos = Acesso, Usuário = Acesso (2026-10-22). O código só usa: POST /v1/text-to-speech/{id}/stream,
// GET /v2/voices e GET /v1/user/subscription.
const PERMISSION_NAMES = Object.freeze({ tts: "Text to Speech", voices: "Vozes (ler)", user: "Usuário" });

export function describeElevenLabsError(status, what = "tts") {
  const code = Number(status) || 0;
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
