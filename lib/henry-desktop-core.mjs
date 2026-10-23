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
