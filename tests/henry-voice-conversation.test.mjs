import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACK_PHRASES,
  CONVERSATION_IDLE_MS,
  acceptFollowUp,
  conversationHistory,
  detectBargeIn,
  henryCaption,
  isConversationEnd,
  isConversationExpired,
  isEchoOf,
  isStopCommand,
  nextRestartDelay,
  pickAcknowledgement,
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

test("saída do modo conversa: frases de despedida e silêncio de ~20 s", () => {
  for (const phrase of ["obrigado, Henry", "Obrigada", "valeu Henry", "pode parar", "tchau", "tchau, Henry", "era só isso", "ok, obrigado"]) {
    assert.equal(isConversationEnd(phrase), true, phrase);
  }
  for (const phrase of ["obrigado por avisar a Carol amanhã", "quantos leads hoje?", "", "e ontem?"]) {
    assert.equal(isConversationEnd(phrase), false, phrase);
  }
  assert.equal(CONVERSATION_IDLE_MS, 20000);
  assert.equal(isConversationExpired(1000, 1000 + 19999), false);
  assert.equal(isConversationExpired(1000, 1000 + 20000), true);
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

test("memória: só as trocas do modo conversa atual, no máximo ~6", () => {
  assert.equal(HENRY_HISTORY_TURNS, 12);
  const turns = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `t${index}` }));
  const history = conversationHistory(turns, 0);
  assert.equal(history.length, 12);
  assert.equal(history[0].text, "t8");
  assert.deepEqual(conversationHistory(turns, 18).map((turn) => turn.text), ["t18", "t19"]);
  assert.deepEqual(conversationHistory(turns, 20), []); // zerada ao sair do modo conversa
  // O servidor também corta (mesmo limite) e alterna os papéis.
  assert.equal(sanitizeHistory([...turns, { role: "user", text: "agora" }]).length <= HENRY_HISTORY_TURNS, true);
});

test("ritmo: confirmação variada, fala em partes e religar com espera crescente", () => {
  assert.notEqual(pickAcknowledgement("Deixa eu ver…", () => 0), "Deixa eu ver…");
  assert.ok(ACK_PHRASES.includes(pickAcknowledgement("", () => 0.99)));
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
  assert.match(route, /body\?\.stream === true && body\?\.voice !== false\) return speechStream\(auth, answer\.reply, navigate, style\)/);
  assert.match(route, /splitForSpeech\(reply\)/);
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
