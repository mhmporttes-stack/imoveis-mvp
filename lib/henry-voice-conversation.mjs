// Conversa natural com o Henry (pedido do dono, 2026-10-22: "quero que pareça com uma conversa: se ele estiver falando e
// eu falar o nome dele, ele para" — docs/BUSINESS_RULES.md HENRY-1, "Modo conversa"). Núcleo PURO, usado pelo navegador
// (components/henry/HenryVoiceAssistant.jsx), pelo servidor (fala em partes) e pelos testes. Nada aqui grava nada: a
// memória da conversa vive só na página e é zerada ao sair do modo conversa.
import { detectWakeWord, isGreetingOnly, looksLikeEcho, normalizeSpeechText, WAKE_WORDS_STRONG, HENRY_HISTORY_TURNS } from "./henry-voice-core.mjs";

// Janela de conversa: depois de qualquer resposta, ~40 s em que frases sem o nome valem (computador e celular), com o
// filtro de eco e ruído (dono, 2026-10-22: "minimizado… interage como se estivesse escutando, mas não responde").
export const CONVERSATION_IDLE_MS = 40000;
export const CONVERSATION_EXCHANGES = HENRY_HISTORY_TURNS / 2; // trocas (pergunta + resposta) mandadas ao modelo

// --- Interrupção ("barge-in") -----------------------------------------------------------------------------------------
// Enquanto o Henry fala ou pensa, SÓ o nome e as palavras de parada valem (o resto é a própria voz dele ou conversa da sala).
const STOP_WORDS = new Set(["para", "pare", "parar", "espera", "espere", "pera", "perai", "chega", "silencio", "stop"]);
const STOP_FILLER = new Set(["ai", "ei", "ok", "por", "favor", "agora", "so", "um", "pouco", "pode", "ta", "bom", ...WAKE_WORDS_STRONG]);

export function isStopCommand(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  return tokens.some((word) => STOP_WORDS.has(word)) && tokens.every((word) => STOP_WORDS.has(word) || STOP_FILLER.has(word));
}

// currentSpeech = o que o Henry está falando agora (filtro de eco: "para" dentro da própria fala dele não interrompe).
// Devolve { interrupt, kind: "question" | "report" | "wake" | "stop" | "", question }.
// Enquanto o Henry fala, o reconhecimento do Chrome junta a voz dele com a do dono na MESMA frase ("…seu relatório
// henry para"), então o nome quase nunca vem no começo (dono, 2026-10-22: "não para de falar quando falo o nome dele").
// Por isso, além da regra estrita, olha as últimas BARGE_TAIL palavras: nome forte ou palavra de parada que NÃO está na
// fala atual do Henry interrompe; o que vier depois do nome vira a pergunta.
const BARGE_TAIL = 6;

export function detectBargeIn(text, currentSpeech = "") {
  const wake = detectWakeWord(text);
  // Nome no começo da frase. Nome no meio/fim (anywhere) segue a regra da cauda abaixo, que separa a voz dele da do dono.
  if (wake.called && !wake.anywhere) return { interrupt: true, kind: wake.kind, question: wake.question };
  if (isStopCommand(text) && !looksLikeEcho(text, currentSpeech)) return { interrupt: true, kind: "stop", question: "" };
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  const spoken = new Set(normalizeSpeechText(currentSpeech).split(" ").filter(Boolean));
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
export function henryCaptureMode({ desktop = false, hasRecognition = false, hasRecorder = false, recognitionFailed = false, iosStandalone = false } = {}) {
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

// Quando a gravação para sozinha: ~1,2 s de silêncio depois de ouvir voz → envia; nada de voz em 7 s → descarta (não
// gasta transcrição); 20 s → envia o que tiver. Sem medidor do microfone, só o toque ou o limite de 20 s param.
export const RECORD_SILENCE_MS = 1200;
export const RECORD_NO_SPEECH_MS = 7000;
export const RECORD_MAX_MS = 20000;
export const RECORD_MIN_MS = 400;
export const RECORD_VOICE_LEVEL = 0.1; // nível do medidor (0–1) que conta como voz

export function recordingDecision({ startedAt = 0, lastVoiceAt = 0, heardVoice = false, hasMeter = true, now = Date.now() } = {}) {
  const elapsed = now - startedAt;
  if (elapsed >= RECORD_MAX_MS) return heardVoice || !hasMeter ? "send" : "discard";
  if (!hasMeter) return null;
  if (heardVoice && now - lastVoiceAt >= RECORD_SILENCE_MS) return "send";
  if (!heardVoice && elapsed >= RECORD_NO_SPEECH_MS) return "discard";
  return null;
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
