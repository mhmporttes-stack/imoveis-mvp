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

// 1.3.1 (app lento, 2026-10-23): a página do CRM some da vista com a janela minimizada, escondida na bandeja ou fechada.
// Vai à página pelo evento "mm:window-visibility" (onWindowVisibility); com ele ela pausa animações e consultas.
function isWindowHidden({ exists = true, visible = true, minimized = false } = {}) {
  return !exists || !visible || minimized === true;
}

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

// --- Palavra "Henry" offline (Vosk, fase 1.1; revista na 1.2.1) ---------------------------------------------------------
// Vocabulário do vosk-model-small-pt-0.3 conferido em 2026-10-23 na tabela de símbolos do Gr.fst (99.104 palavras):
// EXISTEM henry, henri, henrik, rei, ri, rio, ei, hei, olá, ola, ok, oi; NÃO existem enri, renri, rênri, hen, ren, okay,
// oquei. Palavra fora do vocabulário vira [unk] (o Vosk a ignora na gramática) — por isso o app confere no próprio modelo
// (src/vosk-vocab.js) e só usa as que existem; as listas abaixo são o ponto de partida.
// Alvos do NOME (frases; todas as palavras existem no modelo). "rei ri" = como o Vosk escreve o "Rênri" falado.
// "henrique"/"rene"/"rendi" (fracas no CRM) ficam FORA: aqui não há saudação para conferir e "o Henrique ligou" acordaria.
const WAKE_TARGETS = Object.freeze(["henry", "henri", "henrik", "rei ri"]);
// Palavras parecidas que "seguram" a fala comum (sem elas "entrei", "Enrique", "o Henrique" e "renda" viravam "Henry").
const WAKE_ABSORBERS = Object.freeze(["entrei", "enrique", "henrique", "renda", "energia", "entregou", "enviar", "entendi", "rio"]);
const WAKE_GRAMMAR = Object.freeze([...WAKE_TARGETS, ...WAKE_ABSORBERS, "[unk]"]);
const WAKE_WORDS_NOT_IN_MODEL = Object.freeze(["renri", "enri", "enry", "henrri", "rienri", "henrry", "henrie", "hendri", "henrei", "renne", "rennie"]);
// Existem no modelo, mas ficam de fora de propósito (no CRM só valem depois de saudação; aqui acordariam à toa).
const WAKE_WORDS_EXCLUDED = Object.freeze(["henrique", "rene", "rendi"]);
// Medido em 2026-10-23 com 4 vozes sintéticas pt-BR (Piper): 12 de 36 chamadas reconhecidas e 0 falso em 80 frases
// comuns. Com a voz do dono: 0 (log de 23/10, versão 1.1.0) — a 1.2.1 registra os "quase" (abaixo do mínimo) e tem o
// modo "Diagnóstico do nome" para medir. Ajuste aqui depois do diagnóstico.
const WAKE_MIN_CONFIDENCE = 0.3;
const WAKE_NEAR_CONFIDENCE = 0.1; // de 0,1 até o mínimo: não acorda, mas vai para o log como "quase"
const WAKE_COOLDOWN_MS = 4000; // depois de acordar, ignora o nome por 4 s (o CRM já está ouvindo o pedido)
const WAKE_SEQUENCE_GAP_MS = 2000; // "rei" no fim de um trecho + "ri" no começo do seguinte (até 2 s) = "rei ri"
const WAKE_PARTIAL_STABLE = 2; // resultado PARCIAL do Vosk: o mesmo nome em 2 parciais seguidos (~0,25 s) já acorda

// Palavra de chamada (1.2.1, plano B — "Voz e personalidade", só no app). Valor vindo do CRM: id de um modelo abaixo ou
// "custom:<palavra>". O app é quem decide: confere no vocabulário do modelo e, se faltar palavra, volta para "Henry".
const WAKE_WORD_PRESETS = Object.freeze([
  Object.freeze({ id: "henry", label: "Henry", prefixes: Object.freeze([]) }),
  Object.freeze({ id: "ei-henry", label: "Ei Henry", prefixes: Object.freeze(["ei", "hei"]) }),
  Object.freeze({ id: "ok-henry", label: "Ok Henry", prefixes: Object.freeze(["ok"]) })
]);
// Na palavra do dono, estas grafias do nome viram as variantes de WAKE_TARGETS ("Ei Rênri" = "ei henry", "ei rei ri"...).
const WAKE_NAME_ALIASES = Object.freeze(["henry", "henri", "rênri", "renri", "enri", "henrri", "henrry"]);
const WAKE_CUSTOM_MAX_CHARS = 40;
const WAKE_CUSTOM_MAX_WORDS = 3;

function normalizeWakeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "henry" | "ei-henry" | ... | "custom:minha palavra" → { id, text }. Qualquer outra coisa → Henry (com o motivo).
function parseWakeChoice(value) {
  const raw = typeof value === "string" ? value.slice(0, 80) : "";
  const preset = WAKE_WORD_PRESETS.find((item) => item.id === raw);
  if (preset) return { id: preset.id, text: "", error: "" };
  if (raw.startsWith("custom:")) {
    const text = normalizeWakeText(raw.slice(7));
    const words = text ? text.split(" ") : [];
    if (!text || text.length > WAKE_CUSTOM_MAX_CHARS || words.length > WAKE_CUSTOM_MAX_WORDS) return { id: "henry", text: "", error: "palavra_invalida" };
    return { id: "custom", text, error: "" };
  }
  return { id: "henry", text: "", error: raw ? "palavra_invalida" : "" };
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

// Configuração da escuta: { id, label, phrases (o que acorda), grammar (para o Vosk), missing, fallback }.
// hasWord(palavra) = existe no vocabulário do modelo (sem vocabulário carregado, assume as listas conferidas acima).
function buildWakeConfig(value, hasWord) {
  const known = typeof hasWord === "function" ? hasWord : () => true;
  const choice = parseWakeChoice(value);
  const names = WAKE_TARGETS.filter((phrase) => phrase.split(" ").every((word) => known(word)));
  const nameList = names.length ? names : [...WAKE_TARGETS];
  const finish = (id, label, phrases, extras, missing = [], fallback = false) => {
    const targetWords = new Set(phrases.flatMap((phrase) => phrase.split(" ")));
    const absorbers = WAKE_ABSORBERS.filter((word) => !targetWords.has(word) && !phrases.includes(word) && known(word));
    return {
      id,
      label,
      phrases: uniqueList(phrases),
      grammar: uniqueList([...phrases, ...extras, ...absorbers, "[unk]"]),
      missing,
      fallback,
      error: choice.error
    };
  };
  const henry = (missing = [], fallback = false) => finish("henry", "Henry", nameList, [], missing, fallback);
  if (choice.id === "custom") {
    const tokens = choice.text.split(" ");
    const missing = tokens.filter((word) => !WAKE_NAME_ALIASES.includes(word) && !known(word));
    if (missing.length) return henry(missing, true);
    let phrases = [""];
    for (const word of tokens) {
      const options = WAKE_NAME_ALIASES.includes(word) ? nameList : [word];
      phrases = phrases.flatMap((start) => options.map((option) => (start ? `${start} ${option}` : option))).slice(0, 24);
    }
    // Palavras soltas também entram na gramática (a 1ª sem a 2ª não acorda; a sequência é conferida em wakeSequenceStep).
    const extras = tokens.length > 1 ? tokens.flatMap((word) => (WAKE_NAME_ALIASES.includes(word) ? nameList : [word])) : [];
    return finish("custom", choice.text, phrases, extras);
  }
  const preset = WAKE_WORD_PRESETS.find((item) => item.id === choice.id) || WAKE_WORD_PRESETS[0];
  if (!preset.prefixes.length) return henry([], Boolean(choice.error));
  const prefixes = preset.prefixes.filter((word) => known(word));
  if (!prefixes.length) return henry([...preset.prefixes], true);
  const phrases = prefixes.flatMap((prefix) => nameList.map((name) => `${prefix} ${name}`));
  return finish(preset.id, preset.label, phrases, [...prefixes, ...nameList]);
}

// Melhor ocorrência de uma frase-alvo em seguida, a partir de minEnd (a frase precisa terminar depois desse índice).
// Confiança da frase = a menor das palavras. Sem mínimo aqui (quem decide é quem chama).
function scoreWakeInWords(words, phrases = WAKE_TARGETS, minEnd = 0) {
  const list = Array.isArray(words) ? words.slice(-60) : [];
  const seq = list.map((item) => (item && typeof item.word === "string" ? item.word : ""));
  let best = null;
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    const parts = String(phrase).split(" ");
    for (let index = 0; index + parts.length <= seq.length; index += 1) {
      if (index + parts.length <= minEnd) continue;
      if (!parts.every((part, offset) => seq[index + offset] === part)) continue;
      const confidence = Math.min(...parts.map((_, offset) => Number(list[index + offset].conf) || 0));
      if (!best || confidence > best.confidence) best = { phrase, confidence };
    }
  }
  return best;
}

// Resultado do Vosk ({ result: [{ word, conf }], text }) → { phrase, confidence } quando há o nome com confiança suficiente.
// Frase de duas palavras ("rei ri") precisa das duas seguidas; a confiança é a menor das duas.
function detectWakeInResult(result, minConfidence = WAKE_MIN_CONFIDENCE, phrases = WAKE_TARGETS) {
  const best = scoreWakeInWords(Array.isArray(result?.result) ? result.result : [], phrases);
  return best && best.confidence >= minConfidence ? best : null;
}

// Lógica de SEQUÊNCIA entre trechos: o Vosk pode fechar um trecho no meio ("rei" | "ri", "ei" | "henry"). O fim do trecho
// anterior (até WAKE_SEQUENCE_GAP_MS) é juntado ao começo do novo; a frase precisa usar pelo menos uma palavra nova
// (o mesmo nome nunca acorda duas vezes). Devolve { hit, near, state }: near = melhor candidato abaixo do mínimo.
function wakeSequenceStep(state, { now = 0, words = [], phrases = WAKE_TARGETS, minConfidence = WAKE_MIN_CONFIDENCE } = {}) {
  const fresh = (Array.isArray(words) ? words : []).filter((item) => item && typeof item.word === "string").slice(-50);
  const tail = state && Array.isArray(state.tail) && Number.isFinite(state.at) && now - state.at <= WAKE_SEQUENCE_GAP_MS ? state.tail : [];
  const joined = [...tail, ...fresh];
  const best = scoreWakeInWords(joined, phrases, tail.length);
  const longest = Math.max(1, ...(Array.isArray(phrases) ? phrases : []).map((phrase) => String(phrase).split(" ").length));
  if (best && best.confidence >= minConfidence) return { hit: best, near: null, state: { tail: [], at: now } };
  const near = best && best.confidence >= WAKE_NEAR_CONFIDENCE ? best : null;
  return { hit: null, near, state: { tail: longest > 1 ? joined.slice(-(longest - 1)) : [], at: now } };
}

// Resultado PARCIAL (texto, sem confiança): acorda quando o mesmo nome aparece em WAKE_PARTIAL_STABLE parciais seguidos
// da mesma fala; uma vez por fala (parcial vazio = fala nova).
function wakePartialStep(state, { text = "", phrases = WAKE_TARGETS } = {}) {
  const tokens = normalizeWakeText(text).split(" ").filter(Boolean);
  if (!tokens.length) return { hit: null, state: { candidate: "", count: 0, fired: false } };
  const current = { candidate: state?.candidate || "", count: Number(state?.count) || 0, fired: Boolean(state?.fired) };
  let found = "";
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    const parts = String(phrase).split(" ");
    for (let index = 0; index + parts.length <= tokens.length && !found; index += 1) {
      if (parts.every((part, offset) => tokens[index + offset] === part)) found = phrase;
    }
    if (found) break;
  }
  if (!found) return { hit: null, state: { candidate: "", count: 0, fired: current.fired } };
  const count = found === current.candidate ? current.count + 1 : 1;
  if (!current.fired && count >= WAKE_PARTIAL_STABLE) return { hit: { phrase: found }, state: { candidate: found, count, fired: true } };
  return { hit: null, state: { candidate: found, count, fired: current.fired } };
}

// Pausa da escuta enquanto o CRM toca som (Henry falando, aviso, vídeo) — conferida a cada ~0,5 s e em cada evento.
// Volta WAKE_RESUME_AFTER_SOUND_MS depois do som parar. Trava de segurança: pausada há mais de WAKE_MAX_PAUSE_MS com som
// contínuo → volta à força e ignora esse som até ele parar (nunca fica pausada para sempre).
// Devolve { state, event }: event = null | { type: "pausa", reason } | { type: "retomada", reason, ms }.
const WAKE_RESUME_AFTER_SOUND_MS = 700;
const WAKE_MAX_PAUSE_MS = 120000;
const WAKE_PAUSE_INITIAL = Object.freeze({ paused: false, since: null, quietSince: null, ignoreUntilQuiet: false });
function wakePauseStep(state, { now = 0, audible = false } = {}) {
  const current = { ...WAKE_PAUSE_INITIAL, ...(state || {}) };
  if (!audible) {
    current.ignoreUntilQuiet = false;
    if (!current.paused) return { state: current, event: null };
    if (current.quietSince === null) return { state: { ...current, quietSince: now }, event: null };
    if (now - current.quietSince < WAKE_RESUME_AFTER_SOUND_MS) return { state: current, event: null };
    return { state: { ...WAKE_PAUSE_INITIAL }, event: { type: "retomada", reason: "som_parou", ms: Math.max(0, now - current.since) } };
  }
  if (current.ignoreUntilQuiet) return { state: current, event: null };
  if (!current.paused) return { state: { paused: true, since: now, quietSince: null, ignoreUntilQuiet: false }, event: { type: "pausa", reason: "som_do_crm" } };
  if (now - current.since >= WAKE_MAX_PAUSE_MS) {
    return { state: { ...WAKE_PAUSE_INITIAL, ignoreUntilQuiet: true }, event: { type: "retomada", reason: "tempo_maximo", ms: Math.max(0, now - current.since) } };
  }
  return { state: { ...current, quietSince: null }, event: null };
}

// Limite de frequência do log, por chave: intervalo mínimo e/ou teto por janela. Devolve { allow, suppressed, state }
// (suppressed = quantas foram seguradas desde a última que passou; quem chama acrescenta "(+N omitidas)").
function logLimitStep(state, key, now, { minIntervalMs = 0, maxPerWindow = Infinity, windowMs = 600000 } = {}) {
  const all = state && typeof state === "object" ? state : {};
  let entry = all[key] || { last: -Infinity, windowStart: now, count: 0, suppressed: 0 };
  if (now - entry.windowStart >= windowMs) entry = { ...entry, windowStart: now, count: 0 };
  const allow = now - entry.last >= minIntervalMs && entry.count < maxPerWindow;
  if (!allow) return { allow: false, suppressed: 0, state: { ...all, [key]: { ...entry, suppressed: entry.suppressed + 1 } } };
  return { allow: true, suppressed: entry.suppressed, state: { ...all, [key]: { ...entry, last: now, count: entry.count + 1, suppressed: 0 } } };
}

// Nível do microfone no log: a cada 10 s nos primeiros 10 min de escuta e durante o diagnóstico; depois, a cada 5 min.
const WAKE_LEVEL_FAST_MS = 10000;
const WAKE_LEVEL_SLOW_MS = 300000;
const WAKE_LEVEL_FAST_WINDOW_MS = 600000;
function levelLogIntervalMs({ sinceStartMs = 0, diagnostic = false } = {}) {
  return diagnostic || sinceStartMs < WAKE_LEVEL_FAST_WINDOW_MS ? WAKE_LEVEL_FAST_MS : WAKE_LEVEL_SLOW_MS;
}

function toDb(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(-120, Math.round(20 * Math.log10(number))) : -120;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

const WAKE_REPORT_KINDS = Object.freeze(["dispositivo", "nivel", "erro", "aviso", "diag"]);
// Mensagens da página da escuta (canal mm:wake-report) → objeto limpo, ou null. Só números e textos curtos.
function sanitizeWakeReport(kind, data) {
  if (!WAKE_REPORT_KINDS.includes(kind)) return null;
  const info = data && typeof data === "object" ? data : {};
  if (kind === "dispositivo") {
    return {
      kind,
      label: cleanText(info.label, 80) || "sem nome",
      defaultLabel: cleanText(info.defaultLabel, 80),
      usingDefault: Boolean(info.usingDefault),
      deviceRate: Math.round(clampNumber(info.deviceRate, 0, 384000)),
      contextRate: Math.round(clampNumber(info.contextRate, 0, 384000)),
      channels: Math.round(clampNumber(info.channels, 0, 32)),
      inputs: Math.round(clampNumber(info.inputs, 0, 99))
    };
  }
  if (kind === "nivel") {
    return {
      kind,
      rms: clampNumber(info.rms, 0, 1),
      peak: clampNumber(info.peak, 0, 1),
      noise: clampNumber(info.noise, 0, 1),
      voiced: clampNumber(info.voiced, 0, 1),
      segments: Math.round(clampNumber(info.segments, 0, 9999)),
      frames: Math.round(clampNumber(info.frames, 0, 99999)),
      paused: Boolean(info.paused)
    };
  }
  if (kind === "diag") {
    const words = (Array.isArray(info.words) ? info.words : [])
      .slice(0, 30)
      .map((item) => ({ word: typeof item?.word === "string" ? cleanText(item.word, 30) : "", conf: clampNumber(item?.conf, 0, 1) }))
      .filter((item) => item.word);
    return { kind, text: cleanText(info.text, 200), words };
  }
  return { kind, where: cleanText(info.where, 30) || "?", message: cleanText(info.message, 160) || "?" };
}

function formatWakeWords(words, max = 12) {
  return (Array.isArray(words) ? words : [])
    .slice(0, max)
    .map((item) => `${cleanText(item?.word, 30)} ${clampNumber(item?.conf, 0, 1).toFixed(2)}`)
    .join(", ");
}

function formatLevelDetail(report) {
  if (!report) return "";
  const base = `nivel media ${toDb(report.rms)} dB pico ${toDb(report.peak)} dB ruido ${toDb(report.noise)} dB fala ${Math.round(report.voiced * 100)}% trechos ${report.segments}`;
  const frames = report.frames === 0 ? " SEM_AUDIO (o microfone não entregou som)" : "";
  return `${base}${report.paused ? " pausada" : ""}${frames}`;
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

// --- Atualização automática (versão 1.3.0, dono 2026-10-23) ----------------------------------------------------------
// O app procura versão nova ao abrir e a cada 4 h, baixa em segundo plano e avisa; "Depois" = instala ao Sair.
// Endereço de leitura pública (sem token/segredo no app); o arquivo latest.yml traz versão + SHA-512 do instalador.
const UPDATE_FEED_URL = "https://github.com/mhmporttes-stack/imoveis-mvp/releases/download/desktop-latest";
const UPDATE_FIRST_CHECK_MS = 30000; // 30 s depois de abrir (o CRM carrega primeiro)
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_STATES = Object.freeze(["parado", "procurando", "baixando", "pronta", "erro"]);

// Item da bandeja conforme o estado: { label, enabled, install } (install = clicar reinicia e instala).
function updateTrayItem({ state = "parado", version = "", percent = 0 } = {}) {
  const v = cleanText(version, 20);
  if (state === "pronta" && v) return { label: `Nova versão ${v} pronta — Reiniciar agora`, enabled: true, install: true };
  if (state === "baixando") return { label: `Baixando versão ${v || "nova"} (${Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))}%)`, enabled: false, install: false };
  if (state === "procurando") return { label: "Procurando atualização...", enabled: false, install: false };
  return { label: "Procurar atualização", enabled: true, install: false };
}

// 1.3.1 (REGRA OFICIAL — dono, 2026-10-23: nenhum aviso fixo no meio da tela com a tela cheia do Henry aberta). A caixa
// "Nova versão X pronta — Reiniciar agora / Depois" fica guardada enquanto a página avisa que a tela cheia está aberta
// (evento henryFullscreen da ponte) e aparece quando ela fecha. Nada se perde: a atualização continua baixada e "pronta"
// (bandeja e instalação ao Sair seguem iguais). Passo puro: devolve o novo estado e a versão a mostrar AGORA (ou "").
const UPDATE_PROMPT_INITIAL = Object.freeze({ held: false, pendingVersion: "" });
function updatePromptStep(state = UPDATE_PROMPT_INITIAL, event = {}) {
  const current = { held: state?.held === true, pendingVersion: cleanText(state?.pendingVersion, 20) };
  if (event?.type === "ask") {
    const version = cleanText(event.version, 20);
    if (current.held) return { state: { ...current, pendingVersion: version || current.pendingVersion }, show: "" };
    return { state: { ...current, pendingVersion: "" }, show: version };
  }
  if (event?.type === "hold") {
    const held = event.held === true;
    if (!held && current.pendingVersion) return { state: { held: false, pendingVersion: "" }, show: current.pendingVersion };
    return { state: { ...current, held }, show: "" };
  }
  return { state: current, show: "" };
}

// Erro do atualizador → texto curto para o log (sem endereço completo nem pilha).
function updateErrorDetail(error) {
  const code = cleanText(error?.code, 40);
  const message = cleanText(String(error?.message || error || "erro").split("\n")[0].replace(/https?:\/\/\S+/g, "<url>"), 160);
  return code ? `${code} ${message}` : message;
}

module.exports = {
  UPDATE_PROMPT_INITIAL,
  updatePromptStep,
  UPDATE_FEED_URL,
  UPDATE_FIRST_CHECK_MS,
  UPDATE_INTERVAL_MS,
  UPDATE_STATES,
  updateTrayItem,
  updateErrorDetail,
  CRM_HOME,
  ALLOWED_ORIGINS,
  AUTO_PERMISSIONS,
  EXTERNAL_PROTOCOLS,
  SPOTIFY_URI,
  MAX_SPEAK_TEXT,
  BRIDGE_ACTIONS,
  isWindowHidden,
  WAKE_TARGETS,
  WAKE_GRAMMAR,
  WAKE_WORDS_NOT_IN_MODEL,
  WAKE_WORDS_EXCLUDED,
  WAKE_MIN_CONFIDENCE,
  WAKE_NEAR_CONFIDENCE,
  WAKE_COOLDOWN_MS,
  WAKE_SEQUENCE_GAP_MS,
  WAKE_PARTIAL_STABLE,
  WAKE_WORD_PRESETS,
  WAKE_NAME_ALIASES,
  WAKE_RESUME_AFTER_SOUND_MS,
  WAKE_MAX_PAUSE_MS,
  WAKE_PAUSE_INITIAL,
  WAKE_LEVEL_FAST_MS,
  WAKE_LEVEL_SLOW_MS,
  WAKE_REPORT_KINDS,
  WAKE_ORIGIN,
  normalizeWakeText,
  parseWakeChoice,
  buildWakeConfig,
  scoreWakeInWords,
  wakeSequenceStep,
  wakePartialStep,
  wakePauseStep,
  logLimitStep,
  levelLogIntervalMs,
  toDb,
  sanitizeWakeReport,
  formatWakeWords,
  formatLevelDetail,
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
