// Henry dentro do app de desktop do dono (Windows, `desktop-app/`; dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1,
// "App de desktop"). Regras PURAS: detectar a ponte `window.mmDesktop` (só existe no app e só na origem do CRM) e os
// comandos de voz locais "desliga a tela"/"liga a tela". Fora do app nada disso existe e o Henry segue igual.
import { normalizeSpeechText } from "./henry-voice-core.mjs";

const BRIDGE_METHODS = ["openSpotify", "openUrl", "notify", "screenOff", "screenOn"];

// Devolve a ponte só quando é a do app (flag + todas as ações como função); qualquer outra coisa → null.
export function readHenryDesktopBridge(win) {
  const bridge = win && typeof win === "object" ? win.mmDesktop : null;
  if (!bridge || bridge.isDesktopApp !== true) return null;
  return BRIDGE_METHODS.every((name) => typeof bridge[name] === "function") ? bridge : null;
}

const SCREEN_OFF_VERBS = new Set(["desliga", "desligar", "desligue", "apaga", "apagar", "apague"]);
const SCREEN_ON_VERBS = new Set(["liga", "ligar", "ligue", "acende", "acender", "acenda"]);
const SCREEN_OBJECTS = new Set(["tela", "monitor"]);
const SCREEN_FILLER = new Set(["henry", "a", "o", "essa", "esse", "minha", "meu", "do", "da", "computador", "pc", "pode", "por", "favor", "ai", "agora", "pra", "para", "mim", "ja", "e"]);

// "desliga a tela", "Henry, apaga o monitor", "pode ligar a tela" → "off"/"on". Só frase curta com verbo + tela/monitor e
// nada além de palavras de enchimento (assim "liga para o cliente da tela de vendas" não vira comando).
export function detectScreenCommand(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 8) return null;
  let verb = null;
  let object = false;
  for (const word of tokens) {
    if (SCREEN_OFF_VERBS.has(word) || SCREEN_ON_VERBS.has(word)) {
      if (verb) return null;
      verb = SCREEN_OFF_VERBS.has(word) ? "off" : "on";
    } else if (SCREEN_OBJECTS.has(word)) {
      object = true;
    } else if (!SCREEN_FILLER.has(word)) {
      return null;
    }
  }
  return verb && object ? verb : null;
}

// --- Fase 1.1 (dono, 2026-10-23): nome "Henry" ouvido pelo app e voz local (Piper) ---------------------------------
// Opcionais: o app 1.0.0 não tem; sem elas tudo segue como antes (atalho/toque e voz do navegador).
export function desktopCanWake(bridge) {
  return Boolean(bridge) && typeof bridge.onWake === "function";
}

export function desktopCanSpeakLocal(bridge) {
  return Boolean(bridge) && typeof bridge.speakLocal === "function";
}

// App 1.3.1+ (dono, 2026-10-23): avisa o app quando a tela cheia do Henry abre/fecha — o app guarda a caixa "Nova versão
// pronta" nesse tempo (nenhum aviso fixo no meio da tela, lib/henry-fullscreen-signal.mjs). App antigo: não tem, nada muda.
export function desktopCanReportFullscreen(bridge) {
  return Boolean(bridge) && typeof bridge.henryFullscreen === "function";
}

// Liga/desliga "Ouvir 'Henry' sem atalho" (Voz e personalidade, só no app). É deste PC (localStorage do app), nasce LIGADO.
export const DESKTOP_WAKE_KEY = "mm_henry_desktop_wake";
export const DESKTOP_WAKE_EVENT = "mm-henry-desktop-wake";
export function readDesktopWakeSetting(storage) {
  try {
    return storage?.getItem?.(DESKTOP_WAKE_KEY) !== "0";
  } catch {
    return true;
  }
}

// Palavra de chamada do app (versão 1.3.0, dono 2026-10-23): "Henry" (padrão), "Ei Henry", "Ok Henry" ou palavra livre.
// É deste PC (localStorage do app) e vai ao app pelo canal já existente do nome (`onWake(callback, { wakeWord })`) —
// sem ação nova na ponte. Quem confere no vocabulário do modelo e volta para "Henry" é o app (desktop-app/src/core.js
// buildWakeConfig); o retorno chega por `onStatus` e a tela mostra pelo evento DESKTOP_WAKE_STATUS_EVENT.
export const DESKTOP_WAKE_WORD_KEY = "mm_henry_desktop_wake_word";
export const DESKTOP_WAKE_STATUS_EVENT = "mm-henry-desktop-wake-status";
export const DESKTOP_WAKE_WORD_OPTIONS = Object.freeze([
  Object.freeze({ id: "henry", label: "Henry" }),
  Object.freeze({ id: "ei-henry", label: "Ei Henry" }),
  Object.freeze({ id: "ok-henry", label: "Ok Henry" }),
  Object.freeze({ id: "custom", label: "Outra palavra" })
]);
export const DESKTOP_WAKE_CUSTOM_MAX_CHARS = 40;
export const DESKTOP_WAKE_CUSTOM_MAX_WORDS = 3;

function cleanWakeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// (id da opção, texto livre) → valor para o app ("henry" | "ei-henry" | "ok-henry" | "custom:<palavra>"), ou null se a
// palavra livre for vazia/longa demais (até 40 letras e 3 palavras).
export function buildDesktopWakeWord(id, customText = "") {
  if (id === "custom") {
    const text = cleanWakeText(customText);
    if (!text || text.length > DESKTOP_WAKE_CUSTOM_MAX_CHARS || text.split(" ").length > DESKTOP_WAKE_CUSTOM_MAX_WORDS) return null;
    return `custom:${text}`;
  }
  return DESKTOP_WAKE_WORD_OPTIONS.some((item) => item.id === id && id !== "custom") ? id : null;
}

// Valor salvo → valor válido (qualquer coisa estranha = "henry").
export function readDesktopWakeWord(storage) {
  let raw = "";
  try {
    raw = String(storage?.getItem?.(DESKTOP_WAKE_WORD_KEY) || "");
  } catch {
    raw = "";
  }
  if (raw.startsWith("custom:")) return buildDesktopWakeWord("custom", raw.slice(7)) || "henry";
  return buildDesktopWakeWord(raw) || "henry";
}

// Valor → { id, text } para a tela.
export function parseDesktopWakeWord(value) {
  const raw = String(value || "");
  if (raw.startsWith("custom:")) return { id: "custom", text: raw.slice(7) };
  return { id: buildDesktopWakeWord(raw) || "henry", text: "" };
}

// O nome ouvido pelo app só abre o Henry quando ele está parado: nunca no meio de uma gravação, de uma fala ou de um
// pedido (a interrupção durante a fala é da regra de barge-in) nem no mudo.
export function shouldHandleDesktopWake({ phase, recording = false, muted = false } = {}) {
  return !recording && !muted && (phase === "idle" || phase === "armed");
}

// Texto para a voz local: o app aceita até 1.000 caracteres por pedido; os pedaços têm até 900 (folga para a pronúncia,
// que pode alongar o texto: "21 visitas" → "vinte e uma visitas"). Junta frases inteiras até o limite; frase maior é
// cortada em pedaços (nunca some texto).
export const LOCAL_VOICE_MAX = 1000;
export const LOCAL_VOICE_CHUNK = 900;
export function chunkForLocalVoice(text, max = LOCAL_VOICE_CHUNK) {
  const sentences = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["”']?|[^.!?…]+$/g) || [];
  const chunks = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    for (let start = 0; start < sentence.length; start += max) {
      const piece = sentence.slice(start, start + max);
      if (current && current.length + 1 + piece.length > max) {
        chunks.push(current);
        current = "";
      }
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
