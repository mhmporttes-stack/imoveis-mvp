import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_SPEED,
  buildElevenLabsSpeechRequest,
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
