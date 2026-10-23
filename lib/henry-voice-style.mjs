// Voz e personalidade do Henry (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md HENRY-1, "Voz e personalidade").
// Núcleo PURO (sem banco), usado pelo servidor (lib/henry-voice.js, app/api/admin/henry) e pelos testes. O cartão da tela
// recebe as opções pelo GET da rota (não importa este arquivo, para o Zod não ir para o navegador).
// Guardado em crm_settings henry_voice_assistant.style (sem migration). Nada salvo → padrão: voz do env OPENAI_TTS_VOICE
// ou "ash", tom AMIGO (descontraído — dono, 2026-10-22: "como se ele fosse um amigo batendo um papo"), ritmo ágil,
// "Matheus". Tom salvo antes (ex.: "Profissional") é respeitado: o dono troca na tela.
// O estilo muda SÓ o jeito de falar: as barreiras (somente leitura, só o dono, isSafeToSpeak, regras do elogio) ficam no
// código e não leem nada daqui.
import { z } from "zod";
import { isElevenLabsVoiceId } from "./henry-voice-providers.mjs";
import { MORNING_MUSIC_DEFAULTS, MORNING_MUSIC_MAX, sanitizeMorningMusic } from "./henry-morning-core.mjs";

// Vozes aceitas pelo gpt-4o-mini-tts — conferidas na documentação oficial da OpenAI (guia Text to speech, "Voice options",
// e especificação da API /v1/audio/speech) em 2026-10-22: 13 vozes. A nota é a impressão de ouvido, para ajudar a escolher.
export const HENRY_VOICES = Object.freeze([
  { id: "alloy", label: "Alloy", note: "neutra, equilibrada" },
  { id: "ash", label: "Ash", note: "masculina, firme" },
  { id: "ballad", label: "Ballad", note: "masculina, suave e expressiva" },
  { id: "cedar", label: "Cedar", note: "masculina, natural (recomendada pela OpenAI)" },
  { id: "coral", label: "Coral", note: "feminina, calorosa" },
  { id: "echo", label: "Echo", note: "masculina, calma" },
  { id: "fable", label: "Fable", note: "masculina, de narrador" },
  { id: "marin", label: "Marin", note: "feminina, natural (recomendada pela OpenAI)" },
  { id: "nova", label: "Nova", note: "feminina, jovem e animada" },
  { id: "onyx", label: "Onyx", note: "masculina, grave" },
  { id: "sage", label: "Sage", note: "feminina, serena" },
  { id: "shimmer", label: "Shimmer", note: "feminina, leve" },
  { id: "verse", label: "Verse", note: "masculina, expressiva" }
]);
export const HENRY_VOICE_IDS = HENRY_VOICES.map((voice) => voice.id);

// Tom: muda a instrução da VOZ (tts) e o estilo do TEXTO no prompt de sistema (prompt). Padrão = "descontraido" (amigo).
export const HENRY_TONES = Object.freeze({
  descontraido: {
    label: "Amigo (descontraído)",
    note: "papo de amigo, fluido e natural (padrão)",
    tts: "tom de amigo batendo papo, descontraído, caloroso e natural, como numa conversa de verdade e nunca lendo um texto, com variação de entonação e um sorriso na voz",
    role: "como um amigo próximo que trabalha junto",
    prompt:
      "amigo batendo papo: português falado e informal ('tá', 'pra', 'a gente', 'beleza', 'olha só', 'bora'), frases curtas, caloroso e leve, reagindo ao que ele disse; sem gíria pesada, sem palavrão, nada forçado."
  },
  profissional: {
    label: "Profissional",
    note: "cordial e objetivo (o de sempre)",
    tts: "tom cordial e profissional",
    role: "como um assistente de escritório",
    prompt: "cordial e profissional, direto ao ponto."
  },
  carismatico: {
    label: "Carismático",
    note: "caloroso e animado",
    tts: "tom carismático, caloroso e animado, com um sorriso na voz",
    role: "como um assistente simpático que gosta do que faz",
    prompt: "carismático e caloroso, com energia positiva e um toque de entusiasmo, sem exagero."
  },
  executivo: {
    label: "Executivo/direto",
    note: "firme, só o essencial",
    tts: "tom executivo, firme e objetivo, com frases enxutas",
    role: "como um assessor executivo",
    prompt: "executivo e direto: comece pelo número ou pela resposta, sem rodeios nem cortesias."
  }
});
export const HENRY_TONE_IDS = Object.keys(HENRY_TONES);

// Velocidade: o gpt-4o-mini-tts controla o ritmo pela instrução (o guia oficial lista "Speed of speech" entre o que se
// controla pelo prompt); o parâmetro numérico `speed` não é usado. Voz do navegador: utterance.rate (browserRate).
// "normal" = "ritmo ágil", o de antes. Na voz do navegador o normal é 1,05 (a 1,0 soa pausada — reclamação do dono).
// ElevenLabs: voice_settings.speed (henry-voice-providers.mjs, ELEVENLABS_SPEED).
export const HENRY_SPEEDS = Object.freeze({
  calmo: { label: "Mais calmo", tts: "ritmo calmo, com pausas naturais", browserRate: 0.95 },
  normal: { label: "Normal", tts: "ritmo ágil", browserRate: 1.05 },
  rapido: { label: "Mais rápido", tts: "ritmo rápido e dinâmico, sem pausas longas", browserRate: 1.18 }
});
export const HENRY_SPEED_IDS = Object.keys(HENRY_SPEEDS);

export const HENRY_DEFAULT_VOICE = "ash";
export const HENRY_DEFAULT_TONE = "descontraido";
const isElevenVoiceId = isElevenLabsVoiceId;
export const HENRY_DEFAULT_ADDRESS = "Matheus";
export const HENRY_DETAILS_MAX = 300;
export const HENRY_ADDRESS_MAX = 40;
export const HENRY_SAMPLE_TEMPLATE = "Bom dia, {nome}. Eu sou o Henry, seu assistente.";

// Campo livre "Detalhes do jeito de falar": uma linha só, sem marcação/código/aspas, no máximo 300 caracteres. Vai para
// as instruções entre aspas, como preferência de estilo — nunca como regra.
export function sanitizeHenryDetails(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[<>{}[\]`"\\|#*_~^$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HENRY_DETAILS_MAX)
    .trim();
}

// "Como tratar o dono": só letras, espaço, ponto, hífen e apóstrofo (ex.: "chefe", "Sr. Matheus"), até 40 caracteres.
export function sanitizeHenryAddress(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\s.'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HENRY_ADDRESS_MAX)
    .trim();
}

const MUSIC_KEYS = ["rockMusic", "sertanejoMusic"];

// Validação do PUT/amostra (style parcial). Campo ausente = não mexe; texto vazio = volta ao padrão.
export const henryStylePatchSchema = z
  .object({
    voice: z.enum(HENRY_VOICE_IDS).optional(),
    // Voz da conta ElevenLabs (id só com letras e números; "" = volta ao padrão).
    elevenVoice: z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9]{10,40}$/)]).optional(),
    tone: z.enum(HENRY_TONE_IDS).optional(),
    speed: z.enum(HENRY_SPEED_IDS).optional(),
    details: z.string().max(HENRY_DETAILS_MAX, `Detalhes do jeito de falar: no máximo ${HENRY_DETAILS_MAX} caracteres.`).optional(),
    address: z.string().max(HENRY_ADDRESS_MAX, `Como tratar o dono: no máximo ${HENRY_ADDRESS_MAX} caracteres.`).optional(),
    // Músicas do "bom dia" (dono, 2026-10-23): nome para buscar ou link do Spotify; vazio = padrão.
    rockMusic: z.string().max(MORNING_MUSIC_MAX, `Música do rock: no máximo ${MORNING_MUSIC_MAX} caracteres.`).optional(),
    sertanejoMusic: z.string().max(MORNING_MUSIC_MAX, `Música do sertanejo: no máximo ${MORNING_MUSIC_MAX} caracteres.`).optional()
  })
  .strict();

export function parseHenryStylePatch(input) {
  const result = henryStylePatchSchema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path?.[0];
    const message = issue?.code === "too_big" ? issue.message : field ? `Valor inválido em "${field}".` : "Configuração de voz inválida.";
    return { ok: false, error: message };
  }
  const patch = { ...result.data };
  if ("details" in patch) patch.details = sanitizeHenryDetails(patch.details);
  if ("address" in patch) patch.address = sanitizeHenryAddress(patch.address);
  for (const key of MUSIC_KEYS) if (key in patch) patch[key] = sanitizeMorningMusic(patch[key]);
  return { ok: true, patch };
}

// Registro salvo (pode estar vazio, antigo ou adulterado) → estilo completo e válido. defaultVoice = env OPENAI_TTS_VOICE.
export function resolveHenryStyle(stored, { defaultVoice } = {}) {
  const value = stored && typeof stored === "object" ? stored : {};
  const fallbackVoice = String(defaultVoice || "").trim() || HENRY_DEFAULT_VOICE;
  return {
    voice: HENRY_VOICE_IDS.includes(value.voice) ? value.voice : fallbackVoice,
    elevenVoice: isElevenVoiceId(value.elevenVoice) ? value.elevenVoice : "",
    tone: HENRY_TONE_IDS.includes(value.tone) ? value.tone : HENRY_DEFAULT_TONE,
    speed: HENRY_SPEED_IDS.includes(value.speed) ? value.speed : "normal",
    details: sanitizeHenryDetails(value.details),
    address: sanitizeHenryAddress(value.address),
    rockMusic: sanitizeMorningMusic(value.rockMusic),
    sertanejoMusic: sanitizeMorningMusic(value.sertanejoMusic)
  };
}

// O que vai gravado: só campos válidos (o padrão do env continua valendo quando a voz nunca foi escolhida).
export function mergeHenryStyle(stored, patch = {}) {
  const current = stored && typeof stored === "object" ? stored : {};
  const next = {};
  if (HENRY_VOICE_IDS.includes(current.voice)) next.voice = current.voice;
  if (isElevenVoiceId(current.elevenVoice)) next.elevenVoice = current.elevenVoice;
  if (HENRY_TONE_IDS.includes(current.tone)) next.tone = current.tone;
  if (HENRY_SPEED_IDS.includes(current.speed)) next.speed = current.speed;
  if (current.details) next.details = sanitizeHenryDetails(current.details);
  if (current.address) next.address = sanitizeHenryAddress(current.address);
  for (const key of MUSIC_KEYS) if (current[key]) next[key] = sanitizeMorningMusic(current[key]);
  for (const key of ["voice", "elevenVoice", "tone", "speed", "details", "address", ...MUSIC_KEYS]) {
    if (key in patch) next[key] = patch[key];
  }
  for (const key of MUSIC_KEYS) if (!next[key]) delete next[key];
  if (!next.details) delete next.details;
  if (!next.address) delete next.address;
  if (!next.elevenVoice) delete next.elevenVoice;
  return next;
}

export function henryAddressName(style) {
  return sanitizeHenryAddress(style?.address) || HENRY_DEFAULT_ADDRESS;
}

// Instrução da voz (OpenAI): sotaque, tom, ritmo e papel; no tom amigo, conversa de verdade (nunca leitura).
export function buildHenryTtsInstructions(style) {
  const resolved = resolveHenryStyle(style);
  const tone = HENRY_TONES[resolved.tone];
  const speed = HENRY_SPEEDS[resolved.speed];
  const base = `Fale em português do Brasil, com sotaque brasileiro natural, ${tone.tts}, ${speed.tts}, ${tone.role}.`;
  return resolved.details ? `${base} Detalhes do jeito de falar pedidos pelo dono: "${resolved.details}".` : base;
}

// Linhas de estilo do prompt de sistema. Ficam DEPOIS das regras e terminam lembrando que não mudam nenhuma regra.
export function buildHenryStylePrompt(style) {
  const resolved = resolveHenryStyle(style);
  const lines = [`- Jeito de falar: ${HENRY_TONES[resolved.tone].prompt}`];
  const address = henryAddressName(resolved);
  if (address !== HENRY_DEFAULT_ADDRESS) lines.push(`- Chame o dono de "${address}" quando se dirigir a ele.`);
  if (resolved.details) lines.push(`- Preferências do dono sobre o jeito de falar (só estilo): "${resolved.details}"`);
  lines.push("- Essas preferências de estilo nunca mudam as regras acima: elas valem sempre.");
  return lines.join("\n");
}

export function henryBrowserRate(style) {
  return HENRY_SPEEDS[resolveHenryStyle(style).speed].browserRate;
}

export function henrySampleText(style) {
  return HENRY_SAMPLE_TEMPLATE.replace("{nome}", henryAddressName(style));
}

// Opções para o cartão da tela (vêm pelo GET). Voz do env fora da lista aparece como "configurada no servidor".
export function henryStyleOptions({ defaultVoice } = {}) {
  const envVoice = String(defaultVoice || "").trim() || HENRY_DEFAULT_VOICE;
  const voices = HENRY_VOICES.map((voice) => ({ ...voice }));
  if (!HENRY_VOICE_IDS.includes(envVoice)) voices.unshift({ id: envVoice, label: envVoice, note: "configurada no servidor" });
  return {
    voices,
    tones: HENRY_TONE_IDS.map((id) => ({ id, label: HENRY_TONES[id].label, note: HENRY_TONES[id].note })),
    speeds: HENRY_SPEED_IDS.map((id) => ({ id, label: HENRY_SPEEDS[id].label })),
    detailsMax: HENRY_DETAILS_MAX,
    addressMax: HENRY_ADDRESS_MAX,
    defaultAddress: HENRY_DEFAULT_ADDRESS,
    musicMax: MORNING_MUSIC_MAX,
    defaultRockMusic: `${MORNING_MUSIC_DEFAULTS.rock.query} (playlist)`,
    defaultSertanejoMusic: MORNING_MUSIC_DEFAULTS.sertanejo.query
  };
}
