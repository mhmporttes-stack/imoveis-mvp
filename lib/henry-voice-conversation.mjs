// Conversa natural com o Henry (pedido do dono, 2026-10-22: "quero que pareça com uma conversa: se ele estiver falando e
// eu falar o nome dele, ele para" — docs/BUSINESS_RULES.md HENRY-1, "Modo conversa"). Núcleo PURO, usado pelo navegador
// (components/henry/HenryVoiceAssistant.jsx), pelo servidor (fala em partes) e pelos testes. Nada aqui grava nada: a
// memória da conversa vive só na página e é zerada ao sair do modo conversa.
import { detectWakeWord, isGreetingOnly, looksLikeEcho, normalizeSpeechText, WAKE_STRONG_PATTERN, WAKE_WORDS_STRONG, HENRY_HISTORY_TURNS } from "./henry-voice-core.mjs";
import { henryMusicIntent } from "./henry-voice-narration.mjs";
import { henryNeedsTools, isHenryGreeting } from "./henry-voice-persona.mjs";
import { isPttShortcutKey, matchesPttShortcut } from "./henry-ptt-shortcut-core.mjs";

// Janela de conversa: depois de qualquer resposta, ~40 s em que frases sem o nome valem (computador e celular), com o
// filtro de eco e ruído (dono, 2026-10-22: "minimizado… interage como se estivesse escutando, mas não responde").
export const CONVERSATION_IDLE_MS = 40000;
export const CONVERSATION_EXCHANGES = HENRY_HISTORY_TURNS / 2; // trocas (pergunta + resposta) mandadas ao modelo

// --- Interrupção ("barge-in") -----------------------------------------------------------------------------------------
// Enquanto o Henry fala ou pensa, SÓ o nome e as palavras de parada valem (o resto é a própria voz dele ou conversa da sala).
// currentSpeech = a frase QUE ESTÁ TOCANDO (trecho atual da fila), não a resposta inteira (dono, 2026-10-23: "ele não para
// quando é interrompido" — comparar com a resposta inteira descartava o "para" do dono sempre que a resposta tinha "para").
const STOP_WORDS = new Set(["para", "pare", "parar", "espera", "espere", "pera", "perai", "chega", "calma", "silencio", "stop"]);
const STOP_FILLER = new Set(["ai", "ei", "ok", "por", "favor", "agora", "so", "um", "pouco", "pode", "ta", "bom", ...WAKE_WORDS_STRONG]);
const LEAD_FILLER = new Set(["ei", "ai", "oi", "opa", "o", "e", "ah", "eh"]);

export function isStopCommand(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  return tokens.some((word) => STOP_WORDS.has(word)) && tokens.every((word) => STOP_WORDS.has(word) || STOP_FILLER.has(word));
}

// Devolve { interrupt, kind: "question" | "report" | "wake" | "stop" | "", question, echoRisk? }.
// 1) Nome no começo ("Henry, e ontem?") → interrompe. 2) Parada curta ("para", "pára", "pare", "espera", "chega", "peraí",
// "calma", "silêncio", "para, Henry") → SEMPRE interrompe, mesmo que a palavra esteja na fala dele (dono, 2026-10-23). 3) Frase
// do dono que COMEÇA por palavra de parada ("para com isso") → interrompe, salvo se a frase inteira for eco da frase que está
// tocando ("para hoje temos três visitas" ouvido enquanto ele diz isso). 4) O Chrome junta a voz dele com a do dono na MESMA
// frase ("…seu relatório henry para"): olha as últimas BARGE_TAIL palavras — nome ou parada que NÃO está na frase atual
// interrompe; o que vier depois do nome vira a pergunta.
const BARGE_TAIL = 6;

function questionAfterWake(tokens, from = 0) {
  for (let index = from; index < tokens.length; index += 1) {
    if (WAKE_WORDS_STRONG.includes(tokens[index])) return tokens.slice(index + 1).join(" ");
  }
  return "";
}

export function detectBargeIn(text, currentSpeech = "") {
  const wake = detectWakeWord(text);
  if (wake.called && !wake.anywhere) return { interrupt: true, kind: wake.kind, question: wake.question };
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  const spoken = new Set(normalizeSpeechText(currentSpeech).split(" ").filter(Boolean));
  // echoRisk = a palavra de parada também está na frase que toca: a tela só corta com a voz do dono confirmada no microfone.
  const echoRisk = tokens.some((word) => STOP_WORDS.has(word) && spoken.has(word));
  if (isStopCommand(text)) return { interrupt: true, kind: "stop", question: "", echoRisk };
  let lead = 0;
  while (lead < tokens.length - 1 && LEAD_FILLER.has(tokens[lead])) lead += 1;
  if (STOP_WORDS.has(tokens[lead]) && !(tokens.length >= 3 && looksLikeEcho(text, currentSpeech))) {
    const question = questionAfterWake(tokens, lead + 1);
    return question ? { interrupt: true, kind: "question", question, echoRisk } : { interrupt: true, kind: "stop", question: "", echoRisk };
  }
  const start = Math.max(0, tokens.length - BARGE_TAIL);
  for (let index = start; index < tokens.length; index += 1) {
    const word = tokens[index];
    if (WAKE_WORDS_STRONG.includes(word) && !spoken.has(word)) {
      const question = tokens.slice(index + 1).join(" ");
      return { interrupt: true, kind: question ? "question" : "wake", question };
    }
    if (STOP_WORDS.has(word) && !spoken.has(word)) return { interrupt: true, kind: "stop", question: "" };
  }
  return { interrupt: false, kind: "", question: "" };
}

// --- Qualquer fala do dono interrompe (dono, 2026-10-22: "quando eu falo, ele não para de falar") -------------------------
// Enquanto o Henry FALA: olha só as últimas SPEECH_BARGE_WINDOW palavras do parcial (o começo costuma ser a voz dele) e só as
// palavras de CONTEÚDO (artigos, preposições e palavras comuns não contam). Interrompe quando há ≥ 3 palavras e 3+ palavras
// de conteúdo que NÃO estão na frase que está tocando (ou 2, com menos de 40% de sobreposição com a fala dele). Na
// frase final, ela vira a nova pergunta. Nome e parada continuam valendo (detectBargeIn). No computador a voz do dono ainda
// precisa ser confirmada pelo detector de voz local (VAD) ou pelo medidor do microfone; no celular continua tocar para
// interromper (microfone desligado enquanto ele fala).
export const SPEECH_BARGE_MIN_WORDS = 3;
export const SPEECH_BARGE_MIN_CONTENT = 2;
export const SPEECH_BARGE_STRONG_CONTENT = 3;
export const SPEECH_BARGE_WINDOW = 8;
export const SPEECH_BARGE_MAX_OVERLAP = 0.4;
// Medidor do microfone (cancelamento de eco ligado, supressão de ruído desligada): ~0,055 por ~150 ms.
export const SPEECH_BARGE_LEVEL = 0.055;
export const SPEECH_BARGE_LEVEL_MS = 150;

// Palavras comuns do português falado: não dizem nada sobre quem está falando (o "e", o "de", o "que" estão em toda frase).
const COMMON_WORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "e", "ou", "mas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
  "nas", "por", "pelo", "pela", "pelos", "pelas", "com", "sem", "pra", "pro", "ao", "aos", "que", "se", "nao", "sim", "ja",
  "mais", "menos", "muito", "muita", "bem", "so", "tambem", "isso", "isto", "esse", "essa", "este", "esta", "esses", "essas",
  "aquele", "aquela", "ele", "ela", "eles", "elas", "eu", "voce", "voces", "nos", "me", "te", "lhe", "seu", "sua", "seus",
  "suas", "meu", "minha", "meus", "minhas", "e", "foi", "ser", "ta", "tem", "ter", "vai", "vou", "ai", "la", "aqui", "agora",
  "entao", "como", "quando", "onde", "qual", "quais", "ne", "ok", "tipo", "assim", "ate", "hum", "ah", "eh", "uhum", "aham"
]);

export function contentWords(text) {
  return normalizeSpeechText(text).split(" ").filter((word) => word && !COMMON_WORDS.has(word));
}

function bargeWindow(text) {
  return normalizeSpeechText(text).split(" ").filter(Boolean).slice(-SPEECH_BARGE_WINDOW);
}

// Parte das palavras de conteúdo (das últimas ~8 do parcial) que está na frase atual dele. Sem conteúdo = 1 (não decide).
export function speechOverlap(text, currentSpeech = "") {
  const content = contentWords(bargeWindow(text).join(" "));
  if (!content.length) return 1;
  const spoken = new Set(contentWords(currentSpeech));
  return content.filter((word) => spoken.has(word)).length / content.length;
}

export function detectSpeechBargeIn(text, currentSpeech = "", { final = false } = {}) {
  const named = detectBargeIn(text, currentSpeech);
  if (named.interrupt) return named;
  const none = { interrupt: false, kind: "", question: "" };
  const window = bargeWindow(text);
  if (window.length < SPEECH_BARGE_MIN_WORDS || window.every((word) => NOISE.has(word))) return none;
  const spoken = new Set(contentWords(currentSpeech));
  const fresh = contentWords(window.join(" ")).filter((word) => !spoken.has(word));
  if (fresh.length < SPEECH_BARGE_MIN_CONTENT) return none;
  // 3+ palavras de conteúdo novas bastam; com só 2, a mistura com a voz dele tem de ser pequena (< 40%).
  if (fresh.length < SPEECH_BARGE_STRONG_CONTENT && speechOverlap(text, currentSpeech) >= SPEECH_BARGE_MAX_OVERLAP) return none;
  return { interrupt: true, kind: final ? "question" : "speech", question: final ? String(text || "").trim() : "" };
}

// Medidor do microfone: voz acima do limiar contínua por ~150 ms (cancelamento de eco ligado). since = início do trecho alto.
export function micVoiceSustained({ level = 0, since = 0, now = Date.now(), threshold = SPEECH_BARGE_LEVEL, holdMs = SPEECH_BARGE_LEVEL_MS } = {}) {
  if (level < threshold) return { sustained: false, since: 0 };
  const start = since || now;
  return { sustained: now - start >= holdMs, since: start };
}

// --- Interrupção em 2 etapas com o detector de voz local (VAD), dono 2026-10-23 -------------------------------------------
// 1) O VAD (Silero, no próprio navegador, sobre o microfone com cancelamento de eco) ouviu voz e o medidor confirma volume →
//    baixa o volume do Henry na hora (BARGE_DUCK_VOLUME). 2) O texto confirma (parcial do Chrome ou, no app de desktop, o
//    trecho curto transcrito pela ElevenLabs): parada/nome ou fala do dono que não é eco → para de vez e ouve o pedido. Sem
//    confirmação em BARGE_CONFIRM_MS depois que a voz acabou, o volume volta (no app de desktop, espera a transcrição até
//    BARGE_TRANSCRIBE_WAIT_MS). Nada do áudio é guardado: no app de desktop só o trecho em que o VAD ouviu voz sai do aparelho.
export const BARGE_DUCK_VOLUME = 0.25;
export const BARGE_CONFIRM_MS = 1500;
export const BARGE_TRANSCRIBE_WAIT_MS = 5000;
export const BARGE_SEGMENT_MAX_MS = 10000;
export const BARGE_SEGMENT_MIN_MS = 250;
// Celular: continua TOCAR para interromper (o cancelamento de eco do iOS 26.2+ tem defeito). Chave preparada, DESLIGADA.
export const HENRY_MOBILE_BARGE_IN = false;

// Como interromper enquanto ele fala: "recognition" (Chrome: parcial + VAD), "transcribe" (app de desktop: VAD + trecho
// curto → Scribe), "tap" (celular: tocar na tela; microfone desligado enquanto ele fala).
// pttOnly = "Só quando eu apertar" (dono, 2026-10-24): sem interrupção por voz — apertar é que interrompe.
export function henryBargeMode({ desktop = false, desktopApp = false, recordMode = false, mobileBargeIn = HENRY_MOBILE_BARGE_IN, pttOnly = false } = {}) {
  if (pttOnly) return "tap";
  if (desktopApp) return recordMode ? "transcribe" : "recognition";
  if (desktop) return "recognition";
  if (!mobileBargeIn) return "tap";
  return recordMode ? "transcribe" : "recognition";
}

// Volume abaixado: volta quando a voz acabou há BARGE_CONFIRM_MS sem confirmação (ou a transcrição demorou demais).
export function shouldRestoreVolume({ ducked = false, voiceActive = false, lastVoiceAt = 0, waitingSince = 0, now = Date.now() } = {}) {
  if (!ducked || voiceActive) return false;
  if (waitingSince) return now - waitingSince >= BARGE_TRANSCRIBE_WAIT_MS;
  return now - Number(lastVoiceAt || 0) >= BARGE_CONFIRM_MS;
}

// Trecho do VAD (Float32, -1..1) → WAV 16 bits mono, só na memória (vai no corpo do pedido de transcrição e é descartado).
export function floatToWavBytes(samples, sampleRate = 16000) {
  const list = samples && typeof samples.length === "number" ? samples : [];
  const count = list.length;
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(list[index]) || 0));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

// --- Fim do modo conversa ---------------------------------------------------------------------------------------------
const END_PHRASES = new Set([
  "obrigado", "obrigada", "obrigadao", "valeu", "pode parar", "tchau", "tchau tchau", "ate mais", "ate logo", "ate depois",
  "encerrar", "encerra", "pode ir", "so isso", "e so isso", "era so isso", "por hoje e so", "obrigado era so isso", "obrigado e so isso"
]);
const END_FILLER = new Set(["ok", "entao", "ta", "bom", "muito", "por", "favor", "ai", "beleza", ...WAKE_WORDS_STRONG]);

export function isConversationEnd(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 7) return false;
  const core = tokens.filter((word) => !END_FILLER.has(word)).join(" ");
  if (END_PHRASES.has(core)) return true;
  return tokens.includes("tchau") && tokens.length <= 4;
}

export function isConversationExpired(lastActivityAt, now = Date.now(), idleMs = CONVERSATION_IDLE_MS) {
  return !lastActivityAt || now - lastActivityAt >= idleMs;
}

// --- Continuação sem o nome (modo conversa, Henry calado) -------------------------------------------------------------
const NOISE = new Set(["hum", "hmm", "humm", "ah", "ahn", "eh", "uhum", "aham", "ok", "ta", "e", "o", "a", "ne"]);

// spoken = o que o Henry falou por último (resposta e confirmação curta): frase igual é eco e é ignorada.
export function isEchoOf(text, spoken = []) {
  return (Array.isArray(spoken) ? spoken : [spoken]).some((item) => item && looksLikeEcho(text, item));
}

export function acceptFollowUp(text, spoken = []) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.every((word) => NOISE.has(word))) return false;
  if (isStopCommand(text)) return false;
  return !isEchoOf(text, spoken);
}

// Memória da conversa: só as trocas desde o início do modo conversa (startIndex), no máximo as últimas ~6.
export function conversationHistory(turns, startIndex = 0, exchanges = CONVERSATION_EXCHANGES) {
  const list = Array.isArray(turns) ? turns.slice(Math.max(0, Number(startIndex) || 0)) : [];
  return list.filter((turn) => turn && typeof turn.text === "string").slice(-exchanges * 2).map((turn) => ({ role: turn.role, text: turn.text }));
}

// Legenda do ícone do canto (cresce quando chamado): pensando → a pergunta; falando/em conversa → a última resposta.
export function henryCaption(phase, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const last = (role) => [...list].reverse().find((turn) => turn?.role === role)?.text || "";
  if (phase === "thinking") return last("user");
  if (phase === "speaking" || phase === "armed") return last("assistant");
  return "";
}

// --- Ritmo -----------------------------------------------------------------------------------------------------------
// Sem confirmação falada enquanto pensa (dono, 2026-10-22: o "Deixa eu ver…" saía numa voz diferente): só o anel no
// estado "pensando"; a espera é resolvida pela velocidade do servidor (cache, pré-aquecimento).

// Primeira frase primeiro: a voz da 1ª frase fica pronta antes e já começa a tocar enquanto o resto é gerado.
export function splitForSpeech(text) {
  const value = String(text || "").trim();
  const match = value.match(/^(.{20,}?[.!?])\s+(\S[\s\S]*)$/);
  return match ? [match[1], match[2]] : value ? [value] : [];
}

// --- Computador x celular (dono, 2026-10-22: "também gostaria do Henry no celular, no aplicativo") ------------------------
// Computador: escuta sempre ativa com a palavra de chamada. Celular: TOCAR PARA FALAR (escuta contínua não é confiável no
// iOS/Android, gasta bateria e para em segundo plano) — a escuta roda só com a cena aberta ou em conversa; a opção
// "Ouvir 'Henry' com o app aberto" (henry_voice_assistant.mobileWake, nasce desligada) volta à escuta contínua.
export function henryListenMode({ desktop = false, mobileWake = false } = {}) {
  return desktop || mobileWake ? "always" : "tap";
}

export function shouldRunRecognition({ mode = "always", sessionOpen = false } = {}) {
  return mode === "always" || Boolean(sessionOpen);
}

// Áudio curtinho de silêncio (WAV) tocado no TOQUE que abre o Henry: destrava o elemento de áudio único no Safari do iOS
// (depois disso ele pode tocar as respostas sem novo toque).
export function silentWavDataUri() {
  const bytes = [
    0x52, 0x49, 0x46, 0x46, 0x26, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0, 0, 1, 0, 1, 0,
    0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 2, 0, 0, 0, 0, 0
  ];
  const binary = String.fromCharCode(...bytes);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return `data:audio/wav;base64,${base64}`;
}

// Escuta que caiu: religa com espera crescente (0,4 s, 0,8 s… até 30 s); volta ao rápido quando ouve algo.
export function nextRestartDelay(failures = 0) {
  return Math.min(30000, 400 * 2 ** Math.max(0, Math.min(10, Number(failures) || 0)));
}

// --- Um aparelho por vez (dono, 2026-10-22: "fala uma voz primeiro... e depois ele inicia pelo computador") ---------------
// Celular e computador ouvem a mesma frase. Quem fala com o Henry primeiro fica com a conversa por DEVICE_HOLD_MS desde a
// última troca; o outro aparelho fica calado. deviceId é aleatório, só do navegador (nada de identificação do aparelho).
export const DEVICE_HOLD_MS = 25000;

export function decideDeviceClaim({ current = null, deviceId = "", now = Date.now(), holdMs = DEVICE_HOLD_MS } = {}) {
  const id = String(deviceId || "").slice(0, 64);
  if (!id) return { allowed: true, next: null };
  const other = current && current.deviceId && current.deviceId !== id && now - Number(current.at || 0) < holdMs;
  if (other) return { allowed: false, next: null };
  return { allowed: true, next: { deviceId: id, at: now } };
}

// --- Tocar para falar por GRAVAÇÃO (dono, 2026-10-22: "no celular só responde se eu escrever a mensagem") -----------------
// No app instalado no iPhone (tela de início, modo standalone) o reconhecimento de voz do navegador não existe ou falha.
// Celular sem reconhecimento, com reconhecimento que falhou, ou iPhone no app instalado → grava o áudio (MediaRecorder) e o
// servidor transcreve (ElevenLabs Scribe). Computador continua com o reconhecimento do Chrome.
// App de desktop do dono (desktop-app/, Electron; dono 2026-10-23): o Electron não traz o reconhecimento de voz do Chrome
// (o SpeechRecognition existe, mas sempre falha com "network" — ele depende do serviço do Google que só o Chrome tem), então
// lá é sempre a gravação, acionada pelo atalho Ctrl+Shift+H, pelo toque no Henry ou depois do "Chefe?" do aviso.
export function henryCaptureMode({ desktop = false, desktopApp = false, hasRecognition = false, hasRecorder = false, recognitionFailed = false, iosStandalone = false } = {}) {
  if (desktopApp) return hasRecorder ? "record" : "none";
  if (desktop) return hasRecognition ? "recognition" : "none";
  if (hasRecognition && !recognitionFailed && !iosStandalone) return "recognition";
  return hasRecorder ? "record" : hasRecognition && !recognitionFailed ? "recognition" : "none";
}

// Formato da gravação: o iPhone grava audio/mp4 (AAC); Chrome/Android, webm/opus. "" = o padrão do navegador.
export const RECORDER_MIME_TYPES = Object.freeze(["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]);
export function pickRecorderMimeType(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  return RECORDER_MIME_TYPES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  }) || "";
}

// --- Fim da fala na gravação (dono, 2026-10-23: "uma simples pausa de 1 segundo e ele já começa a pensar") ---------------
// A gravação só fecha sozinha depois de um silêncio CONTÍNUO do tempo escolhido em "Voz e personalidade" (curto/normal/
// longo = 1,2/2,0/3,0 s; padrão normal — henry-voice-style.mjs HENRY_END_WAITS). Resposta curta a uma pergunta aberta dele
// ("sim", "pode") fecha com 1,2 s, mas só enquanto a fala tem até ~1,5 s de voz. Histerese: (1) com o VAD Silero rodando
// (app de desktop), enquanto ele ainda diz "tem voz" a fala não acaba, e o silêncio conta a partir do fim que ele reportou;
// (2) no medidor, depois de ouvir voz, um nível menor (RECORD_KEEP_LEVEL) já mantém a fala viva — respirar ou "é…" não
// cortam a frase. Nada de voz em 7 s → descarta (não gasta transcrição); 25 s → envia o que tiver. Sem medidor, só o toque
// ou o limite param.
export const RECORD_SILENCE_MS = 2000; // padrão ("normal")
export const HENRY_END_WAIT_EVENT = "mm-henry-end-wait"; // tela de configuração → Henry da página (detail.ms)
export const RECORD_REPLY_SILENCE_MS = 1200; // resposta curta com pergunta aberta
export const RECORD_REPLY_VOICE_MS = 1500; // "curta" = até 1,5 s de voz
export const RECORD_SILENCE_MIN_MS = 800;
export const RECORD_SILENCE_MAX_MS = 5000;
export const RECORD_NO_SPEECH_MS = 7000;
export const RECORD_MAX_MS = 25000;
export const RECORD_MIN_MS = 400;
export const RECORD_VOICE_LEVEL = 0.1; // nível do medidor (0–1) que conta como início de voz
export const RECORD_KEEP_LEVEL = 0.05; // depois de ouvir voz, nível que ainda mantém a fala viva (histerese)
export const RECORD_CONTINUE_NO_SPEECH_MS = 3500; // continuação depois de um corte: espera menos para começar

export function recordVoiceThreshold(heardVoice = false) {
  return heardVoice ? RECORD_KEEP_LEVEL : RECORD_VOICE_LEVEL;
}

// Silêncio necessário para fechar. waitMs = o escolhido na tela; voiceMs = quanto de voz já houve nesta gravação.
export function endOfSpeechWaitMs({ waitMs = RECORD_SILENCE_MS, awaitingReply = false, voiceMs = 0 } = {}) {
  const base = Math.min(RECORD_SILENCE_MAX_MS, Math.max(RECORD_SILENCE_MIN_MS, Number(waitMs) || RECORD_SILENCE_MS));
  if (awaitingReply && voiceMs <= RECORD_REPLY_VOICE_MS) return Math.min(base, RECORD_REPLY_SILENCE_MS);
  return base;
}

export function recordingDecision({
  startedAt = 0,
  firstVoiceAt = 0,
  lastVoiceAt = 0,
  heardVoice = false,
  hasMeter = true,
  now = Date.now(),
  waitMs = RECORD_SILENCE_MS,
  awaitingReply = false,
  vadRunning = false,
  vadSpeaking = false,
  vadEndedAt = 0,
  noSpeechMs = RECORD_NO_SPEECH_MS,
  hold = false
} = {}) {
  const elapsed = now - startedAt;
  if (elapsed >= RECORD_MAX_MS) return heardVoice || !hasMeter ? "send" : "discard";
  // Aperte para falar (dono, 2026-10-24): com a tecla/botão apertado quem fecha é soltar — sem corte por silêncio.
  if (hold) return null;
  if (!hasMeter) return null;
  if (!heardVoice) return elapsed >= noSpeechMs ? "discard" : null;
  if (vadRunning && vadSpeaking) return null; // o VAD ainda ouve voz: a fala não acabou
  const lastSound = Math.max(Number(lastVoiceAt) || 0, vadRunning ? Number(vadEndedAt) || 0 : 0);
  const wait = endOfSpeechWaitMs({ waitMs, awaitingReply, voiceMs: Math.max(0, lastVoiceAt - (firstVoiceAt || lastVoiceAt)) });
  return now - lastSound >= wait ? "send" : null;
}

// Depois de um corte AUTOMÁTICO por silêncio, transcrição vazia ou com cara de frase cortada ("quantos", "e os leads de")
// nunca vira "Não entendi": ele continua ouvindo e junta o trecho seguinte — no máximo uma vez (continued). Resposta
// curta válida com pergunta aberta, parada, saudação/relatório e frase com 2+ palavras que não termina pendurada seguem.
const HANGING_WORDS = new Set([
  "e", "de", "do", "da", "dos", "das", "que", "pra", "pro", "para", "com", "o", "a", "os", "as", "um", "uma", "no", "na", "nos",
  "nas", "em", "quanto", "quantos", "quantas", "qual", "quais", "como", "mas", "ou", "se", "porque", "sobre", "me", "meu",
  "minha", "quem", "onde", "quando", "tipo", "assim", "entao", "eh", "ah", "hum", "humm"
]);

export function shouldContinueAfterCut(text, { autoCut = false, continued = false, awaitingReply = false } = {}) {
  if (!autoCut || continued) return false;
  const value = normalizeSpeechText(text);
  if (!value) return true;
  if (isStopCommand(text) || isConversationEnd(text)) return false;
  if (awaitingReply && isShortReply(text)) return false;
  const intent = classifyTapUtterance(text);
  if (intent.kind === "report") return false;
  if (intent.kind === "wake") return true; // só o nome: o pedido vem a seguir
  const words = normalizeSpeechText(intent.question || value).split(" ").filter(Boolean);
  if (!words.length) return true;
  return words.length <= 1 || HANGING_WORDS.has(words[words.length - 1]);
}

export function joinCutTranscripts(prefix = "", text = "") {
  return [prefix, text].map((part) => String(part || "").trim()).filter(Boolean).join(" ").slice(0, 600);
}

// Web Speech (iPhone/Chrome): o parcial que não recebe nada novo vira final depois do MESMO tempo de silêncio (com pergunta
// aberta, o curto). Sem medidor aqui: a resposta curta vale pela pergunta aberta.
export function interimFinalWaitMs({ waitMs = RECORD_SILENCE_MS, awaitingReply = false } = {}) {
  return endOfSpeechWaitMs({ waitMs, awaitingReply, voiceMs: 0 });
}

// Texto transcrito → o que fazer. O toque já é o chamado: a pergunta vai direto, sem o nome. Saudação sozinha ("bom dia")
// ou "bom dia, Henry" → relatório do dia; só o nome → espera a pergunta; com o nome na frente, tira o nome.
export function classifyTapUtterance(text) {
  const value = String(text || "").trim();
  if (!normalizeSpeechText(value)) return { kind: "empty", question: "" };
  const detected = detectWakeWord(value);
  if (detected.called) {
    if (detected.kind === "report") return { kind: "report", question: "" };
    if (detected.kind === "wake") return { kind: "wake", question: "" };
    return { kind: "question", question: detected.question };
  }
  if (isGreetingOnly(value)) return { kind: "report", question: "" };
  return { kind: "question", question: value.slice(0, 500) };
}

// --- Rede de segurança do reconhecimento do navegador (dono, 2026-10-22: "trava quando paro de falar") -----------------
// O webkitSpeechRecognition (iPhone e às vezes o Chrome) entrega o resultado parcial e o `isFinal` nunca chega. Regra: se
// há um parcial e nenhum resultado novo por INTERIM_FINAL_MS, o último parcial vira a frase final (uma vez). O final
// atrasado do mesmo trecho é ignorado; se o navegador acumular o texto no mesmo resultado (iPhone), só o que vier DEPOIS
// do trecho já usado conta. Estado puro: { index, text, full, at, consumed: { index, text } }.
export const INTERIM_FINAL_MS = 1200;

// named = algum parcial deste trecho trouxe o nome (variação forte, em qualquer posição). O Chrome às vezes corta o "Henry"
// da frase FINAL (principalmente logo depois de reiniciar): o parcial "arma" o trecho e a final vale como dirigida a ele.
export function emptyInterimState() {
  return { index: -1, text: "", full: "", at: 0, named: false, namedIndex: -1, consumed: { index: -1, text: "" } };
}

export function mentionsHenry(text) {
  return normalizeSpeechText(text).split(" ").some((word) => WAKE_WORDS_STRONG.includes(word));
}

// Tira do começo do texto o trecho já usado (mesmo resultado do reconhecedor), comparando palavra por palavra.
function remainderAfter(consumed, index, text) {
  const value = String(text || "").trim();
  if (!consumed?.text || index !== consumed.index) return value;
  const used = normalizeSpeechText(consumed.text).split(" ").filter(Boolean);
  const words = value.split(/\s+/).filter(Boolean);
  const normalized = words.map((word) => normalizeSpeechText(word));
  const flat = normalized.filter(Boolean);
  if (flat.length < used.length || used.some((word, position) => flat[position] !== word)) return value;
  let skipped = 0;
  let position = 0;
  while (position < words.length && skipped < used.length) {
    if (normalized[position]) skipped += 1;
    position += 1;
  }
  return words.slice(position).join(" ").replace(/^[\s,.;:!?-]+/, "").trim();
}

// Resultado parcial chegou: guarda o que ainda não foi usado e a hora.
export function trackInterim(state, { index = 0, text = "", now = Date.now() } = {}) {
  const current = state || emptyInterimState();
  const rest = remainderAfter(current.consumed, index, text);
  const named = (current.namedIndex === index && current.named) || mentionsHenry(rest);
  return { ...current, index, text: rest, full: String(text || "").trim(), at: rest ? now : 0, named, namedIndex: index };
}

// Final de verdade chegou: devolve o que falta usar ("" = final atrasado de um trecho já usado → ignorar).
// named = o parcial deste mesmo trecho trouxe o nome (a final pode ter vindo sem ele).
export function takeFinalResult(state, { index = 0, text = "" } = {}) {
  const current = state || emptyInterimState();
  const rest = remainderAfter(current.consumed, index, text);
  const named = Boolean(rest) && current.namedIndex === index && current.named;
  return { text: rest, named, state: { ...emptyInterimState(), consumed: { index, text: String(text || "").trim() } } };
}

export function isInterimDue(state, now = Date.now(), waitMs = INTERIM_FINAL_MS) {
  return Boolean(state?.text) && now - Number(state.at || 0) >= waitMs;
}

// Silêncio passou do prazo: o parcial vira final (uma vez) e o trecho fica marcado como usado.
export function forceInterimFinal(state, now = Date.now(), waitMs = INTERIM_FINAL_MS) {
  const current = state || emptyInterimState();
  if (!isInterimDue(current, now, waitMs)) return { text: "", named: false, state: current };
  return { text: current.text, named: current.named, state: { ...emptyInterimState(), consumed: { index: current.index, text: current.full } } };
}

// --- Tela cheia aberta = já está chamando o Henry (dono, 2026-10-22) ----------------------------------------------------
// Com a tela cheia aberta, toda frase final que não seja ruído, eco da fala dele nem palavra de parada vira pedido, sem o
// nome (computador e celular): saudação sozinha → relatório; o resto → pergunta (mesma regra do tocar para falar).
export function classifyOpenSceneUtterance(text, spoken = []) {
  if (!acceptFollowUp(text, spoken)) return { kind: "ignore", question: "" };
  return classifyTapUtterance(text);
}

// Frase final de um trecho "armado" pelo parcial (o nome apareceu no parcial e sumiu da final): vira pedido como se o nome
// tivesse vindo. Saudação sozinha → relatório; ruído, eco da fala dele ou parada → nada.
export function classifyArmedUtterance(text, spoken = []) {
  const detected = detectWakeWord(text);
  if (detected.called) return detected.kind === "report" ? { kind: "report", question: "" } : detected.kind === "question" ? { kind: "question", question: detected.question } : { kind: "wake", question: "" };
  if (isGreetingOnly(text)) return { kind: "report", question: "" };
  if (!acceptFollowUp(text, spoken)) return { kind: "", question: "" };
  return { kind: "question", question: String(text || "").trim() };
}

// --- Música tocando (dono, 2026-10-23: "o Henry fica respondendo as músicas que estão tocando") ---------------------------
// O Spotify toca FORA da página (app do PC/celular): o cancelamento de eco do navegador não tem a referência desse som e a
// letra chega como fala. Enquanto a música toca (player `is_playing` ou marcador local logo depois de um play do Henry):
//   (a) não há conversa sem o nome — só acorda com o NOME no COMEÇO da frase (nunca no meio da letra), também na tela cheia;
//   (b) falando/pensando, só comandos fortes interrompem (nome no começo, "para", "espera", "pausa"), nunca frase comum;
//   (c) resultado longo e contínuo sem o nome (cara de letra) é ignorado — inclusive depois do toque/atalho/onWake do app.
export const MUSIC_LOCAL_MARK_MS = 45000; // depois de um play do Henry, vale como "tocando" até o player confirmar
export const MUSIC_LYRIC_WORDS = 16; // frase sem o nome com 16+ palavras seguidas = letra
export const MUSIC_DUCK_SAFETY_MS = 30000; // volume baixo no máximo ~30 s sem atividade (depois volta sozinho)

export function isMusicGuardActive({ playerPlaying = false, playedAt = 0, now = Date.now(), markMs = MUSIC_LOCAL_MARK_MS } = {}) {
  return playerPlaying === true || (Number(playedAt) > 0 && now - Number(playedAt) < markMs);
}

export function looksLikeLyrics(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (tokens.length < MUSIC_LYRIC_WORDS) return false;
  return !detectWakeWord(text).called || Boolean(detectWakeWord(text).anywhere);
}

// --- Pergunta aberta do Henry (dono, 2026-10-23: "pulei a faixa, ele perguntou se podia dar play e não entendeu o 'pode'") --
// Quando ELE acabou de perguntar (bom dia/música, "Qual vibe?", aniversário, chamado do aviso, qualquer resposta terminada
// em "?"), a resposta curta do dono vale SEM o nome por HENRY_REPLY_WINDOW_MS depois que ele termina de falar — também com
// a música tocando. Curta = até HENRY_SHORT_REPLY_WORDS palavras, ou começa por uma resposta esperada ("pode ser…",
// "rock…"); letra longa (looksLikeLyrics) continua ignorada. Estado puro: { active, kind, askedAt, endedAt, retried }.
export const HENRY_REPLY_WINDOW_MS = 12000;
export const HENRY_REPLY_MAX_WAIT_MS = 60000; // fala que nunca "terminou" (aba suspensa) não deixa a janela aberta para sempre
export const HENRY_SHORT_REPLY_WORDS = 6;
const EXPECTED_REPLIES = [
  "pode", "pode ser", "pode falar", "pode mandar", "sim", "claro", "bora", "manda", "manda ver", "quero", "beleza", "ok", "isso",
  "vai", "partiu", "fechou", "toca", "da o play", "play", "fala", "oi", "diga", "rock", "sertanejo", "raiz", "tanto faz",
  "nao", "agora nao", "hoje nao", "depois", "deixa", "sem musica", "prepara", "uhum", "aham"
];
export const HENRY_REPEAT_QUESTIONS = Object.freeze({
  music: "Posso dar play?",
  style: "Rock ou sertanejo?",
  music_confirm: "É essa?",
  birthday: "Preparo a mensagem?",
  birthday_alert: "Posso fazer isso?",
  question: "Não peguei. Pode repetir?"
});

export function henryAsksQuestion(reply) {
  return /\?["'”’)\s]*$/.test(String(reply || "").trim());
}

// kind = passo do bom dia ("music" | "style" | "music_confirm" | "birthday"), "alert" (chamado do aviso) ou "question" (pergunta comum).
export function openPendingReply(kind = "question", now = Date.now()) {
  return { active: true, kind, askedAt: now, endedAt: 0, retried: false };
}

export function isAwaitingReply(pending, now = Date.now(), windowMs = HENRY_REPLY_WINDOW_MS) {
  if (!pending?.active) return false;
  if (!pending.endedAt) return now - Number(pending.askedAt || 0) < HENRY_REPLY_MAX_WAIT_MS;
  return now - Number(pending.endedAt) < windowMs;
}

export function isShortReply(text) {
  const value = normalizeSpeechText(text).replace(new RegExp(`\\b${WAKE_STRONG_PATTERN}\\b`, "g"), " ").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const tokens = value.split(" ");
  if (tokens.length <= HENRY_SHORT_REPLY_WORDS) return true;
  return tokens.length < MUSIC_LYRIC_WORDS && EXPECTED_REPLIES.some((item) => ` ${value} `.startsWith(` ${item} `));
}

// Repetição curta da pergunta (uma vez) quando a resposta veio vazia ou foi descartada. "" = não repete (aviso: o próprio
// fluxo do aviso chama de novo).
export function repeatQuestionFor(pending) {
  if (!pending?.active || pending.retried || pending.kind === "alert") return "";
  return HENRY_REPEAT_QUESTIONS[pending.kind] || HENRY_REPEAT_QUESTIONS.question;
}

export function isHenryRepeatQuestion(text) {
  return Object.values(HENRY_REPEAT_QUESTIONS).includes(text);
}

// Frase final ouvida com a música tocando (Henry calado). explicit = o dono já chamou (toque, atalho, nome no app):
// aceita a frase, menos a que tem cara de letra. awaitingReply = ele acabou de perguntar (isAwaitingReply): a resposta
// CURTA vale sem o nome (reply: true). Sem o chamado nem pergunta aberta: só com o nome no começo.
export function musicListenGate(text, { explicit = false, awaitingReply = false } = {}) {
  const value = String(text || "").trim();
  if (!normalizeSpeechText(value)) return { accept: false, reason: "empty" };
  const wake = detectWakeWord(value);
  if (wake.called && !wake.anywhere) return { accept: true, named: true, wake };
  if (explicit && !looksLikeLyrics(value)) return { accept: true, named: false };
  if (awaitingReply && isShortReply(value) && !looksLikeLyrics(value)) return { accept: true, named: false, reply: true };
  return { accept: false, reason: looksLikeLyrics(value) ? "lyrics" : "no_name" };
}

const MUSIC_PAUSE = new Set(["pausa", "pause", "pausar", "pausa a musica", "pausa o som", "pausa ai", "pausa isso"]);
export function isMusicPauseCommand(text) {
  const value = normalizeSpeechText(text).replace(new RegExp(`^(?:ei |fala |oi |ola )?${WAKE_STRONG_PATTERN}\\s+`), "").trim();
  return MUSIC_PAUSE.has(value) || /^(para|pare) a musica$/.test(value);
}

// Interrupção com a música tocando: nome no começo, parada curta ("para", "espera") ou "pausa" (que também pausa a música).
export function detectMusicBargeIn(text) {
  const wake = detectWakeWord(text);
  if (wake.called && !wake.anywhere) return { interrupt: true, kind: wake.kind, question: wake.question };
  if (isMusicPauseCommand(text)) return { interrupt: true, kind: "question", question: "pausa a música" };
  if (isStopCommand(text)) return { interrupt: true, kind: "stop", question: "" };
  return { interrupt: false, kind: "", question: "" };
}

// --- Gravação aberta pelo próprio Henry (dono, 2026-10-23: "quando eu falo ele até faz o gesto de que está ouvindo, mas
// não começa a falar depois que eu paro"; "ele me faz uma pergunta, eu respondo e ele não fala mais nada") -----------------
// Toda gravação do tocar para falar / atalho / nome no app / depois de uma pergunta dele foi aberta pelo Henry: a
// transcrição NÃO vazia SEMPRE vira pedido. Só se descarta o eco evidente (frase quase igual à que ele acabou de falar).
// A guarda da música e da "letra" vale só para a escuta contínua sem gatilho (Chrome), nunca aqui.
export const EVIDENT_ECHO_MIN_WORDS = 3;
export const EVIDENT_ECHO_OVERLAP = 0.8;

// Eco evidente: 3+ palavras e 80%+ delas na frase dele, ou a frase dele inteira repetida. Resposta curta ("sim", "pode",
// "oi") NUNCA é eco (looksLikeEcho compara texto por dentro: "sim" está em "assim").
export function isEvidentEcho(text, spoken = []) {
  const heard = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!heard.length) return false;
  return (Array.isArray(spoken) ? spoken : [spoken]).some((item) => {
    const reply = normalizeSpeechText(item).split(" ").filter(Boolean);
    if (!reply.length) return false;
    if (heard.length >= 2 && heard.join(" ") === reply.join(" ")) return true;
    if (heard.length < EVIDENT_ECHO_MIN_WORDS) return false;
    const words = new Set(reply);
    return heard.filter((word) => words.has(word)).length / heard.length >= EVIDENT_ECHO_OVERLAP;
  });
}

// Texto da gravação → { kind: "report" | "question" | "wake" | "ignore", question, reason }. reason (só para o console de
// diagnóstico, nunca o texto): "empty" | "echo". "wake" = só o nome: a tela continua ouvindo uma vez; de novo só o nome,
// vira pergunta ("Henry?" → ele responde).
export function triggeredTranscriptIntent(text, { spoken = [], continued = false } = {}) {
  const value = String(text || "").trim();
  if (!normalizeSpeechText(value)) return { kind: "ignore", question: "", reason: "empty" };
  if (isEvidentEcho(value, spoken)) return { kind: "ignore", question: "", reason: "echo" };
  const intent = classifyTapUtterance(value);
  if (intent.kind === "wake" && continued) return { kind: "question", question: value.slice(0, 500), reason: "" };
  return { ...intent, reason: "" };
}

// Início da voz na gravação: o fim da fala dele (alto-falante com atraso, eco da sala) não pode contar como o dono
// falando. Nos primeiros RECORD_START_GRACE_MS o medidor só mede o ruído de fundo (floor); depois, voz = acima do limiar
// E do ruído de fundo (música baixa, ventilador) por RECORD_VOICE_CONFIRM_TICKS leituras seguidas (~200 ms).
export const RECORD_START_GRACE_MS = 350;
export const RECORD_VOICE_CONFIRM_TICKS = 2;
export const RECORD_FLOOR_FACTOR = 2.2; // voz = 2,2× o ruído de fundo (no mínimo o limiar fixo)
export const RECORD_FLOOR_KEEP_FACTOR = 1.6;

// Ruído de fundo medido nos primeiros RECORD_START_GRACE_MS: o MENOR nível lido, não a média. Gravação aberta pelo nome
// ("Henry, quantos clientes...") já começa com o dono falando; a média embutia a voz dele no "ruído" e o limiar subia
// (2,2× até o teto de 0,6) — a voz normal deixava de contar como voz. Música/ventilador são estáveis: o mínimo ≈ a média.
export function nextNoiseFloor(floor = 0, reads = 0, level = 0) {
  const value = Math.max(0, Number(level) || 0);
  return reads > 0 ? Math.min(Math.max(0, Number(floor) || 0), value) : value;
}

// Microfone "quente" do app de desktop: a gravação do pedido clona a trilha que já está aberta (sem reabrir o dispositivo,
// que custava centenas de ms depois do nome e cortava o começo da frase). Só serve com trilha de áudio ao vivo.
export function isWarmStreamUsable(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  return list.length > 0 && list.every((track) => track && track.kind !== "video" && track.readyState === "live");
}

export function recordLevelThreshold({ heardVoice = false, floor = 0 } = {}) {
  const base = recordVoiceThreshold(heardVoice);
  const noise = Math.max(0, Number(floor) || 0);
  return Math.min(0.6, Math.max(base, noise * (heardVoice ? RECORD_FLOOR_KEEP_FACTOR : RECORD_FLOOR_FACTOR)));
}

// --- Fala espontânea nunca corta nada (dono, 2026-10-23: "do nada ele corta e começa a falar outra coisa") -------------
// Chamado do aviso ("Ô, patrão?"), oferta do aviso pendente, repetição da pergunta, "Pronto, tá tocando!" que chega
// depois: entram numa fila e só tocam com o Henry OCIOSO há SPONTANEOUS_IDLE_MS — sem fala tocando, sem pedido em
// andamento, sem gravação aberta, sem esperar a resposta de uma pergunta dele e sem o dono falando perto.
export const SPONTANEOUS_IDLE_MS = 3000;
export const SPONTANEOUS_MAX_AGE_MS = 10 * 60 * 1000;

export function canSpeakSpontaneously({ phase = "idle", recording = false, playing = false, awaitingReply = false, morningSession = false, busyAt = 0, heardAt = 0, now = Date.now(), idleMs = SPONTANEOUS_IDLE_MS } = {}) {
  if (phase === "speaking" || phase === "thinking" || recording || playing || awaitingReply || morningSession) return false;
  return now - Math.max(Number(busyAt) || 0, Number(heardAt) || 0) >= idleMs;
}

// --- Bom dia sem avisos (REGRA OFICIAL — dono, 2026-10-26) ---------------------------------------------------------------
// "Ele não pode me avisar sobre os avisos se eu dei play no bom dia, para ele fazer apenas a cena do bom dia." Do play (ou
// do "bom dia, Henry") até o fim da cena (abertura, pergunta da música e resposta, relatório, "enquanto você estava fora",
// pergunta do aniversário do bom dia) nenhum aviso espontâneo toca: chamado do aviso, oferta do aviso guardado, cliente
// novo/transferido, chegada da equipe, avisos da Central por voz. Ficam na fila e saem depois, pela regra normal
// (canSpeakSpontaneously); com a tela cheia aberta, só depois que ela fechar ou MORNING_SESSION_BREATH_MS depois do fim.
// A repetição da pergunta da música e o "tá tocando" fazem parte do bom dia: não são barrados.
export const MORNING_SESSION_BREATH_MS = 60 * 1000;
export const MORNING_SESSION_MAX_MS = 6 * 60 * 1000; // trava de segurança: sessão esquecida nunca cala os avisos o dia todo
export const MORNING_BLOCKED_SPONTANEOUS = Object.freeze(["aviso"]);

export function morningSessionStart(now = Date.now()) {
  return { active: true, startedAt: now, endedAt: 0, finishing: false };
}
// Última resposta do bom dia (sem próximo passo): termina quando ele parar de falar (morningSessionEnd).
export function morningSessionFinishing(session) {
  return session?.active ? { ...session, finishing: true } : session || null;
}
export function morningSessionEnd(session, now = Date.now()) {
  if (!session?.active) return session || null;
  return { ...session, active: false, finishing: false, endedAt: now };
}
// A sessão ainda segura os avisos? fullscreen = tela cheia do Henry aberta agora.
export function morningSessionHolds(session, { now = Date.now(), fullscreen = false } = {}) {
  if (!session) return false;
  if (session.active) return now - (Number(session.startedAt) || 0) < MORNING_SESSION_MAX_MS;
  const endedAt = Number(session.endedAt) || 0;
  if (!endedAt) return false;
  return Boolean(fullscreen) && now - endedAt < MORNING_SESSION_BREATH_MS;
}
export function isMorningBlockedSpontaneous(kind) {
  return MORNING_BLOCKED_SPONTANEOUS.includes(kind);
}
// Próximo item da fila espontânea: com o bom dia segurando, pula os avisos (ficam na fila) e deixa passar o resto.
export function nextSpontaneousItem(queue = [], { morningHold = false } = {}) {
  return (queue || []).find((item) => item && !(morningHold && isMorningBlockedSpontaneous(item.kind))) || null;
}

// --- Tempos de cada etapa (dono, 2026-10-23: "na verdade ele demora muito para responder") ---------------------------
// Marcas do pedido (ms desde a época) → etapas em ms. Só números: nada do texto nem do áudio.
export function henryLatencyBreakdown(marks = {}) {
  const at = (key) => (Number.isFinite(marks[key]) && marks[key] > 0 ? marks[key] : 0);
  const span = (from, to) => (at(from) && at(to) && at(to) >= at(from) ? at(to) - at(from) : null);
  return {
    upload_stt: span("speechEnd", "transcribed"),
    stt_server: Number.isFinite(marks.sttMs) ? marks.sttMs : null,
    ...(["live", "fallback", "record"].includes(marks.sttMode) ? { stt_modo: marks.sttMode } : {}), // ao vivo / reserva / gravação
    ate_resposta: span(at("transcribed") ? "transcribed" : "asked", "reply"),
    ate_1o_audio: span(at("transcribed") ? "transcribed" : "asked", "firstAudio"),
    ate_falar: span(at("speechEnd") ? "speechEnd" : "asked", "playing"),
    servidor: marks.server && typeof marks.server === "object" ? marks.server : null
  };
}

// --- Aperte para falar e Mudo (REGRA OFICIAL — dono, 2026-10-24) --------------------------------------------------------
// "Quero um atalho para apertar: eu falo enquanto aperto, quando eu solto ele escuta, entende e responde. Pode ser a tecla
// Enter também. E um botão para deixar ele mudo." Segurar Enter (fora de campo de texto/botão do CRM), Ctrl+Shift+H ou o
// botão do microfone (toque longo) começa a ouvir NA HORA; soltar = fim da fala (mesma gravação/reconhecimento de sempre).
// Soltar antes de HENRY_PTT_TAP_MS = clique normal (comportamento de antes). Regras só aqui.
export const HENRY_PTT_TAP_MS = 300;
export const HENRY_PTT_RELEASE_GRACE_MS = 500; // reconhecimento do Chrome: espera as últimas palavras chegarem
export const HENRY_VOICE_MUTE_KEY = "mm_henry_voice_muted";

const PTT_TEXT_TAGS = new Set(["textarea", "select"]);
const PTT_TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "listbox", "option", "menu", "menuitem", "grid", "gridcell", "tree", "treeitem"]);
const PTT_CONTROL_TAGS = new Set(["button", "a", "summary", "label", "option", "details", "video", "audio"]);
const PTT_CONTROL_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitemcheckbox", "menuitemradio"]);
const PTT_NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);

function attrOf(node, name) {
  if (!node) return null;
  if (typeof node.getAttribute === "function") return node.getAttribute(name);
  return node.attributes?.[name] ?? null;
}

// Onde o Enter caiu: "text" (campo de digitação — nunca), "control" (botão/link/caixa do CRM — o Enter é dele) ou "free"
// (página sem foco num controle). Botão DENTRO do Henry (data-henry-assistant) conta como livre: é o próprio Henry.
export function pushToTalkTargetKind(target) {
  let node = target;
  let kind = "free";
  let inHenry = false;
  for (let depth = 0; node && depth < 25; depth += 1) {
    const tag = String(node.tagName || "").toLowerCase();
    const role = String(attrOf(node, "role") || "").toLowerCase();
    const editable = node.isContentEditable === true || ["", "true", "plaintext-only"].includes(attrOf(node, "contenteditable"));
    if (kind === "free") {
      if (editable || PTT_TEXT_TAGS.has(tag) || PTT_TEXT_ROLES.has(role)) return "text";
      if (tag === "input") {
        const type = String(node.type || attrOf(node, "type") || "text").toLowerCase();
        if (!PTT_NON_TEXT_INPUTS.has(type)) return "text";
        kind = "control";
      } else if (PTT_CONTROL_TAGS.has(tag) || PTT_CONTROL_ROLES.has(role)) {
        kind = "control";
      }
    }
    if (attrOf(node, "data-henry-assistant") != null) inHenry = true;
    node = node.parentElement || null;
  }
  return kind === "control" && inHenry ? "free" : kind;
}

function isHKey({ key = "", code = "" } = {}) {
  return code === "KeyH" || key === "h" || key === "H";
}

// Tecla apertada → qual aperte-para-falar começa ("enter" | "shortcut") ou null. henryActive = Henry ligado nesta página;
// locked = tela de bloqueio do Henry (aí nada); expanded = tela cheia aberta (Enter vale até com botão do CRM focado). Enter: sem modificador, fora de composição (acentos) e fora de campo de
// texto/controle do CRM; Ctrl+Shift+H vale em qualquer lugar (não é digitação).
// Atalho de fala do dono (2026-10-25, lib/henry-ptt-shortcut-core.mjs): shortcut = o atalho salvo; held = peças seguradas
// agora (com a tecla desta chamada). Bateu exatamente → "custom", em qualquer parte do CRM (a gravação já recusou o que
// atrapalha a digitação: letra sem modificador, Shift+letra, Ctrl+C/V/X/A/Z...).
export function pushToTalkKeyAction({ key = "", code = "", ctrlKey = false, shiftKey = false, altKey = false, metaKey = false, isComposing = false, target = null, henryActive = false, locked = false, expanded = false, shortcut = "", held = null } = {}) {
  if (!henryActive || locked || isComposing) return null;
  if (shortcut && held && matchesPttShortcut(shortcut, held)) return "custom";
  if ((ctrlKey || metaKey) && shiftKey && !altKey && isHKey({ key, code })) return "shortcut";
  if (key === "Enter" && !ctrlKey && !shiftKey && !altKey && !metaKey) {
    // Tela cheia do Henry aberta (dono, 2026-10-24: "quando ele estiver aberto, eu aperto Enter e mantenho segurado, como
    // gravar um áudio no WhatsApp"): o CRM está coberto, então botão/link focado por trás não segura o Enter — só campo de
    // digitação continua de fora. Minimizado: só fora de campo de texto e de controle do CRM, como antes.
    const kind = pushToTalkTargetKind(target);
    if (kind === "text") return null;
    return kind === "free" || expanded ? "enter" : null;
  }
  return null;
}

// Tecla solta encerra o aperte-para-falar? Enter → só o Enter; atalho → soltar qualquer uma das três (Ctrl/Shift/H);
// atalho de fala do dono ("custom") → soltar qualquer uma das duas teclas dele.
export function isPushToTalkRelease(source, { key = "", code = "" } = {}, shortcut = "") {
  if (source === "custom") return isPttShortcutKey(shortcut, code);
  if (source === "enter") return key === "Enter";
  if (source === "shortcut") return ["Control", "Shift", "Meta"].includes(key) || isHKey({ key, code });
  return false;
}

// Soltou: antes de HENRY_PTT_TAP_MS = clique normal ("tap": segue ouvindo com o fim da fala automático, como antes);
// depois = fim da fala ("send": transcreve e responde já).
export function pushToTalkReleaseAction({ heldMs = 0, tapMs = HENRY_PTT_TAP_MS } = {}) {
  return Number(heldMs) < tapMs ? "tap" : "send";
}

// --- Aperte para falar: começo imediato (REGRA OFICIAL — dono, 2026-10-30) ------------------------------------------------
// "Ele apresenta esse erro [só entende o final da frase] mesmo quando estou segurando o botão ENTER para falar. Quando eu
// seguro o Enter ele deveria entender a partir do momento em que eu apertei e segurei, sem precisar do nome dele ou de
// algum delay." A gravação nasce no MESMO instante do keydown (microfone já aberto — shouldWarmMic —, trilha clonada); nada
// de palavra de chamada, de Vosk nem de calibração de ruído (com a tecla apertada o fim da fala é só o keyup); soltar espera
// uma cauda curta (HENRY_PTT_TAIL_MS) para não cortar a última sílaba. Auto-repeat do Enter nunca reinicia nada.
export const HENRY_PTT_TAIL_MS = 250;
export const HENRY_LIVE_MAX_LATE_START_MS = 250; // transcrição ao vivo que começou depois disto perde o começo: usa a gravação

// keydown: "press" (tecla nova), "held" (já segurando: a repetição não faz nada) ou "ignore" (repetição solta/já tratada).
export function pttKeydownPhase({ active = false, repeat = false, defaultPrevented = false } = {}) {
  if (active) return "held";
  if (repeat || defaultPrevented) return "ignore";
  return "press";
}

// Microfone aberto e PARADO (nada é lido nem gravado dali) para a gravação do aperto clonar a trilha sem reabrir o
// dispositivo. Só no app de desktop do dono, com a escuta ligada, em qualquer modo — com o nome (Vosk), sem o nome e em
// "Só quando eu apertar". Celular/navegador não: com o microfone aberto o iOS manda a voz do Henry para o alto-falante de ligação.
export function shouldWarmMic({ active = false, muted = false, recordMode = false, desktopApp = false } = {}) {
  return Boolean(active && !muted && recordMode && desktopApp);
}

// A transcrição ao vivo começou a receber áudio bem depois da gravação (contexto de áudio suspenso, conexão): o começo da
// frase só existe na gravação → ela é a transcrita. Sem hora do 1º áudio = não confiar.
export function liveStartedLate({ recorderStartedAt = 0, firstAudioAt = 0, maxLateMs = HENRY_LIVE_MAX_LATE_START_MS } = {}) {
  if (!(Number(firstAudioAt) > 0) || !(Number(recorderStartedAt) > 0)) return true;
  return Number(firstAudioAt) - Number(recorderStartedAt) > maxLateMs;
}

// Anel minimizado do celular (REGRA OFICIAL — dono, 2026-10-25: "No app do celular isso deve funcionar se eu segurar o
// ícone do Henry minimizado"). Segurar HENRY_PTT_TAP_MS = aperte-para-falar ("pointer", sem abrir a tela cheia); soltar
// depois disso = envia ("send"). Toque curto, ou aperto que não chegou a começar a ouvir (microfone desligado, tela
// bloqueada) = o toque de sempre, que abre a tela cheia ("open").
export function henryRingPressAction({ started = false, heldMs = 0, tapMs = HENRY_PTT_TAP_MS } = {}) {
  if (!started) return "open";
  return pushToTalkReleaseAction({ heldMs, tapMs }) === "send" ? "send" : "tap";
}

// O temporizador do toque longo pode começar a ouvir? Só com o dedo ainda no anel (arrastar = pointercancel). Folga de
// 50 ms para o atraso/arredondamento do setTimeout (o relógio pode marcar 299 ms no disparo de 300 ms).
export const HENRY_RING_TIMER_SLACK_MS = 50;
export function henryRingHoldReady({ pressed = false, heldMs = 0, tapMs = HENRY_PTT_TAP_MS } = {}) {
  return pressed === true && Number(heldMs) >= tapMs - HENRY_RING_TIMER_SLACK_MS;
}

// --- "Só quando eu apertar" (REGRA OFICIAL — dono, 2026-10-24) ---------------------------------------------------------
// "Quero a opção para ele conversar comigo só quando eu apertar Enter e não ficar escutando, porque isso está confundindo
// ele." Liga/desliga deste aparelho (nasce DESLIGADO). Ligado: nada de escuta contínua (reconhecimento do navegador só
// enquanto aperta), nada de palavra de chamada (nem o "Henry" offline do app de desktop), nada de microfone aberto sozinho
// (depois de pergunta dele, no chamado do aviso) e nada de interrupção por voz — só ouve enquanto Enter/Ctrl+Shift+H/
// microfone estiverem apertados (toque no microfone = gravação com fim da fala, gesto do dono). Pergunta dele (bom dia,
// aviso) espera o dono apertar para responder; os avisos continuam chamando por voz.
export const HENRY_PTT_ONLY_KEY = "mm_henry_ptt_only";
export const HENRY_PTT_ONLY_EVENT = "mm-henry-ptt-only";
export const HENRY_PTT_ONLY_REPLY_MS = 5 * 60 * 1000; // pergunta dele (passo do bom dia) espera o aperto por até 5 min

export function readHenryPttOnly(storage) {
  try {
    return storage?.getItem?.(HENRY_PTT_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

// O que pode ficar ouvindo sem o dono apertar. holding = Enter/atalho/microfone apertado agora.
export function henryListenPolicy({ pttOnly = false, holding = false } = {}) {
  if (!pttOnly) return { recognition: true, wakeWord: true, desktopWake: true, autoRecord: true, voiceBargeIn: true, micMeter: true };
  return { recognition: Boolean(holding), wakeWord: false, desktopWake: false, autoRecord: false, voiceBargeIn: false, micMeter: false };
}

// Janela da conversa: no "Só quando eu apertar", com um passo do bom dia pendente, a resposta espera o aperto (5 min).
export function conversationIdleMsFor({ pttOnly = false, pendingStep = "" } = {}) {
  return pttOnly && pendingStep ? HENRY_PTT_ONLY_REPLY_MS : CONVERSATION_IDLE_MS;
}

// Tudo o que foi dito entre apertar e soltar (dono, 2026-10-24: "quando eu solto para enviar, ele pega só a última coisa
// que eu falei"). Reconhecimento do navegador: cada resultado (sessão do reconhecedor, índice) guarda o ÚLTIMO texto
// dele — final ou parcial —, em ordem; o reconhecedor reiniciar no meio abre uma sessão nova sem perder as anteriores.
// Ao soltar, o texto é a junção de todos; os resultados atrasados desses mesmos trechos (o final que chega depois de
// soltar, às vezes com palavras diferentes do parcial) são ignorados — antes viravam um 2º pedido que substituía o 1º.
// fromIndex = 1º resultado ainda aberto na hora de apertar (o que já era final antes não entra).
export function startPttTranscript({ session = 0, fromIndex = 0 } = {}) {
  return { session: Number(session) || 0, fromIndex: Math.max(0, Number(fromIndex) || 0), segments: [] };
}

export function trackPttResult(state, { session = 0, index = 0, text = "", final = false } = {}) {
  const current = state || startPttTranscript();
  if (session < current.session || (session === current.session && index < current.fromIndex)) return current;
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const at = current.segments.findIndex((segment) => segment.session === session && segment.index === index);
  if (at >= 0) {
    const segment = current.segments[at];
    if (segment.final && !final) return current; // parcial velho depois do final: fica o final
    const segments = current.segments.slice();
    segments[at] = { session, index, text: value || segment.text, final: Boolean(final) };
    return { ...current, segments };
  }
  if (!value) return current;
  const segments = [...current.segments, { session, index, text: value, final: Boolean(final) }];
  segments.sort((a, b) => a.session - b.session || a.index - b.index);
  return { ...current, segments };
}

export function pttTranscriptText(state) {
  return (state?.segments || []).map((segment) => segment.text).filter(Boolean).join(" ").slice(0, 500);
}

// Depois de soltar: resultado da mesma sessão com índice até o último visto = atrasado de um trecho já enviado.
export function pttLateResultIgnored(ignore, { session = 0, index = 0 } = {}) {
  return Boolean(ignore) && session === ignore.session && index <= ignore.upTo;
}

// Mudo = a VOZ do Henry desligada (ele responde só na tela). Nenhuma fala, frase de espera, confirmação ou despedida toca.
export function henryVoicePlayable({ voiceMuted = false } = {}) {
  return !voiceMuted;
}

// Chamados/avisos falados esperam (ficam pendentes) com o microfone desligado (Alt+B) OU com o Henry no mudo.
export function henrySpeechSilenced({ micMuted = false, voiceMuted = false } = {}) {
  return Boolean(micMuted || voiceMuted);
}

export function readHenryVoiceMuted(storage) {
  try {
    return storage?.getItem?.(HENRY_VOICE_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

// --- Transcrição AO VIVO enquanto aperta (REGRA OFICIAL — dono, 2026-10-24) ---------------------------------------------
// "Ele pode já ir acompanhando a leitura, analisando o que eu falei, para não demorar esperar eu soltar para depois escutar
// e responder… porém ele só responde quando eu tirar o dedo do Enter." Só no aperte-para-falar com gravação (app de
// desktop, iPhone): o áudio vai ao Scribe Realtime da ElevenLabs enquanto aperta (token de uso único pedido ao servidor;
// a chave nunca sai de lá), a tela mostra "Ouvindo… <texto>" e, ao soltar, o texto já está pronto — o pedido ao modelo
// só sai aí, pelo caminho de sempre. Falhou (sem token, conexão caiu, erro do serviço, nada transcrito)? A gravação de
// sempre continua em paralelo e é transcrita ao soltar (caminho atual). Áudio nunca gravado nem logado.
export const HENRY_LIVE_COMMIT_WAIT_MS = 1200; // soltou: espera o texto fechado no máximo isto (depois usa o parcial)
export const HENRY_LIVE_CONNECT_WAIT_MS = 3000; // não abriu a conexão nisso: segue só com a gravação
export const HENRY_LIVE_MAX_MS = RECORD_MAX_MS; // 1 sessão por aperto, no máximo 25 s (o mesmo limite da gravação)
export const HENRY_LIVE_MAX_PENDING_CHUNKS = 120; // áudio guardado enquanto conecta (~30 s em pedaços de ~256 ms)
const LIVE_ERROR_TYPES = new Set([
  "error", "auth_error", "quota_exceeded", "commit_throttled", "unaccepted_terms", "rate_limited", "queue_overflow",
  "resource_exhausted", "session_time_limit_exceeded", "input_error", "invalid_request", "chunk_size_exceeded",
  "insufficient_audio_activity", "transcriber_error"
]);
const LIVE_TEXT_MAX = 500;

function liveClean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function emptyLiveTranscript() {
  return { started: false, committed: [], partial: "", commits: 0, failed: false, error: "" };
}

// Mensagem do WebSocket (já em objeto) → novo estado. Texto fechado entra na lista; parcial é só o trecho em aberto.
export function applyLiveTranscriptMessage(state = emptyLiveTranscript(), message = {}) {
  const type = String(message?.message_type || "");
  if (type === "session_started") return { ...state, started: true };
  if (type === "partial_transcript") return { ...state, partial: liveClean(message.text) };
  if (type === "committed_transcript" || type === "committed_transcript_with_timestamps") {
    const text = liveClean(message.text);
    // A mesma fala chega nas duas formas quando há carimbo de tempo: conta o fechamento uma vez só.
    if (type === "committed_transcript_with_timestamps" && state.lastCommitted === text) return state;
    return { ...state, committed: text ? [...state.committed, text] : state.committed, partial: "", commits: state.commits + 1, lastCommitted: text };
  }
  if (LIVE_ERROR_TYPES.has(type)) return { ...state, failed: true, error: type };
  return state;
}

// Texto até agora: trechos fechados + o parcial em aberto (no máximo 500 caracteres, como a transcrição de sempre).
export function liveTranscriptText(state = emptyLiveTranscript()) {
  return [...(state.committed || []), state.partial || ""].map(liveClean).filter(Boolean).join(" ").slice(0, LIVE_TEXT_MAX);
}

// Soltou o Enter/botão: "use" (texto ao vivo pronto), "wait" (esperando o fechamento) ou "fallback" (transcreve a
// gravação como antes). commitsAtRelease = fechamentos já recebidos ao soltar; waitedMs = desde o pedido de fechamento;
// audioSent = algum pedaço de áudio chegou a sair (iPhone com o som suspenso não captura: nem espera).
export function liveReleaseDecision({ state = emptyLiveTranscript(), commitsAtRelease = 0, waitedMs = 0, audioSent = true, commitWaitMs = HENRY_LIVE_COMMIT_WAIT_MS } = {}) {
  if (!state.started || state.failed || !audioSent) return "fallback";
  const text = liveTranscriptText(state);
  if (state.commits > commitsAtRelease) return text ? "use" : "fallback";
  if (waitedMs >= commitWaitMs) return text ? "use" : "fallback";
  return "wait";
}

// Legenda na tela enquanto aperta: o fim do que já foi entendido.
export function liveCaption(text, max = 90) {
  const value = liveClean(text);
  if (!value) return "Ouvindo…";
  return `Ouvindo… ${value.length > max ? `…${value.slice(-max).replace(/^\S*\s/, "")}` : value}`;
}

// Pré-classificação pelo texto parcial (sem modelo, nada falado): só prepara — narração, pré-aquecimento. A resposta
// continua sendo pedida só ao soltar.
export function liveIntentHint(text) {
  const value = liveClean(text);
  if (!value) return { topic: "", tools: false, greeting: false };
  const music = henryMusicIntent({ mode: "question", question: value });
  const greeting = isHenryGreeting(value);
  return { topic: music ? "music" : "geral", tools: !greeting && henryNeedsTools(value), greeting };
}

// Áudio do microfone (Float32, taxa do AudioContext) → PCM 16 bits na taxa pedida (média por janela; sem dependências).
export function downsampleToPcm16(samples, inputRate, outputRate = 16000) {
  const input = samples || [];
  const inRate = Number(inputRate) || outputRate;
  const ratio = inRate / outputRate;
  if (!(ratio >= 1)) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) out[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    return out;
  }
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    const value = end > start ? sum / (end - start) : 0;
    out[i] = Math.max(-1, Math.min(1, value)) * 0x7fff;
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// PCM 16 bits little-endian → base64 (o campo audio_base_64 do pedaço).
export function pcm16ToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}
