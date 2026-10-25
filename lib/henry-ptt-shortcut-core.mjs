// Atalho de fala do Henry (REGRA OFICIAL — dono, 2026-10-25; docs/BUSINESS_RULES.md HENRY-1 "Atalho de fala"):
// "Adicione nas configurações da Alexa (Henry) opção de atalho de fala: eu registro 2 botões e quando eu apertar esses
// dois botões, mesmo com o Henry minimizado, ele começa a me ouvir imediatamente."
// Núcleo PURO (sem banco, sem DOM): gravação do atalho, validação (conflito com digitação/atalhos do navegador) e
// casamento tecla apertada/solta. Usado pelo servidor (lib/henry-voice-style.mjs, campo style.pttShortcut), pelo cartão
// de configuração (components/henry/HenryPttShortcutSetting.jsx) e pelo Henry da página (pushToTalkKeyAction em
// lib/henry-voice-conversation.mjs). Comportamento ao segurar/soltar = o mesmo aperte-para-falar de sempre.
//
// Formato guardado: 2 teclas separadas por "+", modificadores primeiro ("Control", "Alt", "Shift", "Meta" — esquerda e
// direita contam igual) e as demais pelo KeyboardEvent.code (independe do idioma do teclado): "Control+Space", "Alt+KeyM",
// "F8+F9". Vazio = sem atalho.

export const HENRY_PTT_SHORTCUT_EVENT = "mm-henry-ptt-shortcut"; // cartão de configuração → Henry da página (detail.shortcut)
export const PTT_SHORTCUT_KEYS = 2;
export const PTT_SHORTCUT_MAX_CHARS = 60;

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Meta"];
const MODIFIER_CODES = Object.freeze({
  ControlLeft: "Control",
  ControlRight: "Control",
  AltLeft: "Alt",
  AltRight: "Alt",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  MetaLeft: "Meta",
  MetaRight: "Meta",
  OSLeft: "Meta",
  OSRight: "Meta"
});
const CODE_FORMAT = /^[A-Za-z][A-Za-z0-9]{0,24}$/;

// Teclas que escrevem ou editam texto: sozinhas (sem Ctrl/Alt/Meta) nunca servem de atalho.
const TYPING_CODES = new Set([
  "Space", "Enter", "NumpadEnter", "Tab", "Backspace", "Delete", "Escape", "Minus", "Equal", "BracketLeft", "BracketRight",
  "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "IntlBackslash", "IntlRo", "IntlYen",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
  "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadComma", "NumpadEqual"
]);
function isTypingCode(code) {
  return TYPING_CODES.has(code) || /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(code);
}

// Teclas que o navegador usa (sozinhas ou com Ctrl/Shift; a página não consegue segurar): ajuda, buscar, recarregar, foco na
// barra, cursor, menu, tela cheia, ferramentas; e as de estado/sistema (Caps Lock, Num Lock, Print Screen, Menu). Ficam fora
// de qualquer atalho.
const BROWSER_SOLO_CODES = new Set(["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12", "ContextMenu", "CapsLock", "NumLock", "PrintScreen"]);

// Combinações recusadas com modificador (motivo mostrado ao dono). Ctrl e Meta (⌘) valem igual.
const CTRL_RESERVED = Object.freeze({
  KeyC: "Ctrl+C é copiar",
  KeyV: "Ctrl+V é colar",
  KeyX: "Ctrl+X é recortar",
  KeyA: "Ctrl+A é selecionar tudo",
  KeyZ: "Ctrl+Z é desfazer",
  KeyY: "Ctrl+Y é refazer",
  KeyW: "Ctrl+W fecha a aba",
  KeyT: "Ctrl+T abre aba nova",
  KeyN: "Ctrl+N abre janela nova",
  KeyQ: "Ctrl+Q fecha o navegador",
  Tab: "Ctrl+Tab troca de aba",
  F4: "Ctrl+F4 fecha a aba"
});
const ALT_RESERVED = Object.freeze({
  KeyB: "Alt+B já liga/desliga o microfone do Henry",
  KeyF: "Alt+F abre o menu do navegador",
  KeyE: "Alt+E abre o menu do navegador",
  KeyD: "Alt+D vai para a barra de endereço",
  Tab: "Alt+Tab troca de programa",
  F4: "Alt+F4 fecha a janela",
  ArrowLeft: "Alt+← volta a página",
  ArrowRight: "Alt+→ avança a página",
  Home: "Alt+Home abre a página inicial",
  Space: "Alt+Espaço abre o menu da janela"
});

// KeyboardEvent.code → peça do atalho ("Control", "KeyM", "Space"...) ou "" (tecla desconhecida/sem code).
export function pttShortcutToken(code) {
  const value = String(code || "");
  if (MODIFIER_CODES[value]) return MODIFIER_CODES[value];
  return CODE_FORMAT.test(value) ? value : "";
}

export function isPttModifierToken(token) {
  return MODIFIER_ORDER.includes(token);
}

// Peças → texto guardado (sem repetição, modificadores primeiro na ordem fixa, demais em ordem alfabética).
export function buildPttShortcut(tokens = []) {
  const list = [...new Set((Array.isArray(tokens) ? tokens : []).filter((token) => isPttModifierToken(token) || CODE_FORMAT.test(String(token || ""))))];
  const modifiers = MODIFIER_ORDER.filter((token) => list.includes(token));
  const keys = list.filter((token) => !isPttModifierToken(token)).sort();
  return [...modifiers, ...keys].join("+");
}

// Texto guardado → lista de peças (ou [] se o formato não bate: exatamente 2 peças válidas e diferentes).
export function parsePttShortcut(value) {
  const raw = typeof value === "string" ? value.trim().slice(0, PTT_SHORTCUT_MAX_CHARS + 1) : "";
  if (!raw || raw.length > PTT_SHORTCUT_MAX_CHARS) return [];
  const tokens = raw.split("+");
  if (tokens.length !== PTT_SHORTCUT_KEYS || new Set(tokens).size !== tokens.length) return [];
  if (!tokens.every((token) => isPttModifierToken(token) || (CODE_FORMAT.test(token) && !MODIFIER_CODES[token]))) return [];
  return buildPttShortcut(tokens) === raw ? tokens : [];
}

// Validação (gravação na tela e PUT do servidor). "" = sem atalho (ok). Devolve { ok, shortcut } ou { ok: false, error }.
export function validatePttShortcut(value) {
  if (value === "" || value == null) return { ok: true, shortcut: "" };
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw ? buildPttShortcut(raw.split("+")) : "";
  const tokens = parsePttShortcut(normalized);
  if (raw.split("+").length !== PTT_SHORTCUT_KEYS || tokens.length !== PTT_SHORTCUT_KEYS) {
    return { ok: false, error: "O atalho precisa de exatamente 2 teclas apertadas juntas." };
  }
  const modifiers = tokens.filter(isPttModifierToken);
  const keys = tokens.filter((token) => !isPttModifierToken(token));
  if (modifiers.length === 2) return { ok: false, error: "Use uma tecla comum junto com Ctrl ou Alt (duas teclas de controle sozinhas atrapalham outros atalhos)." };
  const browserKey = keys.find((key) => BROWSER_SOLO_CODES.has(key));
  if (browserKey) return { ok: false, error: `${pttTokenLabel(browserKey)} já tem outro uso no navegador/computador. Escolha outra tecla.` };
  if (!modifiers.length) {
    if (keys.some(isTypingCode)) return { ok: false, error: "Esse atalho atrapalha a digitação (letra, número ou tecla de texto sem Ctrl/Alt). Combine com Ctrl ou Alt, ou use teclas F." };
    return { ok: true, shortcut: normalized };
  }
  const [modifier] = modifiers;
  const [key] = keys;
  if (modifier === "Shift" && isTypingCode(key)) return { ok: false, error: "Shift com letra, número ou tecla de texto escreve na tela. Combine com Ctrl ou Alt." };
  if ((modifier === "Control" || modifier === "Meta") && CTRL_RESERVED[key]) return { ok: false, error: `${CTRL_RESERVED[key]} — escolha outro atalho.` };
  if (modifier === "Alt" && ALT_RESERVED[key]) return { ok: false, error: `${ALT_RESERVED[key]} — escolha outro atalho.` };
  if (key === "Enter" || key === "NumpadEnter" || key === "Escape") return { ok: false, error: "Enter e Esc já têm uso no Henry e nos formulários. Escolha outra tecla." };
  return { ok: true, shortcut: normalized };
}

// O que o servidor devolve/guarda: atalho válido ou "".
export function resolvePttShortcut(value) {
  const checked = validatePttShortcut(value);
  return checked.ok ? checked.shortcut : "";
}

// Teclas seguradas agora (peças) formam exatamente o atalho? (exato: Ctrl+Shift+Espaço não aciona Ctrl+Espaço)
export function matchesPttShortcut(shortcut, held = []) {
  const tokens = parsePttShortcut(shortcut);
  if (!tokens.length) return false;
  const set = new Set(Array.isArray(held) ? held : [...(held || [])]);
  return set.size === tokens.length && tokens.every((token) => set.has(token));
}

// Soltar qualquer uma das teclas do atalho = soltar.
export function isPttShortcutKey(shortcut, code) {
  const token = pttShortcutToken(code);
  return Boolean(token) && parsePttShortcut(shortcut).includes(token);
}

// --- Gravação do atalho na tela ------------------------------------------------------------------------------------------
// Estado: { held: [peças seguradas], peak: [maior conjunto segurado junto], result: null | { ok, shortcut } | { ok, error } }.
// Fecha quando TODAS as teclas são soltas: o maior conjunto segurado junto vira o atalho (validado).
export const PTT_RECORDER_INITIAL = Object.freeze({ held: Object.freeze([]), peak: Object.freeze([]), result: null });

export function pttRecorderStep(state = PTT_RECORDER_INITIAL, { type = "", code = "" } = {}) {
  const held = [...(state?.held || [])];
  let peak = [...(state?.peak || [])];
  const token = pttShortcutToken(code);
  if (!token) return { held, peak, result: state?.result || null };
  if (type === "down") {
    if (!held.includes(token)) held.push(token);
    if (held.length >= peak.length) peak = [...held];
    return { held, peak, result: null };
  }
  if (type === "up") {
    const next = held.filter((item) => item !== token);
    if (next.length || !peak.length) return { held: next, peak, result: null };
    if (peak.length !== PTT_SHORTCUT_KEYS) {
      return { held: [], peak: [], result: { ok: false, error: peak.length < PTT_SHORTCUT_KEYS ? "Aperte 2 teclas juntas (segure a primeira e aperte a segunda)." : "Foram mais de 2 teclas. Aperte só 2 juntas." } };
    }
    return { held: [], peak: [], result: validatePttShortcut(buildPttShortcut(peak)) };
  }
  return { held, peak, result: state?.result || null };
}

// --- Nome na tela --------------------------------------------------------------------------------------------------------
const TOKEN_LABELS = Object.freeze({
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Meta: "Win/⌘",
  Space: "Espaço",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "'",
  Insert: "Insert",
  Pause: "Pause",
  ScrollLock: "Scroll Lock",
  ContextMenu: "Menu"
});

export function pttTokenLabel(token) {
  if (TOKEN_LABELS[token]) return TOKEN_LABELS[token];
  const match = /^(?:Key|Digit)(.)$/.exec(token);
  if (match) return match[1];
  const numpad = /^Numpad(.+)$/.exec(token);
  if (numpad) return `${numpad[1]} (teclado numérico)`;
  return token;
}

export function pttShortcutLabel(shortcut) {
  const tokens = parsePttShortcut(shortcut);
  return tokens.length ? tokens.map(pttTokenLabel).join(" + ") : "";
}
