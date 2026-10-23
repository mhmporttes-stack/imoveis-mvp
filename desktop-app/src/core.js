// Regras PURAS do app de desktop (sem Electron, testáveis com node --test). Pedido do dono em 2026-10-23
// (docs/BUSINESS_RULES.md HENRY-1, "App de desktop"): o app só abre o CRM de produção; o resto vai para o navegador.
// Toda decisão de segurança (origem, permissão, navegação, ações da ponte) mora aqui — main.js só aplica.
"use strict";

const CRM_HOME = "https://www.matheusmachadoimoveis.com.br/admin";
const ALLOWED_ORIGINS = Object.freeze(["https://www.matheusmachadoimoveis.com.br", "https://matheusmachadoimoveis.com.br"]);
// Permissões concedidas sozinhas, só para as origens acima: microfone/câmera, notificação, tela cheia e "copiar".
const AUTO_PERMISSIONS = Object.freeze(["media", "notifications", "fullscreen", "clipboard-sanitized-write"]);
// Protocolos que podem sair para o sistema (navegador padrão, Spotify, e-mail, telefone, WhatsApp).
const EXTERNAL_PROTOCOLS = Object.freeze(["https:", "http:", "mailto:", "tel:", "spotify:", "whatsapp:"]);
const SPOTIFY_URI = /^spotify:(track|playlist|album|artist):[A-Za-z0-9]+$/;
const MAX_TITLE = 80;
const MAX_BODY = 200;
const MAX_URL = 2000;
// Fase 1.1 (dono, 2026-10-23): voz de reserva local (Piper) — texto curto, só string.
const MAX_SPEAK_TEXT = 1000;
// Ações da ponte (lista FECHADA). onWake é evento (não é ação), registrado à parte em main.js.
const BRIDGE_ACTIONS = Object.freeze(["openSpotify", "openUrl", "notify", "screenOff", "screenOn", "speakLocal"]);

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isAllowedOrigin(value) {
  const url = parseUrl(value);
  return Boolean(url) && url.protocol === "https:" && ALLOWED_ORIGINS.includes(url.origin);
}

// Para onde vai uma navegação/janela nova: "app" (fica no app), "external" (sistema) ou "block".
function classifyNavigation(value) {
  if (isAllowedOrigin(value)) return "app";
  const url = parseUrl(value);
  if (!url || String(value).length > MAX_URL) return "block";
  return EXTERNAL_PROTOCOLS.includes(url.protocol) ? "external" : "block";
}

// Janela escondida da escuta do nome (fase 1.1): só ela, só microfone (sem câmera, sem mais nada).
const WAKE_ORIGIN = "mm-wake://app";
function shouldGrantWakePermission({ permission, origin, mediaTypes } = {}) {
  const url = parseUrl(origin);
  if (!url || url.protocol !== "mm-wake:" || url.host !== "app" || permission !== "media") return false;
  return Array.isArray(mediaTypes) ? mediaTypes.length > 0 && mediaTypes.every((type) => type === "audio") : true;
}

function shouldGrantPermission({ permission, origin, mediaTypes } = {}) {
  if (!isAllowedOrigin(origin)) return false;
  if (!AUTO_PERMISSIONS.includes(permission)) return false;
  if (permission === "media" && Array.isArray(mediaTypes)) return mediaTypes.every((type) => type === "audio" || type === "video");
  return true;
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Lista FECHADA de ações da ponte (window.mmDesktop). Devolve { ok, action, args } ou { ok: false, error }.
// Nada de comando arbitrário: cada ação tem o seu formato e nada mais passa.
function validateAction(action, payload) {
  const args = payload && typeof payload === "object" ? payload : {};
  switch (action) {
    case "openSpotify": {
      const uri = String(args.uri || "");
      return SPOTIFY_URI.test(uri) ? { ok: true, action, args: { uri } } : { ok: false, error: "uri_invalida" };
    }
    case "openUrl": {
      const url = parseUrl(args.url);
      if (!url || url.protocol !== "https:" || String(args.url).length > MAX_URL) return { ok: false, error: "url_invalida" };
      return { ok: true, action, args: { url: url.toString() } };
    }
    case "notify": {
      const title = cleanText(args.title, MAX_TITLE);
      if (!title) return { ok: false, error: "titulo_vazio" };
      return { ok: true, action, args: { title, body: cleanText(args.body, MAX_BODY) } };
    }
    case "screenOff":
    case "screenOn":
      return { ok: true, action, args: {} };
    case "speakLocal": {
      // Só string (nada de objeto/número convertido), até MAX_SPEAK_TEXT. Vai ao Piper por stdin, nunca por shell.
      if (typeof args.text !== "string") return { ok: false, error: "texto_invalido" };
      const text = cleanText(args.text, MAX_SPEAK_TEXT + 1);
      if (!text) return { ok: false, error: "texto_vazio" };
      if (text.length > MAX_SPEAK_TEXT) return { ok: false, error: "texto_longo" };
      return { ok: true, action, args: { text } };
    }
    default:
      return { ok: false, error: "acao_desconhecida" };
  }
}

// --- Palavra "Henry" offline (Vosk, fase 1.1) ---------------------------------------------------------------------------
// Gramática restrita: só as variantes do nome que EXISTEM no vocabulário do vosk-model-small-pt-0.3 (as demais de
// WAKE_WORDS_STRONG/WEAK de lib/henry-voice-core.mjs não existem nele e o Vosk as ignora — lista em
// WAKE_WORDS_NOT_IN_MODEL, conferida no modelo em 2026-10-23) + "[unk]" (qualquer outra fala).
// Palavras/frases que acordam o Henry (todas existem no modelo). "rei ri" = como o Vosk escreve o "Rênri" falado.
// "henrique"/"rene"/"rendi" (fracas no CRM) ficam FORA: aqui não há saudação para conferir e "o Henrique ligou" acordaria.
const WAKE_TARGETS = Object.freeze(["henry", "henri", "rei ri"]);
// Palavras parecidas que "seguram" a fala comum (sem elas "entrei", "Enrique", "o Henrique" e "renda" viravam "Henry").
const WAKE_ABSORBERS = Object.freeze(["entrei", "enrique", "henrique", "renda", "energia", "entregou", "enviar", "entendi"]);
const WAKE_GRAMMAR = Object.freeze([...WAKE_TARGETS, ...WAKE_ABSORBERS, "[unk]"]);
const WAKE_WORDS_NOT_IN_MODEL = Object.freeze(["renri", "enri", "enry", "henrri", "rienri", "henrry", "henrie", "hendri", "henrei", "renne", "rennie"]);
// Existem no modelo, mas ficam de fora de propósito (no CRM só valem depois de saudação; aqui acordariam à toa).
const WAKE_WORDS_EXCLUDED = Object.freeze(["henrique", "rene", "rendi"]);
// Medido em 2026-10-23 com 4 vozes sintéticas pt-BR (Piper): 12 de 36 chamadas reconhecidas e 0 falso em 80 frases
// comuns (inclusive "o Henrique ligou", "a renda do cliente", "entrei na reunião"). Ajuste aqui depois do teste com a voz do dono.
const WAKE_MIN_CONFIDENCE = 0.3;
const WAKE_COOLDOWN_MS = 4000; // depois de acordar, ignora o nome por 4 s (o CRM já está ouvindo o pedido)

// Resultado do Vosk ({ result: [{ word, conf }], text }) → { phrase, confidence } quando há o nome com confiança suficiente.
// Frase de duas palavras ("rei ri") precisa das duas seguidas; a confiança é a menor das duas.
function detectWakeInResult(result, minConfidence = WAKE_MIN_CONFIDENCE) {
  const words = Array.isArray(result?.result) ? result.result.slice(0, 50) : [];
  const seq = words.map((item) => (item && typeof item.word === "string" ? item.word : ""));
  let best = null;
  for (const phrase of WAKE_TARGETS) {
    const parts = phrase.split(" ");
    for (let index = 0; index + parts.length <= seq.length; index += 1) {
      if (!parts.every((part, offset) => seq[index + offset] === part)) continue;
      const confidence = Math.min(...parts.map((_, offset) => Number(words[index + offset].conf) || 0));
      if (confidence >= minConfidence && (!best || confidence > best.confidence)) best = { phrase, confidence };
    }
  }
  return best;
}

// PCM 16 bits mono (saída --output_raw do Piper) → arquivo WAV completo (cabeçalho RIFF de 44 bytes).
function pcmToWav(pcm, sampleRate) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const rate = Number.isInteger(sampleRate) && sampleRate > 0 ? sampleRate : 22050;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Linha do log local: data, ação, resultado e no máximo o destino (URI do Spotify / endereço) — nunca o texto do aviso.
function formatLogLine({ at = new Date(), action = "", ok = false, detail = "" } = {}) {
  const safeDetail = cleanText(detail, 300);
  return `${at.toISOString()} ${cleanText(action, 40) || "?"} ${ok ? "ok" : "recusado"}${safeDetail ? ` ${safeDetail}` : ""}\n`;
}

module.exports = {
  CRM_HOME,
  ALLOWED_ORIGINS,
  AUTO_PERMISSIONS,
  EXTERNAL_PROTOCOLS,
  SPOTIFY_URI,
  MAX_SPEAK_TEXT,
  BRIDGE_ACTIONS,
  WAKE_TARGETS,
  WAKE_GRAMMAR,
  WAKE_WORDS_NOT_IN_MODEL,
  WAKE_WORDS_EXCLUDED,
  WAKE_MIN_CONFIDENCE,
  WAKE_COOLDOWN_MS,
  WAKE_ORIGIN,
  isAllowedOrigin,
  classifyNavigation,
  shouldGrantPermission,
  shouldGrantWakePermission,
  validateAction,
  detectWakeInResult,
  pcmToWav,
  formatLogLine
};
