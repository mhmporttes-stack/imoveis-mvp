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

// --- Barra de título própria (versão 1.2, pedido do dono em 2026-10-23) -------------------------------------------------
// A janela não tem a barra do Windows. Uma barra fina do app (página local, isolada do CRM) desce quando o mouse chega
// a até TITLEBAR_REVEAL_PX do topo e some TITLEBAR_HIDE_DELAY_MS depois que ele sai. A detecção é feita no processo
// principal pela posição do cursor (nenhuma faixa invisível por cima do CRM: cliques no topo do CRM seguem normais).
const TITLEBAR_REVEAL_PX = 6;
const TITLEBAR_HEIGHT = 32;
const TITLEBAR_HIDE_DELAY_MS = 1000;
const TITLEBAR_SLIDE_MS = 150;
const TITLEBAR_ALT_SHOW_MS = 3000; // Alt sozinho mostra a barra por 3 s (ou enquanto o mouse estiver nela)
const TITLEBAR_POLL_MS = 100;
// Comandos da barra (lista FECHADA, canal próprio "mm:titlebar" — nada disso existe em window.mmDesktop).
const TITLEBAR_COMMANDS = Object.freeze(["minimize", "toggleMaximize", "close"]);
const DEFAULT_PREFERENCES = Object.freeze({ titlebarAlwaysVisible: false });

// Cursor (coordenadas da tela) → posição relativa ao topo visível da janela, ou null se fora dela.
// Maximizada no Windows, a janela sem moldura passa alguns pixels da borda da tela: o topo considerado é o maior entre
// o topo da janela e o topo do monitor (senão o mouse encostado no alto da tela ficaria "fora" da faixa).
function titlebarPointer(cursor, bounds, displayBounds) {
  if (!cursor || !bounds) return null;
  const top = Math.max(bounds.y, displayBounds ? displayBounds.y : bounds.y);
  const left = Math.max(bounds.x, displayBounds ? displayBounds.x : bounds.x);
  const right = Math.min(bounds.x + bounds.width, displayBounds ? displayBounds.x + displayBounds.width : bounds.x + bounds.width);
  const bottom = bounds.y + bounds.height;
  if (cursor.x < left || cursor.x >= right || cursor.y < top || cursor.y >= bottom) return null;
  return { x: cursor.x - left, y: cursor.y - top };
}

// Estado da barra: { visible, hideAt }. Entrada de cada leitura (a cada TITLEBAR_POLL_MS ou evento):
//   now, pointer (titlebarPointer), alwaysVisible (preferência), fullscreen, active (janela visível e não minimizada),
//   reveal (true = Alt pressionado sozinho: mostra por TITLEBAR_ALT_SHOW_MS).
// Regras: "sempre" (fora da tela cheia) → sempre visível; mouse na faixa do topo → abre; mouse na barra aberta → fica;
// mouse fora → some TITLEBAR_HIDE_DELAY_MS depois. Janela escondida/minimizada → fechada.
function titlebarStep(state, input = {}) {
  const now = Number(input.now) || 0;
  const current = { visible: Boolean(state && state.visible), hideAt: state && Number.isFinite(state.hideAt) ? state.hideAt : null };
  if (input.active === false) return { visible: false, hideAt: null };
  if (input.alwaysVisible && !input.fullscreen) return { visible: true, hideAt: null };
  const pointer = input.pointer || null;
  if (pointer && pointer.y < TITLEBAR_REVEAL_PX) return { visible: true, hideAt: null };
  if (input.reveal) return { visible: true, hideAt: now + TITLEBAR_ALT_SHOW_MS };
  if (!current.visible) return { visible: false, hideAt: null };
  if (pointer && pointer.y < TITLEBAR_HEIGHT) return { visible: true, hideAt: null };
  if (current.hideAt === null) return { visible: true, hideAt: now + TITLEBAR_HIDE_DELAY_MS };
  if (now >= current.hideAt) return { visible: false, hideAt: null };
  return current;
}

// Alt "sozinho" (aperta e solta sem outra tecla no meio) mostra a barra — Alt+Tab e atalhos com Alt não contam.
// input = before-input-event do Electron. Devolve { armed, reveal }.
function altTapStep(armed, input = {}) {
  if (input.type === "keyDown") {
    if (input.key === "Alt") return { armed: !input.isAutoRepeat || Boolean(armed), reveal: false };
    return { armed: false, reveal: false };
  }
  if (input.type === "keyUp" && input.key === "Alt") return { armed: false, reveal: Boolean(armed) };
  return { armed: Boolean(armed), reveal: false };
}

// Canal da barra ("mm:titlebar"): só a página local da barra (frame principal, a mesma webContents que o app criou)
// e só um comando da lista fechada. Qualquer outra origem — inclusive o CRM — é recusada.
function validateTitlebarMessage({ senderId, barId, isMainFrame, frameUrl, barUrl, command } = {}) {
  if (!Number.isInteger(barId) || senderId !== barId) return { ok: false, error: "remetente_recusado" };
  if (!isMainFrame || typeof frameUrl !== "string" || typeof barUrl !== "string" || !barUrl) return { ok: false, error: "remetente_recusado" };
  const url = parseUrl(frameUrl);
  const expected = parseUrl(barUrl);
  if (!url || !expected || url.protocol !== "file:" || `${url.protocol}//${url.host}${url.pathname}` !== `${expected.protocol}//${expected.host}${expected.pathname}`) {
    return { ok: false, error: "remetente_recusado" };
  }
  if (!TITLEBAR_COMMANDS.includes(command)) return { ok: false, error: "comando_desconhecido" };
  return { ok: true, command };
}

// Preferências do app (arquivo preferencias.json em userData). Só chaves conhecidas, só booleanos; o resto é ignorado.
function parsePreferences(text) {
  let data = null;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    data = null;
  }
  const prefs = { ...DEFAULT_PREFERENCES };
  if (data && typeof data === "object" && typeof data.titlebarAlwaysVisible === "boolean") prefs.titlebarAlwaysVisible = data.titlebarAlwaysVisible;
  return prefs;
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
  formatLogLine,
  TITLEBAR_REVEAL_PX,
  TITLEBAR_HEIGHT,
  TITLEBAR_HIDE_DELAY_MS,
  TITLEBAR_SLIDE_MS,
  TITLEBAR_ALT_SHOW_MS,
  TITLEBAR_POLL_MS,
  TITLEBAR_COMMANDS,
  DEFAULT_PREFERENCES,
  titlebarPointer,
  titlebarStep,
  altTapStep,
  validateTitlebarMessage,
  parsePreferences
};
