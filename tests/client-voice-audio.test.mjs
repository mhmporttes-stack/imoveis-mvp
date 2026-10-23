// VOZ-1 (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23): áudio com a voz clonada do dono para o cliente.
// Sem envio real nem chamada à ElevenLabs: só regras puras e leitura do código-fonte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VOICE_AUDIO_EVENTS,
  VOICE_AUDIO_KINDS,
  VOICE_MOMENTS,
  VOICE_VARIANTS,
  applyClientVoiceAudioPatch,
  defaultClientVoiceAudioSettings,
  defaultTemplateText,
  genderFromFirstName,
  isNewRouletteLead,
  isOggAudio,
  isTemplateApproved,
  normalizeClientVoiceAudioSettings,
  pickVoiceVariant,
  planVoiceAudio,
  renderVoiceTemplate,
  templateError,
  voiceAudioClaimKey
} from "../lib/client-voice-audio-core.mjs";
import { buildElevenLabsSpeechRequest } from "../lib/henry-voice-providers.mjs";
import { ATTENDANCE_JOURNEY_EVENTS } from "../lib/client-attendance-core.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const VOICE = "AbCdEfGhIj0123456789";
const enabled = (patch = {}) => applyClientVoiceAudioPatch(applyClientVoiceAudioPatch({}, { voiceId: VOICE }).settings, { enabled: true, ...patch }, { nowIso: "2026-10-23T10:00:00.000Z" }).settings;

test("nasce DESLIGADO, sem voz; simulação masculina e neutra já aprovadas pelo dono, o resto pendente", () => {
  const settings = defaultClientVoiceAudioSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.voiceId, "");
  assert.equal(isTemplateApproved(settings.templates.simulation.male), true);
  assert.equal(isTemplateApproved(settings.templates.simulation.neutral), true);
  assert.equal(isTemplateApproved(settings.templates.simulation.female), false);
  for (const variant of VOICE_VARIANTS) assert.equal(isTemplateApproved(settings.templates.welcome[variant]), false);
  assert.equal(normalizeClientVoiceAudioSettings({ enabled: "true" }).enabled, false);
});

test("texto do dono (simulação) e variante neutra com 'meu amigo'", () => {
  assert.equal(defaultTemplateText("simulation", "male"), "{saudacao}, {primeiro_nome_cliente}. Tudo bem, meu amigo? {primeiro_nome_cliente}, ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?");
  assert.equal(defaultTemplateText("simulation", "neutral"), "{saudacao}, meu amigo! Tudo bem? Ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?");
  assert.match(defaultTemplateText("simulation", "female"), /minha amiga/);
  assert.match(defaultTemplateText("welcome", "neutral"), /^\{saudacao\}, meu amigo!/);
  for (const moment of VOICE_MOMENTS) for (const variant of VOICE_VARIANTS) {
    const text = defaultTemplateText(moment, variant);
    assert.equal(templateError(moment, variant, text), null, `${moment}/${variant}`);
    assert.doesNotMatch(text, /Matheus Machado Im[oó]veis/);
  }
});

test("sexo pelo primeiro nome: listas fechadas; na dúvida ou sem nome, neutro (nunca chuta)", () => {
  assert.deepEqual(pickVoiceVariant("JOÃO DA SILVA"), { variant: "male", firstName: "João" });
  assert.deepEqual(pickVoiceVariant("  maria  aparecida"), { variant: "female", firstName: "Maria" });
  assert.deepEqual(pickVoiceVariant("Darci Souza"), { variant: "neutral", firstName: "" }); // nome dos dois sexos
  assert.deepEqual(pickVoiceVariant("Kauãzinho"), { variant: "neutral", firstName: "" });
  assert.deepEqual(pickVoiceVariant(""), { variant: "neutral", firstName: "" });
  assert.deepEqual(pickVoiceVariant("Cliente WhatsApp"), { variant: "neutral", firstName: "" });
  assert.deepEqual(pickVoiceVariant("😍 Ana"), { variant: "neutral", firstName: "" });
  assert.equal(genderFromFirstName("Andre"), "male");
  assert.equal(genderFromFirstName("Andréia"), "female");
});

test("variáveis: saudação, cliente e corretor trocados; nada sobra para ser falado", () => {
  assert.equal(renderVoiceTemplate("{saudacao}, {primeiro_nome_cliente}! Quem atende é {primeiro_nome_corretor}. {outra}", { saudacao: "Boa tarde", cliente: "Ana", corretor: "Bruna" }), "Boa tarde, Ana! Quem atende é Bruna.");
  assert.match(templateError("simulation", "male", "Oi {nome}"), /Variável desconhecida/);
  assert.match(templateError("simulation", "neutral", "{saudacao}, {primeiro_nome_cliente}"), /neutro/);
  assert.match(templateError("welcome", "male", "{saudacao}, {primeiro_nome_cliente}"), /primeiro_nome_corretor/);
  assert.match(templateError("simulation", "male", "Oi, aqui é da Matheus Machado Imóveis"), /nome oficial/);
  assert.match(templateError("simulation", "male", "x".repeat(400)), /longo demais/);
});

test("aprovar e editar: editar o texto desaprova; só modelo aprovado é usado", () => {
  let settings = enabled();
  settings = applyClientVoiceAudioPatch(settings, { template: { moment: "welcome", variant: "male", text: "{saudacao}, {primeiro_nome_cliente}. Quem te atende é {primeiro_nome_corretor}." } }).settings;
  assert.equal(isTemplateApproved(settings.templates.welcome.male), false);
  assert.equal(planVoiceAudio({ settings, moment: "welcome", clientName: "João", brokerName: "Bruna Lima", greeting: "Bom dia" }).reason, "modelo_nao_aprovado");
  settings = applyClientVoiceAudioPatch(settings, { approve: { moment: "welcome", variant: "male" } }).settings;
  assert.deepEqual(planVoiceAudio({ settings, moment: "welcome", clientName: "João", brokerName: "Bruna Lima", greeting: "Bom dia" }), { ok: true, variant: "male", text: "Bom dia, João. Quem te atende é Bruna." });
  // Editar de novo desaprova.
  settings = applyClientVoiceAudioPatch(settings, { template: { moment: "welcome", variant: "male", text: "{saudacao}, {primeiro_nome_cliente}! Quem te atende é {primeiro_nome_corretor}." } }).settings;
  assert.equal(isTemplateApproved(settings.templates.welcome.male), false);
  // Feminino ainda pendente: cliente "Maria" não recebe (sem cair para outro modelo).
  assert.equal(planVoiceAudio({ settings, moment: "simulation", clientName: "Maria", greeting: "Bom dia" }).reason, "modelo_nao_aprovado");
  // Sem nome confiável → neutro aprovado.
  assert.deepEqual(planVoiceAudio({ settings, moment: "simulation", clientName: "", greeting: "Boa noite" }).variant, "neutral");
});

test("desligado ou sem voice_id: só pula (nunca bloqueia o link); ligar exige voice_id e vale daqui para frente", () => {
  assert.equal(planVoiceAudio({ settings: defaultClientVoiceAudioSettings(), moment: "simulation", clientName: "João" }).reason, "desligado");
  assert.match(applyClientVoiceAudioPatch({}, { enabled: true }).error, /voice_id/);
  assert.match(applyClientVoiceAudioPatch({}, { voiceId: "abc/../x" }).error, /inválido/);
  const settings = enabled();
  assert.equal(settings.enabledAt, "2026-10-23T10:00:00.000Z");
  assert.equal(applyClientVoiceAudioPatch(settings, { enabled: false }).settings.enabledAt, null);
  const plan = planVoiceAudio({ settings, moment: "simulation", clientName: "João Pedro", greeting: "Bom dia" });
  assert.equal(plan.text, "Bom dia, João. Tudo bem, meu amigo? João, ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?");
});

test("boas-vindas: só lead novo, 1ª entrada na roleta depois de ligar e dentro do prazo", () => {
  const nowMs = Date.parse("2026-10-23T15:00:00Z");
  const base = { firstAssignedAt: "2026-10-23T14:00:00Z", registrationCreatedAt: "2026-10-23T13:59:00Z", enabledAt: "2026-10-23T10:00:00Z", nowMs };
  assert.equal(isNewRouletteLead(base), true);
  assert.equal(isNewRouletteLead({ ...base, enabledAt: "2026-10-23T14:30:00Z" }), false); // antes de ligar
  assert.equal(isNewRouletteLead({ ...base, registrationCreatedAt: "2026-10-01T10:00:00Z" }), false); // cliente antigo
  assert.equal(isNewRouletteLead({ ...base, nowMs: Date.parse("2026-10-23T21:00:00Z") }), false); // passou do prazo
  assert.equal(isNewRouletteLead({ ...base, enabledAt: null }), false);
});

test("formato de nota de voz: pedido em Opus e checagem dos bytes Ogg", () => {
  const request = buildElevenLabsSpeechRequest({ text: "Oi", voiceId: VOICE, modelId: "eleven_multilingual_v2", outputFormat: "opus_48000_32" });
  assert.match(request.url, /output_format=opus_48000_32$/);
  assert.match(buildElevenLabsSpeechRequest({ text: "Oi", voiceId: VOICE }).url, /output_format=mp3_44100_128$/); // Henry inalterado
  assert.equal(isOggAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2])), true);
  assert.equal(isOggAudio(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0])), false); // MP3
});

test("um áudio por momento por cadastro; eventos fora do atendimento humano", () => {
  assert.equal(voiceAudioClaimKey("simulation", "abc"), "voice-audio:simulation:abc");
  assert.notEqual(voiceAudioClaimKey("simulation", "abc"), voiceAudioClaimKey("welcome", "abc"));
  for (const event of Object.values(VOICE_AUDIO_EVENTS)) assert.equal(ATTENDANCE_JOURNEY_EVENTS.includes(event), false, event);
});

test("servidor: travas, ordem do envio, cache, custo e cadência (leitura do código)", () => {
  const server = source("lib/client-voice-audio.js");
  // Reserva única por momento/cadastro e mensagem de AUTOMAÇÃO.
  assert.match(server, /claimKey: voiceAudioClaimKey\(moment, registration\.id\)/);
  assert.match(server, /sendReservedAutomationMessage/);
  // Nota de voz: Oficial com voice:true; individual como PTT Ogg/Opus.
  assert.match(server, /audio: \{ link: audio\.url, voice: true \}/);
  assert.match(server, /ptt: true/);
  // Cache pelo texto final antes de chamar a ElevenLabs; custo em ai_usage_log.
  const synth = server.split("export async function synthesizeVoiceAudio")[1].split("\n}\n")[0];
  assert.ok(synth.indexOf("findChatMediaAt(path)") < synth.indexOf("fetch(request.url"));
  assert.match(synth, /recordAiUsage\(\{ feature: CLIENT_VOICE_AUDIO_FEATURE/);
  // Boas-vindas: Não contactar/bloqueado/equipe, só quem veio da roleta e cadência anti-ban do número.
  const welcome = server.split("async function handleWelcome")[1].split("\n}\n")[0];
  for (const guard of ["findDoNotContactInboundBlock", "findInternalTeamPhone", "autoSendSkipReason", "isDistributionFirstMessageAllowed", "individualAutomationSendGate", "brokerSpokeAlready"]) {
    assert.match(welcome, new RegExp(guard), guard);
  }
  assert.ok(welcome.indexOf("individualAutomationSendGate") < welcome.indexOf("sendReservedAudio"));
  // Áudio da simulação nunca derruba o link.
  const sim = server.split("export async function sendSimulationVoiceAudio")[1].split("\n}\n")[0];
  assert.match(sim, /catch \(error\)/);
  // Auto-envio: áudio só DEPOIS do link enviado, pela mesma conversa.
  const autoSend = source("lib/simulation-auto-send.js");
  const sent = autoSend.split('if (result.status === "enviado") {')[1].split("\n  }\n")[0];
  assert.ok(sent.indexOf('recordOutcome(registrationId, "sent"') < sent.indexOf("sendSimulationVoiceAudio"));
  assert.match(sent, /channel: result\.audioChannel/);
  // Boas-vindas entram no uso do dia do número (mesma cadência da Meta Diária / SIM-AUTO-ENVIO).
  assert.match(source("lib/daily-goal-auto.js"), /\[AUTO_SIMULATION_SEND_KIND, AUTO_FOLLOWUP_KIND, VOICE_AUDIO_KINDS\.welcome\]/);
  assert.equal(VOICE_AUDIO_KINDS.welcome, "client_voice_audio_welcome");
  // Tela/API só do admin geral.
  const route = source("app/api/admin/client-voice-audio/route.js");
  assert.equal((route.match(/requireGeneralAdminApi\(request\)/g) || []).length, 3);
});
