// Áudio com a VOZ do dono para o cliente (VOZ-1 — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-23). Regras PURAS (sem rede,
// sem banco, sem segredo), usadas pelo servidor (lib/client-voice-audio.js), pela tela de configuração
// (components/ClientVoiceAudioSettings.jsx) e pelos testes (tests/client-voice-audio.test.mjs).
//
// Dois momentos: (1) junto do envio automático da simulação (SIM-AUTO-ENVIO), logo DEPOIS da mensagem do link ("aí em
// cima tem um link"); (2) boas-vindas do lead novo que entrou pela roleta, pelo WhatsApp do corretor que o recebeu.
// Um modelo de texto por momento e por variante (masculino/feminino/neutro). A variante vem do PRIMEIRO NOME do cliente
// por listas fechadas de nomes; nome fora das listas, ambíguo ou ausente = neutro (nunca chuta). Só modelo APROVADO é
// usado; editar o texto desaprova. Nasce DESLIGADO.

export const CLIENT_VOICE_AUDIO_SETTING_ID = "client_voice_audio";
export const CLIENT_VOICE_AUDIO_FEATURE = "client_voice_audio"; // ai_usage_log.feature

export const VOICE_MOMENTS = Object.freeze(["simulation", "welcome"]);
export const VOICE_VARIANTS = Object.freeze(["male", "female", "neutral"]);
export const VOICE_MOMENT_LABELS = Object.freeze({ simulation: "Junto da simulação", welcome: "Boas-vindas (lead da roleta)" });
export const VOICE_VARIANT_LABELS = Object.freeze({ male: "Masculino", female: "Feminino", neutral: "Neutro (sem nome ou sexo incerto)" });

// Marca das mensagens no Chat (whatsapp_messages.metadata.kind). A das boas-vindas entra na cadência anti-ban do número
// (loadAutoSimulationSendUsageRows, lib/daily-goal-auto.js); a da simulação vai junto do link, que já passou pela trava.
export const VOICE_AUDIO_KINDS = Object.freeze({ simulation: "client_voice_audio_simulation", welcome: "client_voice_audio_welcome" });

export const VOICE_AUDIO_EVENTS = Object.freeze({
  sent: "client_voice_audio_sent",
  failed: "client_voice_audio_failed",
  skipped: "client_voice_audio_skipped"
});

export const VOICE_VARIABLES = Object.freeze(["saudacao", "primeiro_nome_cliente", "primeiro_nome_corretor"]);
export const VOICE_TEMPLATE_MAX_CHARS = 320; // ~15–20 s de fala
// Formato de nota de voz do WhatsApp (Oficial: Ogg/Opus mono, ≤ 512 KB para aparecer como áudio de voz).
export const VOICE_AUDIO_OUTPUT_FORMAT = "opus_48000_32";
export const VOICE_AUDIO_MIME = "audio/ogg; codecs=opus";
export const VOICE_AUDIO_MAX_BYTES = 512 * 1024;
export const VOICE_PREVIEW_NAMES = Object.freeze({ male: "João", female: "Maria", neutral: "" });

// Boas-vindas: só lead que entrou pela roleta agora (1º "assigned" do cadastro, cadastro criado até 24 h antes) e só nas
// primeiras horas — depois disso o corretor já devia ter falado. [COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — A CONFIRMAR]
export const WELCOME_LOOKBACK_MS = 6 * 60 * 60 * 1000;
export const WELCOME_NEW_LEAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TEMPLATE_DEFAULTS = Object.freeze({
  simulation: {
    // Texto do dono (2026-10-23), aprovado por ele na variante masculina.
    male: "{saudacao}, {primeiro_nome_cliente}. Tudo bem, meu amigo? {primeiro_nome_cliente}, ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?",
    female: "{saudacao}, {primeiro_nome_cliente}. Tudo bem, minha amiga? {primeiro_nome_cliente}, ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?",
    // Dono (2026-10-23): o neutro também usa "meu amigo" — aprovado.
    neutral: "{saudacao}, meu amigo! Tudo bem? Ó, aí em cima tem um link da sua simulação. É só clicar que já tem todos os valores ali para você dar uma olhadinha, tá?"
  },
  welcome: {
    male: "{saudacao}, {primeiro_nome_cliente}. Tudo bem, meu amigo? Aqui é o Matheus Machado. Ó, quem vai cuidar do seu atendimento é {primeiro_nome_corretor}, tá? Qualquer dúvida, é só falar aqui mesmo nesse número.",
    female: "{saudacao}, {primeiro_nome_cliente}. Tudo bem, minha amiga? Aqui é o Matheus Machado. Ó, quem vai cuidar do seu atendimento é {primeiro_nome_corretor}, tá? Qualquer dúvida, é só falar aqui mesmo nesse número.",
    neutral: "{saudacao}, meu amigo! Tudo bem? Aqui é o Matheus Machado. Ó, quem vai cuidar do seu atendimento é {primeiro_nome_corretor}, tá? Qualquer dúvida, é só falar aqui mesmo nesse número."
  }
});

// Aprovados pelo dono junto do texto (2026-10-23): simulação masculina e neutra. Os demais nascem pendentes.
const PRE_APPROVED = Object.freeze({ simulation: { male: "2026-10-23T00:00:00-03:00", neutral: "2026-10-23T00:00:00-03:00" } });

export function defaultTemplateText(moment, variant) {
  return TEMPLATE_DEFAULTS[moment]?.[variant] || "";
}

export function defaultClientVoiceAudioSettings() {
  const templates = {};
  for (const moment of VOICE_MOMENTS) {
    templates[moment] = {};
    for (const variant of VOICE_VARIANTS) {
      const text = defaultTemplateText(moment, variant);
      const approvedAt = PRE_APPROVED[moment]?.[variant] || null;
      templates[moment][variant] = { text, approvedText: approvedAt ? text : "", approvedAt };
    }
  }
  return { enabled: false, enabledAt: null, voiceId: "", templates };
}

function collapse(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Linha gravada (crm_settings.setting_value) + padrões. Campo faltando = padrão; nunca liga sozinho. */
export function normalizeClientVoiceAudioSettings(raw = {}) {
  const base = defaultClientVoiceAudioSettings();
  const source = raw && typeof raw === "object" ? raw : {};
  const templates = {};
  for (const moment of VOICE_MOMENTS) {
    templates[moment] = {};
    for (const variant of VOICE_VARIANTS) {
      const saved = source.templates?.[moment]?.[variant];
      const fallback = base.templates[moment][variant];
      templates[moment][variant] = saved && typeof saved.text === "string"
        ? { text: collapse(saved.text), approvedText: collapse(saved.approvedText || ""), approvedAt: saved.approvedAt || null }
        : fallback;
    }
  }
  return {
    enabled: source.enabled === true,
    enabledAt: source.enabled === true ? source.enabledAt || null : null,
    voiceId: typeof source.voiceId === "string" ? source.voiceId.trim() : "",
    templates
  };
}

export function isTemplateApproved(entry) {
  const text = collapse(entry?.text);
  return Boolean(text) && collapse(entry?.approvedText) === text;
}

// ID de voz da ElevenLabs: só letras e números (mesma regra de isElevenLabsVoiceId, lib/henry-voice-providers.mjs).
export function isVoiceIdValid(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{10,40}$/.test(value);
}

/** Erro de validação do texto-modelo (frase para a tela) ou null. */
export function templateError(moment, variant, text) {
  const value = collapse(text);
  if (!value) return "Escreva o texto do áudio.";
  if (value.length > VOICE_TEMPLATE_MAX_CHARS) return `Texto longo demais: até ${VOICE_TEMPLATE_MAX_CHARS} caracteres (cerca de 15 segundos de fala).`;
  const used = [...value.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]);
  const unknown = used.find((name) => !VOICE_VARIABLES.includes(name));
  if (unknown !== undefined) return `Variável desconhecida: {${unknown}}. Use só {saudacao}, {primeiro_nome_cliente} e {primeiro_nome_corretor}.`;
  if (/[{}]/.test(value.replace(/\{[^{}]*\}/g, ""))) return "Chave { } sem fechar no texto.";
  if (variant === "neutral" && used.includes("primeiro_nome_cliente")) return "O modelo neutro é usado quando não há nome confiável: não use {primeiro_nome_cliente} nele.";
  if (/matheus machado im[oó]veis/i.test(value)) return "Use o nome oficial: Matheus Machado Corretor de Imóveis.";
  if (moment === "welcome" && !used.includes("primeiro_nome_corretor")) return "As boas-vindas apresentam o corretor: use {primeiro_nome_corretor}.";
  return null;
}

/**
 * Aplica uma alteração da tela. patch = { enabled?, voiceId?, template?: { moment, variant, text }, approve?: { moment, variant } }.
 * Editar o texto DESAPROVA (approvedText fica com o texto antigo, então não bate). Devolve { settings } ou { error }.
 */
export function applyClientVoiceAudioPatch(current, patch = {}, { nowIso = new Date().toISOString() } = {}) {
  const settings = normalizeClientVoiceAudioSettings(current);
  if (patch.voiceId !== undefined) {
    const voiceId = String(patch.voiceId || "").trim();
    if (voiceId && !isVoiceIdValid(voiceId)) return { error: "ID de voz inválido: use o voice_id da ElevenLabs (só letras e números)." };
    settings.voiceId = voiceId;
  }
  if (patch.template) {
    const { moment, variant } = patch.template;
    if (!VOICE_MOMENTS.includes(moment) || !VOICE_VARIANTS.includes(variant)) return { error: "Modelo inválido." };
    const text = collapse(patch.template.text);
    const error = templateError(moment, variant, text);
    if (error) return { error };
    const entry = settings.templates[moment][variant];
    settings.templates[moment][variant] = text === entry.text ? entry : { ...entry, text, approvedAt: isTemplateApproved({ text, approvedText: entry.approvedText }) ? entry.approvedAt : null };
  }
  if (patch.approve) {
    const { moment, variant } = patch.approve;
    if (!VOICE_MOMENTS.includes(moment) || !VOICE_VARIANTS.includes(variant)) return { error: "Modelo inválido." };
    const entry = settings.templates[moment][variant];
    const error = templateError(moment, variant, entry.text);
    if (error) return { error };
    settings.templates[moment][variant] = { ...entry, approvedText: entry.text, approvedAt: nowIso };
  }
  if (patch.enabled !== undefined) {
    const enabled = patch.enabled === true;
    if (enabled && !isVoiceIdValid(settings.voiceId)) return { error: "Informe o voice_id da voz clonada antes de ligar." };
    if (enabled && !settings.enabled) settings.enabledAt = nowIso; // só daqui para frente
    if (!enabled) settings.enabledAt = null;
    settings.enabled = enabled;
  }
  return { settings };
}

// ---------- Nome e variante ----------

function plain(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Listas FECHADAS de primeiros nomes comuns no Brasil. Nome fora das listas = neutro. Ficam de fora, de propósito, os
// nomes usados pelos dois sexos (ex.: Darci, Juraci, Jaci, Iraci, Ariel, Eli, Cris, Dani, Gabi, Val, Lu, Kim, Sasha).
const MALE_NAMES = new Set(`
adao adilson adriano adriel afonso agnaldo airton alan alberto alessandro alex alexandre alexsandro alfredo alisson almir
aloisio altair alvaro amauri anderson andre angelo anselmo antonio arlindo armando arnaldo arthur artur augusto aurelio
benedito benjamin bento bernardo bruno caio carlos cassio cauan caua celio cesar claudio cleber cleiton cristiano cristian
daniel danilo davi david denis diego diogo domingos douglas edgar edilson edinaldo edmilson edson eduardo elias
eliseu emanuel emerson enzo erick erico ernesto euclides evandro everaldo everton fabiano fabio fabricio felipe fernando
filipe flavio francisco frederico gabriel geraldo gerson gilberto gilmar gilson giovani giovanni gustavo heitor helio
henrique hugo humberto igor isaac isaias ivan jaime jair jairo januario jefferson jeferson joao joaquim jonas jonatan
jonathan jorge jose josue juan julio juliano junior kaique kaua kelvin laercio lauro leandro leonardo leonel lucas luciano
luis luiz manoel manuel marcelo marcio marco marcos mario marlon mateus matheus mauricio mauro max maximiliano miguel milton
moises murilo natan nathan nelson newton nicolas nilson nilton norberto octavio odair olavo osmar oswaldo osvaldo otavio
paulo pedro rafael raimundo ramon raul reginaldo reinaldo renan renato ricardo rivaldo roberto robson rodolfo rodrigo
rogerio romario ronaldo rosivaldo rubens ruan rui samuel sandro saulo sebastiao sergio severino sidnei silvio simao
tadeu thiago tiago tomas valdir valmir vanderlei vicente victor vinicius vitor wagner waldir walter washington wellington
wesley william willian wilson yago yuri zeca
`.split(/\s+/).filter(Boolean));

const FEMALE_NAMES = new Set(`
adriana agatha alessandra alice aline amanda ana andrea andreia andressa angela angelica antonia aparecida barbara beatriz
bianca bruna camila carla carolina caroline catarina cecilia celia cintia clara claudia cleide cristiane cristina daiane
daniela danielle debora denise diana eduarda elaine eliana eliane elisa elisangela eloisa emanuele emily erica estela
ester eva fabiana fatima fernanda flavia francisca gabriela gabrielle geovana gilmara giovana giovanna gisele glaucia
graziela helena heloisa ingrid isabel isabela isabella isadora ivone jaqueline jessica joana josiane julia juliana
jussara karen karina katia keila kelly lara larissa laura leticia lilian livia lorena luana lucia luciana luiza luisa
maira marcela marcia margarete maria mariana marilene marina marta mayara melissa michele michelle milena miriam monica
nadia natalia nathalia nicole nilza noemi olivia paloma pamela patricia paula priscila quezia rafaela raquel rebeca regina
renata rita roberta rosa rosana rosangela rose rosimeire sabrina samara sandra sara sarah silvana silvia simone sofia
solange sonia stefany stephanie suelen susana tais tamires tania tatiana tereza teresa thais valeria vanessa vera
veronica vitoria viviane yasmin
`.split(/\s+/).filter(Boolean));

/** Primeiro nome "de pessoa" (letras, 2 a 20), com a 1ª letra maiúscula. Vazio quando não serve para falar. */
export function speakableFirstName(fullName) {
  const token = collapse(fullName).split(" ")[0] || "";
  if (!/^\p{L}[\p{L}'’-]{1,19}$/u.test(token)) return "";
  if (["cliente", "teste", "test", "sem", "usuario", "usuário", "anonimo", "anônimo"].includes(token.toLowerCase())) return "";
  const lower = token.toLocaleLowerCase("pt-BR");
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

/** "male" | "female" | null (fora das listas = null: na dúvida, nunca chuta). */
export function genderFromFirstName(firstName) {
  const key = plain(firstName);
  if (!key) return null;
  if (MALE_NAMES.has(key)) return "male";
  if (FEMALE_NAMES.has(key)) return "female";
  return null;
}

/** Variante e nome falado para o cliente. Sem nome ou sexo incerto = neutro. */
export function pickVoiceVariant(fullName) {
  const firstName = speakableFirstName(fullName);
  const gender = genderFromFirstName(firstName);
  return gender ? { variant: gender, firstName } : { variant: "neutral", firstName: "" };
}

/** Troca as variáveis. Sobra de variável (não deveria acontecer: validado) é removida, nunca falada. */
export function renderVoiceTemplate(text, { saudacao = "", cliente = "", corretor = "" } = {}) {
  return collapse(String(text || "")
    .replace(/\{saudacao\}/g, saudacao)
    .replace(/\{primeiro_nome_cliente\}/g, cliente)
    .replace(/\{primeiro_nome_corretor\}/g, corretor)
    .replace(/\{[^{}]*\}/g, ""));
}

/**
 * Texto final do áudio, ou o motivo de pular. Ordem: desligado → sem voice_id → variante → modelo aprovado → nome do
 * corretor (boas-vindas). Resultado: { ok: true, text, variant } | { ok: false, reason }.
 */
export function planVoiceAudio({ settings, moment, clientName = "", brokerName = "", greeting = "Olá" } = {}) {
  const config = normalizeClientVoiceAudioSettings(settings);
  if (!config.enabled) return { ok: false, reason: "desligado" };
  if (!isVoiceIdValid(config.voiceId)) return { ok: false, reason: "sem_voice_id" };
  if (!VOICE_MOMENTS.includes(moment)) return { ok: false, reason: "momento_invalido" };
  const { variant, firstName } = pickVoiceVariant(clientName);
  const entry = config.templates[moment][variant];
  if (!isTemplateApproved(entry)) return { ok: false, reason: "modelo_nao_aprovado", variant };
  const corretor = speakableFirstName(brokerName);
  if (moment === "welcome" && !corretor) return { ok: false, reason: "sem_nome_do_corretor", variant };
  return { ok: true, variant, text: renderVoiceTemplate(entry.text, { saudacao: greeting, cliente: firstName, corretor }) };
}

export function voiceAudioClaimKey(moment, registrationId) {
  return `voice-audio:${moment}:${registrationId}`;
}

/** Áudio Ogg (o Oficial e o WhatsApp só tocam como nota de voz em Ogg/Opus): confere os bytes "OggS" do começo. */
export function isOggAudio(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return view.length > 4 && view[0] === 0x4f && view[1] === 0x67 && view[2] === 0x67 && view[3] === 0x53;
}

/**
 * Boas-vindas: o lead entrou AGORA pela roleta? firstAssigned = 1ª linha "assigned" de lead_distribution_history do
 * cadastro; registrationCreatedAt = criação do cadastro; enabledAt = quando o dono ligou (nada retroativo).
 */
export function isNewRouletteLead({ firstAssignedAt, registrationCreatedAt, enabledAt, nowMs = Date.now() } = {}) {
  const assigned = Date.parse(firstAssignedAt || "");
  const created = Date.parse(registrationCreatedAt || "");
  const enabled = Date.parse(enabledAt || "");
  if (!Number.isFinite(assigned) || !Number.isFinite(created) || !Number.isFinite(enabled)) return false;
  if (assigned < enabled) return false;
  if (nowMs - assigned > WELCOME_LOOKBACK_MS) return false;
  return assigned - created <= WELCOME_NEW_LEAD_MAX_AGE_MS;
}

const REASON_TEXT = {
  desligado: "áudio com voz desligado",
  sem_voice_id: "voz clonada (voice_id) não configurada",
  modelo_nao_aprovado: "modelo de texto ainda não aprovado",
  sem_nome_do_corretor: "corretor sem nome cadastrado",
  sem_chave: "chave da ElevenLabs não configurada",
  creditos_esgotados: "créditos da ElevenLabs esgotados",
  voz_indisponivel: "a ElevenLabs não gerou o áudio",
  formato_invalido: "a ElevenLabs não devolveu áudio no formato de nota de voz",
  falha_envio: "o WhatsApp recusou ou não confirmou o envio",
  nao_contactar: "cliente em Não contactar (telefone bloqueado)",
  arquivado: "cliente arquivado",
  particular: "contato marcado como Particular",
  sem_telefone: "cadastro sem telefone válido",
  telefone_da_equipe: "telefone de alguém da equipe",
  nao_veio_da_roleta: "o responsável atual não recebeu o cliente pela roleta",
  corretor_ja_falou: "o corretor já falou com o cliente",
  simulacao_enviada_pelo_corretor: "o cliente já recebeu a simulação (com áudio) pelo WhatsApp do corretor"
};

export function voiceAudioReasonText(reason) {
  return REASON_TEXT[reason] || String(reason || "motivo desconhecido").replace(/_/g, " ");
}

export function voiceAudioJourneyText(outcome, { moment = "", reason = "" } = {}) {
  const what = moment === "welcome" ? "Áudio de boas-vindas" : "Áudio da simulação";
  if (outcome === "sent") return `${what} enviado automaticamente (voz do Matheus)`;
  if (outcome === "failed") return `${what} não enviado: ${voiceAudioReasonText(reason)}. Não será reenviado sozinho.`;
  return `${what} não enviado: ${voiceAudioReasonText(reason)}.`;
}
