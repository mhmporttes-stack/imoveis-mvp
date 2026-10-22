import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONVERSATION_IDLE_MS,
  INTERIM_FINAL_MS,
  RECORD_MAX_MS,
  RECORD_NO_SPEECH_MS,
  RECORD_SILENCE_MS,
  classifyOpenSceneUtterance,
  classifyTapUtterance,
  emptyInterimState,
  forceInterimFinal,
  henryCaptureMode,
  isInterimDue,
  pickRecorderMimeType,
  recordingDecision,
  takeFinalResult,
  trackInterim,
  acceptFollowUp,
  conversationHistory,
  detectBargeIn,
  henryCaption,
  isConversationEnd,
  isConversationExpired,
  isEchoOf,
  isStopCommand,
  nextRestartDelay,
  splitForSpeech
} from "../lib/henry-voice-conversation.mjs";
import { HENRY_HISTORY_TURNS, sanitizeHistory } from "../lib/henry-voice-core.mjs";
import { HENRY_ORB_STATES, mixHexColor, orbEase, orbStops } from "../components/henry/henry-orb-states.mjs";

test("palavras de parada: só frase curta feita delas", () => {
  for (const phrase of ["para", "Para!", "espera", "pera", "peraí", "chega", "para, Henry", "ei, espera aí", "pode parar"]) {
    assert.equal(isStopCommand(phrase), true, phrase);
  }
  for (const phrase of ["para hoje quantos leads", "chega de cliente novo hoje?", "", "obrigado", "Henry, quantos leads?"]) {
    assert.equal(isStopCommand(phrase), false, phrase);
  }
});

test("interrupção: nome ou parada cortam; a própria voz (eco) não", () => {
  assert.deepEqual(detectBargeIn("Henry, e os leads de ontem?", "Hoje entraram 4 leads."), { interrupt: true, kind: "question", question: "e os leads de ontem?" });
  assert.equal(detectBargeIn("Henry", "Hoje entraram 4 leads.").kind, "wake");
  assert.equal(detectBargeIn("espera", "Hoje entraram 4 leads.").kind, "stop");
  // "para" dentro da própria fala dele = eco, não interrompe; o nome continua valendo.
  assert.equal(detectBargeIn("para", "Para hoje temos 3 visitas.").interrupt, false);
  assert.equal(detectBargeIn("hoje entraram 4 leads", "Hoje entraram 4 leads.").interrupt, false);
  assert.equal(detectBargeIn("o Henrique mandou os documentos", "").interrupt, false);
});

test("saída do modo conversa: frases de despedida e silêncio de ~40 s", () => {
  for (const phrase of ["obrigado, Henry", "Obrigada", "valeu Henry", "pode parar", "tchau", "tchau, Henry", "era só isso", "ok, obrigado"]) {
    assert.equal(isConversationEnd(phrase), true, phrase);
  }
  for (const phrase of ["obrigado por avisar a Carol amanhã", "quantos leads hoje?", "", "e ontem?"]) {
    assert.equal(isConversationEnd(phrase), false, phrase);
  }
  assert.equal(CONVERSATION_IDLE_MS, 40000);
  assert.equal(isConversationExpired(1000, 1000 + 39999), false);
  assert.equal(isConversationExpired(1000, 1000 + 40000), true);
  assert.equal(isConversationExpired(0, 5), true);
});

test("continuação sem o nome: aceita pergunta curta, recusa ruído, parada e eco", () => {
  const spoken = ["Hoje entraram 4 leads e 2 clientes aguardam resposta.", "Deixa eu ver…"];
  assert.equal(acceptFollowUp("e ontem?", spoken), true);
  assert.equal(acceptFollowUp("e da Carol?", spoken), true);
  assert.equal(acceptFollowUp("hum", spoken), false);
  assert.equal(acceptFollowUp("para", spoken), false);
  assert.equal(acceptFollowUp("2 clientes aguardam resposta", spoken), false); // eco da resposta
  assert.equal(acceptFollowUp("deixa eu ver", spoken), false); // eco da confirmação
  assert.equal(isEchoOf("deixa eu ver", "Deixa eu ver…"), true);
});

test("memória da página: no máximo ~8 trocas (a memória do dia no servidor manda)", () => {
  assert.equal(HENRY_HISTORY_TURNS, 16);
  const turns = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `t${index}` }));
  const history = conversationHistory(turns, 0);
  assert.equal(history.length, 16);
  assert.equal(history[0].text, "t4");
  assert.deepEqual(conversationHistory(turns, 18).map((turn) => turn.text), ["t18", "t19"]);
  assert.deepEqual(conversationHistory(turns, 20), []); // zerada ao sair do modo conversa
  // O servidor também corta (mesmo limite) e alterna os papéis.
  assert.equal(sanitizeHistory([...turns, { role: "user", text: "agora" }]).length <= HENRY_HISTORY_TURNS, true);
});

test("ritmo: fala em partes e religar com espera crescente", () => {
  assert.deepEqual(splitForSpeech("Hoje entraram 4 leads no CRM. A Carol atendeu 2 e o Bruno 1."), ["Hoje entraram 4 leads no CRM.", "A Carol atendeu 2 e o Bruno 1."]);
  assert.deepEqual(splitForSpeech("Sim. Pode."), ["Sim. Pode."]); // primeira frase curta demais: uma parte só
  assert.deepEqual(splitForSpeech(""), []);
  assert.equal(nextRestartDelay(0), 400);
  assert.equal(nextRestartDelay(1), 800);
  assert.equal(nextRestartDelay(50), 30000);
});

test("legenda do ícone: pergunta enquanto pensa, resposta enquanto fala/conversa", () => {
  const turns = [{ role: "user", text: "Henry, e ontem?" }, { role: "assistant", text: "Ontem entraram 6 leads." }];
  assert.equal(henryCaption("thinking", turns), "Henry, e ontem?");
  assert.equal(henryCaption("speaking", turns), "Ontem entraram 6 leads.");
  assert.equal(henryCaption("armed", turns), "Ontem entraram 6 leads.");
  assert.equal(henryCaption("idle", turns), "");
});

test("anel: estados distintos, transição de ~300 ms e cor quente ao falar", () => {
  const { idle, listening, thinking, speaking } = HENRY_ORB_STATES;
  assert.ok(listening.levelAmp > 1 && listening.travel > 0 && listening.glowLevel > 0.5); // ouvindo: segue o volume
  assert.ok(thinking.counterSpin > 0.5 && thinking.beamOn === 1 && thinking.breath > idle.breath); // pensando
  assert.ok(speaking.sphere === 1 && speaking.fan === 1 && speaking.warm === 1 && speaking.levelSwell > listening.levelSwell); // falando
  assert.ok(idle.amp < listening.amp && idle.spin > 0); // parado: respira e gira devagar
  // ~95% do caminho em 300 ms, em 60 fps ou 30 fps.
  let value = 0;
  for (let frame = 0; frame < 18; frame += 1) value += (1 - value) * orbEase(1 / 60);
  assert.ok(value > 0.94 && value < 0.97, String(value));
  value = 0;
  for (let frame = 0; frame < 9; frame += 1) value += (1 - value) * orbEase(1 / 30);
  assert.ok(value > 0.94 && value < 0.97, String(value));
  assert.equal(mixHexColor("#000000", "#FFFFFF", 0.5), "#808080");
  assert.equal(orbStops(1)[0][1], "#ffffff");
});

test("anel e ícone: limites de desempenho e movimento reduzido", () => {
  const orb = readFileSync(new URL("../components/henry/HenryOrb.jsx", import.meta.url), "utf8");
  assert.match(orb, /Math\.min\(2, window\.devicePixelRatio/);
  assert.match(orb, /Math\.min\(60, fibers\)/);
  assert.match(orb, /prefers-reduced-motion: reduce/);
  assert.match(orb, /document\.hidden/);
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /motion-reduce:transition-none/);
  assert.match(view, /pointer-events-none fixed/);
  for (const match of view.matchAll(/fibers=\{(\d+)\}/g)) assert.ok(Number(match[1]) <= 60);
});

test("rota: fala em partes só com o mesmo texto já liberado pela barreira", () => {
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /body\?\.stream === true && body\?\.voice !== false\) return answerStream\(/);
  // A voz fala em partes exatamente a resposta já liberada pela barreira (answer.reply sai de safeHenryReply).
  assert.match(route, /splitForSpeech\(answer\.reply\)/);
  assert.match(route, /send\(\{ reply: answer\.reply, navigate, openUrl: openUrlPayload\(answer\.openUrl\), detail/);
  // Interrupção do navegador: AbortController no pedido.
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /signal: controller\.signal/);
  assert.match(client, /addEventListener\("keydown", resume\)/); // destrava o som no 1º clique OU tecla
  assert.match(client, /visibilitychange/);
});

// --- Celular (dono, 2026-10-22: "também gostaria do Henry no celular, no aplicativo") -----------------------------------
import { henryListenMode, shouldRunRecognition, silentWavDataUri } from "../lib/henry-voice-conversation.mjs";

test("celular: tocar para falar; escuta contínua só no computador ou com a opção ligada", () => {
  assert.equal(henryListenMode({ desktop: true }), "always");
  assert.equal(henryListenMode({ desktop: false }), "tap");
  assert.equal(henryListenMode({ desktop: false, mobileWake: true }), "always");
  assert.equal(shouldRunRecognition({ mode: "tap", sessionOpen: false }), false);
  assert.equal(shouldRunRecognition({ mode: "tap", sessionOpen: true }), true);
  assert.equal(shouldRunRecognition({ mode: "always", sessionOpen: false }), true);
});

test("celular: áudio destravado no toque com um elemento único (Safari iOS)", () => {
  const wav = Buffer.from(silentWavDataUri().split(",")[1], "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.equal((client.match(/new Audio\(/g) || []).length, 1); // um só elemento, reaproveitado
  assert.match(client, /setAttribute\("playsinline", ""\)/);
  assert.match(client, /unlockAudio\(\);\s*sessionOpenRef\.current = true;\s*startListeningRef\.current\?\.\(\);/); // dentro do toque
  assert.match(client, /pushState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), henryOpen: true \}/); // voltar minimiza
  assert.match(client, /root\.style\.overflow = "hidden"/); // sem rolagem por trás
});

test("celular: ícone acima da barra inferior e cena com safe-area", () => {
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /max\(env\(safe-area-inset-bottom\), var\(--admin-bottom-nav-space, 0px\)\)/);
  assert.match(view, /safe-area-inset-top/);
  assert.match(view, /end - start > 90/); // arrastar para baixo minimiza
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /typeof body\?\.mobileWake === "boolean"/);
});

test("interrupção: nome no meio da frase misturada com a voz do Henry corta a fala", () => {
  const speech = "Bom dia, Matheus. Hoje entraram dois leads e a equipe está on-line";
  const mixed = detectBargeIn("hoje entraram dois leads e a equipe henry", speech);
  assert.equal(mixed.interrupt, true);
  const withQuestion = detectBargeIn("dois leads e a equipe henry e ontem", speech);
  assert.equal(withQuestion.interrupt, true);
  assert.equal(withQuestion.question, "e ontem");
  assert.equal(detectBargeIn("e a equipe esta on line para", speech).interrupt, true);
  // palavra que está na própria fala do Henry não interrompe
  assert.equal(detectBargeIn("a equipe esta on line", speech).interrupt, false);
  assert.equal(detectBargeIn("vou para a reuniao", "Você vai para a reunião às dez").interrupt, false);
});

test("um aparelho por vez: quem falou primeiro segura a conversa por 25 s", async () => {
  const { decideDeviceClaim, DEVICE_HOLD_MS } = await import("../lib/henry-voice-conversation.mjs");
  const now = 1_000_000;
  assert.deepEqual(decideDeviceClaim({ current: null, deviceId: "a", now }), { allowed: true, next: { deviceId: "a", at: now } });
  assert.equal(decideDeviceClaim({ current: { deviceId: "a", at: now - 5000 }, deviceId: "b", now }).allowed, false);
  assert.equal(decideDeviceClaim({ current: { deviceId: "a", at: now - DEVICE_HOLD_MS - 1 }, deviceId: "b", now }).allowed, true);
  assert.equal(decideDeviceClaim({ current: { deviceId: "a", at: now - 5000 }, deviceId: "a", now }).allowed, true);
  assert.equal(decideDeviceClaim({ current: { deviceId: "a", at: now }, deviceId: "", now }).allowed, true);
});

test("enquanto pensa: nada de confirmação na voz do navegador (o antigo 'Deixa eu ver…'); só as frases de espera na voz do Henry", () => {
  const src = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /pickAcknowledgement|ACK_DELAY_MS|ackTimerRef/);
  assert.match(src, /pickWaitPhrase/);
});

test("rede de segurança: parcial parado por ~1,2 s vira final, uma vez", () => {
  let state = trackInterim(emptyInterimState(), { index: 0, text: "Henry quantos leads hoje", now: 1000 });
  assert.equal(isInterimDue(state, 1000 + INTERIM_FINAL_MS - 1), false);
  const forced = forceInterimFinal(state, 1000 + INTERIM_FINAL_MS);
  assert.equal(forced.text, "Henry quantos leads hoje");
  assert.equal(forceInterimFinal(forced.state, 9999).text, ""); // não repete
  // O final atrasado do mesmo trecho é ignorado.
  assert.equal(takeFinalResult(forced.state, { index: 0, text: "Henry, quantos leads hoje?" }).text, "");
  // iPhone acumula no mesmo resultado: só o que veio depois conta.
  state = trackInterim(forced.state, { index: 0, text: "Henry quantos leads hoje e ontem", now: 5000 });
  assert.equal(state.text, "e ontem");
  // Outro resultado (índice novo) conta inteiro.
  assert.equal(takeFinalResult(forced.state, { index: 1, text: "e da Carol" }).text, "e da Carol");
});

test("rede de segurança: final de verdade cancela o parcial pendente", () => {
  const state = trackInterim(emptyInterimState(), { index: 0, text: "bom dia Henry", now: 0 });
  const taken = takeFinalResult(state, { index: 0, text: "bom dia Henry" });
  assert.equal(taken.text, "bom dia Henry");
  assert.equal(isInterimDue(taken.state, 60000), false);
  assert.equal(forceInterimFinal(taken.state, 60000).text, "");
  // Resultado novo antes do prazo empurra o prazo (parcial atualizado = relógio zerado).
  const later = trackInterim(state, { index: 0, text: "bom dia Henry tudo bem", now: 1000 });
  assert.equal(isInterimDue(later, 1000 + INTERIM_FINAL_MS - 1), false);
});

test("tocar para falar: gravação no celular sem reconhecimento ou no app do iPhone; computador segue o Chrome", () => {
  assert.equal(henryCaptureMode({ desktop: true, hasRecognition: true, hasRecorder: true }), "recognition");
  assert.equal(henryCaptureMode({ desktop: true, hasRecognition: false, hasRecorder: true }), "none");
  assert.equal(henryCaptureMode({ desktop: false, hasRecognition: false, hasRecorder: true }), "record");
  assert.equal(henryCaptureMode({ desktop: false, hasRecognition: true, hasRecorder: true }), "recognition");
  assert.equal(henryCaptureMode({ desktop: false, hasRecognition: true, hasRecorder: true, recognitionFailed: true }), "record");
  assert.equal(henryCaptureMode({ desktop: false, hasRecognition: true, hasRecorder: true, iosStandalone: true }), "record");
  assert.equal(henryCaptureMode({ desktop: false, hasRecognition: false, hasRecorder: false }), "none");
  // iPhone grava audio/mp4; Chrome/Android, webm.
  assert.equal(pickRecorderMimeType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderMimeType((type) => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickRecorderMimeType(() => false), "");
  assert.equal(pickRecorderMimeType(undefined), "");
});

test("tocar para falar: para sozinho com silêncio, descarta sem voz e corta em 20 s", () => {
  const base = { startedAt: 0, hasMeter: true };
  assert.equal(recordingDecision({ ...base, heardVoice: true, lastVoiceAt: 2000, now: 2000 + RECORD_SILENCE_MS - 1 }), null);
  assert.equal(recordingDecision({ ...base, heardVoice: true, lastVoiceAt: 2000, now: 2000 + RECORD_SILENCE_MS }), "send");
  assert.equal(recordingDecision({ ...base, heardVoice: false, now: RECORD_NO_SPEECH_MS }), "discard");
  assert.equal(recordingDecision({ ...base, heardVoice: true, lastVoiceAt: RECORD_MAX_MS, now: RECORD_MAX_MS }), "send");
  assert.equal(recordingDecision({ startedAt: 0, hasMeter: false, now: 15000 }), null); // sem medidor: só toque ou 20 s
  assert.equal(recordingDecision({ startedAt: 0, hasMeter: false, now: RECORD_MAX_MS }), "send");
});

test("tocar para falar: o toque já é o chamado (saudação sozinha = relatório)", () => {
  assert.deepEqual(classifyTapUtterance("Bom dia"), { kind: "report", question: "" });
  assert.deepEqual(classifyTapUtterance("boa tarde, tudo bem?"), { kind: "report", question: "" });
  assert.deepEqual(classifyTapUtterance("Bom dia, Henry"), { kind: "report", question: "" });
  assert.deepEqual(classifyTapUtterance("Henry, quantos leads hoje?"), { kind: "question", question: "quantos leads hoje?" });
  assert.deepEqual(classifyTapUtterance("Quantos clientes aguardam resposta?"), { kind: "question", question: "Quantos clientes aguardam resposta?" });
  assert.equal(classifyTapUtterance("Henry").kind, "wake");
  assert.equal(classifyTapUtterance("  ").kind, "empty");
  assert.equal(classifyTapUtterance("bom dia, quantos leads hoje?").kind, "question");
});

test("tela cheia aberta: frase sem o nome vira pedido; eco, ruído e parada não", () => {
  const spoken = ["Hoje entraram 6 leads e 3 clientes aguardam resposta."];
  assert.deepEqual(classifyOpenSceneUtterance("Quantos por cento falta para bater a meta de hoje", spoken), { kind: "question", question: "Quantos por cento falta para bater a meta de hoje" });
  assert.equal(classifyOpenSceneUtterance("bom dia", spoken).kind, "report");
  assert.equal(classifyOpenSceneUtterance("3 clientes aguardam resposta", spoken).kind, "ignore"); // eco da fala dele
  assert.equal(classifyOpenSceneUtterance("hum", spoken).kind, "ignore");
  assert.equal(classifyOpenSceneUtterance("pode parar", spoken).kind, "ignore");
  const src = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(src, /if \(expandedRef\.current\) \{\s*const intent = classifyOpenSceneUtterance/);
  assert.match(src, /\(diga “Henry” antes\)/);
});

// --- Minimizado "escuta, mas não responde" (dono, 2026-10-22) -----------------------------------------------------------
import { classifyArmedUtterance, mentionsHenry } from "../lib/henry-voice-conversation.mjs";

test("armar pelo parcial: o nome no parcial vale mesmo se a final vier sem ele", () => {
  let state = trackInterim(emptyInterimState(), { index: 0, text: "Henry quantos por cento", now: 0 });
  assert.equal(state.named, true);
  state = trackInterim(state, { index: 0, text: "quantos por cento falta para bater a meta", now: 300 }); // parcial seguinte já sem o nome
  assert.equal(state.named, true);
  const taken = takeFinalResult(state, { index: 0, text: "Quantos por cento falta para bater a meta de hoje" });
  assert.equal(taken.named, true);
  assert.deepEqual(classifyArmedUtterance(taken.text), { kind: "question", question: "Quantos por cento falta para bater a meta de hoje" });
  // Rede de segurança (parcial vira final) também leva o "armado".
  const forced = forceInterimFinal(trackInterim(emptyInterimState(), { index: 2, text: "Henry e os leads de ontem", now: 0 }), INTERIM_FINAL_MS);
  assert.equal(forced.named, true);
  // Trecho novo (outro índice) sem o nome não herda.
  const other = takeFinalResult(trackInterim(state, { index: 1, text: "conversa da sala", now: 500 }), { index: 1, text: "conversa da sala" });
  assert.equal(other.named, false);
  // Armado: saudação sozinha → relatório; ruído e eco → nada.
  assert.equal(classifyArmedUtterance("bom dia").kind, "report");
  assert.equal(classifyArmedUtterance("hum").kind, "");
  assert.equal(classifyArmedUtterance("Hoje entraram 4 leads", ["Hoje entraram 4 leads."]).kind, "");
  assert.equal(mentionsHenry("e aí henri tudo bem"), true);
  assert.equal(mentionsHenry("o Henrique mandou"), false); // nome comum de cliente não arma
});

test("janela de conversa: ~40 s depois de qualquer resposta; reconhecimento não é recriado a cada render", () => {
  assert.equal(isConversationExpired(Date.now() - 39000), false);
  assert.equal(isConversationExpired(Date.now() - 41000), true);
  const src = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(src, /\}, \[active, supported, muted, recordMode, listenMode\]\);/); // deps estáveis
  assert.match(src, /handleFinalRef\.current\(text, \{ armed: named \}\)/);
  assert.match(src, /startConversation\(\); \/\/ depois de qualquer resposta/);
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /heardHint \|\| status/); // minimizado mostra o que foi ignorado
});

// --- "Quando eu falo, ele não para de falar" (dono, 2026-10-22) ----------------------------------------------------------
import { detectSpeechBargeIn, micVoiceSustained, speechOverlap } from "../lib/henry-voice-conversation.mjs";

test("qualquer fala do dono interrompe (3+ palavras, não eco); eco da própria voz não; nome e 'para' continuam", () => {
  const speaking = "Hoje entraram 4 leads e a equipe está em 72 por cento da meta.";
  assert.equal(detectSpeechBargeIn("entraram 4 leads e a equipe", speaking).interrupt, false); // eco
  assert.equal(detectSpeechBargeIn("ok", speaking).interrupt, false); // curto
  assert.equal(detectSpeechBargeIn("hum hum hum", speaking).interrupt, false); // ruído
  const partial = detectSpeechBargeIn("e as vendas de ontem", speaking);
  assert.equal(partial.interrupt, true);
  assert.equal(partial.kind, "speech");
  const final = detectSpeechBargeIn("e as vendas de ontem?", speaking, { final: true });
  assert.deepEqual(final, { interrupt: true, kind: "question", question: "e as vendas de ontem?" });
  assert.equal(detectSpeechBargeIn("Henry", speaking).interrupt, true); // nome
  assert.equal(detectSpeechBargeIn("para", speaking).interrupt, true); // parada
  assert.ok(speechOverlap("a equipe está em", speaking) >= 0.4);
  // Medidor: voz sustentada por ~300 ms.
  let state = micVoiceSustained({ level: 0.3, since: 0, now: 1000 });
  assert.equal(state.sustained, false);
  state = micVoiceSustained({ level: 0.3, since: state.since, now: 1300 });
  assert.equal(state.sustained, true);
  assert.deepEqual(micVoiceSustained({ level: 0.01, since: 1000, now: 1400 }), { sustained: false, since: 0 });
  const src = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(src, /detectSpeechBargeIn\(text, currentSpeech\(\), \{ final: true \}\)/);
  assert.match(src, /phaseRef\.current === "speaking" && desktopRef\.current && detectSpeechBargeIn/); // celular: tocar para interromper
});
