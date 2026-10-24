// Conversa natural com o Henry (pedido do dono, 2026-10-22: "quero que pareça com uma conversa: se ele estiver falando e
// eu falar o nome dele, ele para" — docs/BUSINESS_RULES.md HENRY-1, "Modo conversa"). Núcleo PURO, usado pelo navegador
// (components/henry/HenryVoiceAssistant.jsx), pelo servidor (fala em partes) e pelos testes. Nada aqui grava nada: a
// memória da conversa vive só na página e é zerada ao sair do modo conversa.
import { detectWakeWord, isGreetingOnly, looksLikeEcho, normalizeSpeechText, WAKE_STRONG_PATTERN, WAKE_WORDS_STRONG, HENRY_HISTORY_TURNS } from "./henry-voice-core.mjs";

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
export function henryBargeMode({ desktop = false, desktopApp = false, recordMode = false, mobileBargeIn = HENRY_MOBILE_BARGE_IN } = {}) {
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

export function canSpeakSpontaneously({ phase = "idle", recording = false, playing = false, awaitingReply = false, busyAt = 0, heardAt = 0, now = Date.now(), idleMs = SPONTANEOUS_IDLE_MS } = {}) {
  if (phase === "speaking" || phase === "thinking" || recording || playing || awaitingReply) return false;
  return now - Math.max(Number(busyAt) || 0, Number(heardAt) || 0) >= idleMs;
}

// --- Tempos de cada etapa (dono, 2026-10-23: "na verdade ele demora muito para responder") ---------------------------
// Marcas do pedido (ms desde a época) → etapas em ms. Só números: nada do texto nem do áudio.
export function henryLatencyBreakdown(marks = {}) {
  const at = (key) => (Number.isFinite(marks[key]) && marks[key] > 0 ? marks[key] : 0);
  const span = (from, to) => (at(from) && at(to) && at(to) >= at(from) ? at(to) - at(from) : null);
  return {
    upload_stt: span("speechEnd", "transcribed"),
    stt_server: Number.isFinite(marks.sttMs) ? marks.sttMs : null,
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
// locked = tela de bloqueio do Henry (aí nada). Enter: sem modificador, fora de composição (acentos) e fora de campo de
// texto/controle do CRM; Ctrl+Shift+H vale em qualquer lugar (não é digitação).
export function pushToTalkKeyAction({ key = "", code = "", ctrlKey = false, shiftKey = false, altKey = false, metaKey = false, isComposing = false, target = null, henryActive = false, locked = false } = {}) {
  if (!henryActive || locked || isComposing) return null;
  if ((ctrlKey || metaKey) && shiftKey && !altKey && isHKey({ key, code })) return "shortcut";
  if (key === "Enter" && !ctrlKey && !shiftKey && !altKey && !metaKey) return pushToTalkTargetKind(target) === "free" ? "enter" : null;
  return null;
}

// Tecla solta encerra o aperte-para-falar? Enter → só o Enter; atalho → soltar qualquer uma das três (Ctrl/Shift/H).
export function isPushToTalkRelease(source, { key = "", code = "" } = {}) {
  if (source === "enter") return key === "Enter";
  if (source === "shortcut") return ["Control", "Shift", "Meta"].includes(key) || isHKey({ key, code });
  return false;
}

// Soltou: antes de HENRY_PTT_TAP_MS = clique normal ("tap": segue ouvindo com o fim da fala automático, como antes);
// depois = fim da fala ("send": transcreve e responde já).
export function pushToTalkReleaseAction({ heldMs = 0, tapMs = HENRY_PTT_TAP_MS } = {}) {
  return Number(heldMs) < tapMs ? "tap" : "send";
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
