import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_SPEED,
  ELEVENLABS_STT_PERMISSION_MESSAGE,
  HENRY_AUDIO_MAX_BASE64,
  buildElevenLabsSpeechRequest,
  buildElevenLabsTranscriptionRequest,
  estimateElevenLabsSttCostUsd,
  parseElevenLabsTranscript,
  parseHenryAudio,
  pronounceForSpeech,
  chooseHenryVoiceProvider,
  describeElevenLabsError,
  elevenLabsVoiceSettings,
  parseElevenLabsSubscription,
  estimateElevenLabsCostUsd,
  henryProviderChain,
  isElevenLabsVoiceId,
  parseElevenLabsVoices,
  pickBestBrowserVoice,
  resolveElevenLabsVoiceId,
  splitSentences
} from "../lib/henry-voice-providers.mjs";
import { mergeHenryStyle, parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";

const VOICE = "AbCdEf0123456789XyZ0";

test("escolha do provedor: ElevenLabs → OpenAI → navegador", () => {
  assert.equal(chooseHenryVoiceProvider({ elevenLabsKey: "x", openAiKey: "y" }), "elevenlabs");
  assert.equal(chooseHenryVoiceProvider({ openAiKey: "y" }), "openai");
  assert.equal(chooseHenryVoiceProvider({ elevenLabsKey: "  " }), "browser");
  assert.equal(chooseHenryVoiceProvider({}), "browser");
  assert.deepEqual(henryProviderChain({ elevenLabsKey: "x", openAiKey: "y" }), ["elevenlabs", "openai"]); // falhou → OpenAI
  assert.deepEqual(henryProviderChain({ elevenLabsKey: "x" }), ["elevenlabs"]);
  assert.deepEqual(henryProviderChain({}), []); // sem chave → navegador
});

test("pedido à ElevenLabs: streaming, modelo de menor latência, voz natural e velocidade", () => {
  const { url, body } = buildElevenLabsSpeechRequest({ text: "Bom dia, Matheus.", voiceId: VOICE, style: { speed: "rapido", tone: "carismatico" }, nextText: "Segue o relatório." });
  assert.equal(url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?output_format=mp3_44100_128`);
  assert.equal(body.model_id, ELEVENLABS_DEFAULT_MODEL);
  assert.equal(ELEVENLABS_DEFAULT_MODEL, "eleven_flash_v2_5");
  assert.equal(body.language_code, "pt");
  assert.equal(body.next_text, "Segue o relatório.");
  assert.equal(body.voice_settings.speed, ELEVENLABS_SPEED.rapido);
  assert.ok(body.voice_settings.stability < 0.5 && body.voice_settings.similarity_boost >= 0.8 && body.voice_settings.style > 0);
  assert.equal(body.voice_settings.use_speaker_boost, true);
  assert.equal(elevenLabsVoiceSettings({}).speed, 1);
  assert.equal(buildElevenLabsSpeechRequest({ text: "oi", voiceId: VOICE, modelId: "eleven_multilingual_v2" }).body.language_code, undefined);
  assert.throws(() => buildElevenLabsSpeechRequest({ text: "oi", voiceId: "../../v1/user" }), /inválida/);
});

test("custo estimado por caractere", () => {
  assert.equal(estimateElevenLabsCostUsd("x".repeat(1000)), 0.04);
  assert.equal(estimateElevenLabsCostUsd("x".repeat(1000), "eleven_multilingual_v2"), 0.08);
});

test("vozes da conta: quem fala português primeiro e voz padrão", () => {
  const list = parseElevenLabsVoices({
    voices: [
      { voice_id: "ZzEnglish0000000001", name: "Adam", labels: { accent: "american", gender: "male" } },
      { voice_id: "PtBr00000000000002", name: "Bruno", verified_languages: [{ language: "pt", model_id: "eleven_flash_v2_5", locale: "pt-BR" }], labels: { gender: "male" } },
      { voice_id: "bad id!", name: "Hack" }
    ]
  });
  assert.deepEqual(list.map((voice) => [voice.id, voice.portuguese]), [["PtBr00000000000002", true], ["ZzEnglish0000000001", false]]);
  assert.equal(resolveElevenLabsVoiceId({ voices: list }), "PtBr00000000000002");
  assert.equal(resolveElevenLabsVoiceId({ chosen: VOICE, voices: list }), VOICE);
  assert.equal(resolveElevenLabsVoiceId({ envVoiceId: VOICE, voices: list }), VOICE);
  assert.equal(resolveElevenLabsVoiceId({ voices: [] }), "");
  assert.equal(isElevenLabsVoiceId("abc"), false);
});

test("voz escolhida é salva no estilo (validada) e pode voltar ao padrão", () => {
  assert.deepEqual(parseHenryStylePatch({ elevenVoice: VOICE }), { ok: true, patch: { elevenVoice: VOICE } });
  assert.equal(parseHenryStylePatch({ elevenVoice: "x/../y" }).ok, false);
  assert.deepEqual(mergeHenryStyle({ elevenVoice: VOICE, tone: "executivo" }, { elevenVoice: "" }), { tone: "executivo" });
  assert.equal(resolveHenryStyle({ elevenVoice: VOICE }).elevenVoice, VOICE);
});

test("reserva do navegador: melhor voz pt-BR e uma frase por vez", () => {
  const voices = [
    { name: "Microsoft Maria - Portuguese (Brazil)", lang: "pt-BR", localService: true },
    { name: "Google português do Brasil", lang: "pt-BR", localService: false },
    { name: "Microsoft Antonio Online (Natural) - Portuguese (Brazil)", lang: "pt-BR", localService: false },
    { name: "Google US English", lang: "en-US" }
  ];
  assert.equal(pickBestBrowserVoice(voices).name, "Microsoft Antonio Online (Natural) - Portuguese (Brazil)");
  assert.equal(pickBestBrowserVoice(voices.slice(0, 2)).name, "Google português do Brasil");
  assert.equal(pickBestBrowserVoice([{ name: "Google US English", lang: "en-US" }]), null);
  assert.deepEqual(splitSentences("Bom dia, Matheus. Hoje entraram 4 leads! E aí?  Tudo certo"), ["Bom dia, Matheus.", "Hoje entraram 4 leads!", "E aí?", "Tudo certo"]);
  assert.deepEqual(splitSentences(""), []);
});

test("erros de permissão claros e saldo de caracteres", () => {
  assert.match(describeElevenLabsError(401, "tts"), /401.*ELEVENLABS_API_KEY/);
  assert.match(describeElevenLabsError(403, "voices"), /permissão "Vozes \(ler\)" \(403\)/);
  assert.match(describeElevenLabsError(403, "user"), /"Usuário"/);
  assert.match(describeElevenLabsError(429), /saldo/);
  assert.deepEqual(parseElevenLabsSubscription({ character_count: 1200, character_limit: 30000, tier: "starter" }), { used: 1200, limit: 30000, remaining: 28800, tier: "starter" });
  assert.equal(parseElevenLabsSubscription({}), null);
  // Só os endpoints liberados na chave do dono: TTS/stream, vozes e assinatura do usuário.
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  const endpoints = [...lib.matchAll(/\$\{ELEVENLABS_API\}(\/v\d\/[a-z/_-]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(endpoints, ["/v1/user/subscription", "/v2/voices"]);
  const core = readFileSync(new URL("../lib/henry-voice-providers.mjs", import.meta.url), "utf8");
  assert.match(core, /\$\{ELEVENLABS_API\}\/v1\/text-to-speech\/\$\{voiceId\}\/stream/);
});

test("servidor: chave só no servidor, falhas registradas e queda para o próximo provedor", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /"xi-api-key": process\.env\.ELEVENLABS_API_KEY/);
  assert.match(lib, /henryProviderChain\(providerEnv\(\)\)/);
  assert.match(lib, /success: false, errorMessage: `\$\{provider\}:/);
  for (const file of ["../components/henry/HenrySettingsCard.jsx", "../components/henry/HenryVoiceAssistant.jsx", "../components/henry/HenryVoiceView.jsx"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /process\.env\.ELEVENLABS/);
  }
});

test("pronúncia brasileira do nome: Henry vira Rênri só na voz", () => {
  assert.equal(pronounceForSpeech("Eu sou o Henry. HENRY, henry"), "Eu sou o Rênri. Rênri, Rênri");
  assert.equal(pronounceForSpeech("Henrique comprou"), "Henrique comprou");
  const { body } = buildElevenLabsSpeechRequest({ text: "Sou o Henry", voiceId: "21m00Tcm4TlvDq8ikWAM", previousText: "Henry", nextText: "Henry" });
  assert.equal(body.text, "Sou o Rênri");
  assert.equal(body.previous_text, "Rênri");
  assert.equal(body.next_text, "Rênri");
});

test("voz: números concordam com palavra feminina (21 prospecções → vinte e uma)", () => {
  assert.equal(pronounceForSpeech("fez 21 prospecções e 1 simulação, com 81 pontos"), "fez vinte e uma prospecções e uma simulação, com 81 pontos");
  assert.equal(pronounceForSpeech("2 pessoas, 12 vendas, 200 visitas, 3 clientes"), "duas pessoas, 12 vendas, duzentas visitas, 3 clientes");
  assert.equal(pronounceForSpeech("R$ 1.200,00 e 104% da meta"), "R$ 1.200,00 e 104% da meta");
});

test("fala para texto: pedido ao Scribe da ElevenLabs em português", () => {
  const data = "A".repeat(400);
  const audio = parseHenryAudio(`data:audio/mp4;base64,${data}`);
  assert.deepEqual(audio, { mediaType: "audio/mp4", data });
  assert.equal(parseHenryAudio(`data:audio/webm;codecs=opus;base64,${data}`).mediaType, "audio/webm");
  assert.equal(parseHenryAudio(`data:image/jpeg;base64,${data}`), null);
  assert.equal(parseHenryAudio(`data:audio/mp4;base64,AAAA`), null); // curto demais
  assert.equal(parseHenryAudio(`data:audio/mp4;base64,${"A".repeat(HENRY_AUDIO_MAX_BASE64 + 4)}`), null);
  assert.equal(parseHenryAudio(`data:audio/mp4;base64,${data}<script>`), null);
  const request = buildElevenLabsTranscriptionRequest({ audio });
  assert.equal(request.url, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.deepEqual(request.fields, { model_id: "scribe_v2", language_code: "por", tag_audio_events: "false" });
  assert.equal(request.fileName, "fala.m4a");
  assert.equal(buildElevenLabsTranscriptionRequest({ audio: { mediaType: "audio/webm", data } }).fileName, "fala.webm");
  assert.throws(() => buildElevenLabsTranscriptionRequest({ audio: { mediaType: "video/mp4", data } }));
  assert.equal(parseElevenLabsTranscript({ text: "  quantos   leads hoje?  " }), "quantos leads hoje?");
  assert.equal(parseElevenLabsTranscript({}), "");
  assert.ok(Math.abs(estimateElevenLabsSttCostUsd(3600) - 0.22) < 1e-9);
});

test("fala para texto: 401/403 viram a frase de liberar a permissão", () => {
  assert.equal(describeElevenLabsError(401, "stt"), "Libere 'Fala para Texto' na chave da ElevenLabs.");
  assert.equal(describeElevenLabsError(403, "stt"), ELEVENLABS_STT_PERMISSION_MESSAGE);
  assert.match(describeElevenLabsError(429, "stt"), /429/);
  assert.match(describeElevenLabsError(403, "tts"), /Text to Speech/); // os demais seguem como antes
});

test("fala para texto: áudio nunca é gravado nem logado; custo em henry_voice_stt", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  const fn = lib.slice(lib.indexOf("export async function transcribeHenryAudio"));
  assert.match(fn, /feature: "henry_voice_stt"/);
  assert.doesNotMatch(fn, /console\.[a-z]+\([^)]*audio\.data/);
  assert.doesNotMatch(fn, /getSupabaseAdminClient|writeSettingRow|\.storage/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  const transcribe = route.slice(route.indexOf('body?.mode === "transcribe"'), route.indexOf('const mode = body?.mode === "report"'));
  assert.match(transcribe, /checkPublicRateLimit\(`henry:/); // mesmo limite de taxa
  assert.match(transcribe, /parseHenryAudio/);
  assert.ok(route.indexOf("requireHenryOwner(request)") < route.indexOf('body?.mode === "transcribe"'));
});
