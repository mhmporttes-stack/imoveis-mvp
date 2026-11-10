// FLUXO DO ANÚNCIO NO NÚMERO OFICIAL (Cloud API) — regra do dono, 2026-11-10 (docs/BUSINESS_RULES.md WA-40).
// PURO e testado em tests/official-ad-flow-core.test.mjs. Quem lê o banco e envia é lib/official-ad-flow.js.
// Tudo nasce DESLIGADO: sem linha em crm_settings (OFFICIAL_AD_FLOW_SETTING_ID) o fluxo não existe.

import { getTimeGreeting } from "./daily-report-range.mjs";
import { firstName } from "./whatsapp-flow-core.mjs";

export const OFFICIAL_AD_FLOW_SETTING_ID = "official_ad_flow";
export const OFFICIAL_AD_FLOW_ROTATION_ID = "official_ad_flow_rotation";
export const OFFICIAL_AD_FLOW_KIND = "official_ad_flow";
export const OFFICIAL_AD_FLOW_TABLE = "official_ad_flow_sessions";
export const TIME_ZONE = "America/Sao_Paulo";

export const STEPS = Object.freeze({ greeted: "greeted", location: "location", values: "values" });
export const STATUSES = Object.freeze({
  active: "active",
  offering: "offering", // oferta ao próximo da roleta (lib/roulette-offer.js) em andamento — vale dia e noite (dono, 2026-11-10)
  offerExhausted: "offer_exhausted", // ninguém aceitou: o cliente segue segurado com o dono (WA-18)
  transferred: "transferred",
  held: "held_by_owner", // lista de participantes vazia: o cliente continua com o dono (WA-18)
  finished: "finished", // cadastro concluído
  stopped: "stopped" // fora do fluxo (Não contactar, equipe, Particular…)
});
export const LIVE_STATUSES = Object.freeze([STATUSES.active, STATUSES.offering]);

export const REPLY_IDS = Object.freeze({ location: "oaf:loc", values: "oaf:val", associate: "oaf:assoc" });
// Meta: título de botão de resposta tem no máximo 20 caracteres ("Falar com um associado" tem 22).
export const BUTTON_TITLES = Object.freeze({ location: "Localização", values: "Valores", associate: "Falar com associado" });
export const MAPS_BUTTON_LABEL = "Google Maps";
export const VALUES_BUTTON_LABEL = "Descobrir meu poder";
export const VALUES_LINK_TITLE = "Descubra seu poder de compra";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  remindAfterMin: 2,
  transferAfterMin: 3,
  windowStartHour: 7, // horário de atendimento 07:00–20:00: só decide a mensagem "a partir das 8h" quando NINGUÉM aceita a oferta (dono, 2026-11-10)
  windowEndHour: 20,
  offerTimeoutSec: 60, // prazo de cada corretor para responder "sim"/"ok" à oferta
  generalRoulette: { enabled: false, askInsideWindow: false }, // 2º interruptor: roleta geral (ainda sem ligação ao sorteio)
  participants: [], // [{ userId, enabled }] na ordem do rodízio
  locationPropertyName: "Ecovillage", // empreendimento da imagem/mapa da Localização
  locationImageUrl: "", // opcional: sobrepõe a foto do empreendimento
  mapsUrl: "", // opcional: sobrepõe a busca no Google Maps
  suggestedPropertyNames: ["Ecovillage", "Terras de SP"] // imóveis sugeridos na apresentação (MCMV)
});

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
};

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);

/** Configuração vinda do banco (ou null/lixo) → configuração válida. Sem linha = DESLIGADO. */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const seen = new Set();
  const participants = (Array.isArray(source.participants) ? source.participants : [])
    .map((item) => ({ userId: cleanText(item?.userId, 64), enabled: item?.enabled !== false }))
    .filter((item) => item.userId && !seen.has(item.userId) && seen.add(item.userId));
  const names = (Array.isArray(source.suggestedPropertyNames) ? source.suggestedPropertyNames : DEFAULT_CONFIG.suggestedPropertyNames)
    .map((name) => cleanText(name, 80)).filter(Boolean).slice(0, 6);
  const start = clampInt(source.windowStartHour, 0, 23, DEFAULT_CONFIG.windowStartHour);
  const end = clampInt(source.windowEndHour, 1, 24, DEFAULT_CONFIG.windowEndHour);
  return {
    enabled: source.enabled === true,
    remindAfterMin: clampInt(source.remindAfterMin, 1, 30, DEFAULT_CONFIG.remindAfterMin),
    transferAfterMin: clampInt(source.transferAfterMin, 1, 30, DEFAULT_CONFIG.transferAfterMin),
    windowStartHour: start < end ? start : DEFAULT_CONFIG.windowStartHour,
    windowEndHour: start < end ? end : DEFAULT_CONFIG.windowEndHour,
    offerTimeoutSec: clampInt(source.offerTimeoutSec, 15, 600, DEFAULT_CONFIG.offerTimeoutSec),
    generalRoulette: { enabled: source.generalRoulette?.enabled === true, askInsideWindow: source.generalRoulette?.askInsideWindow === true },
    participants,
    locationPropertyName: cleanText(source.locationPropertyName ?? DEFAULT_CONFIG.locationPropertyName, 80),
    locationImageUrl: /^https:\/\//i.test(cleanText(source.locationImageUrl, 600)) ? cleanText(source.locationImageUrl, 600) : "",
    mapsUrl: /^https:\/\//i.test(cleanText(source.mapsUrl, 600)) ? cleanText(source.mapsUrl, 600) : "",
    suggestedPropertyNames: names
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Saudação e tratamento ("minha amiga"/"meu amigo" só quando o primeiro nome é CLARAMENTE feminino/masculino)
// ---------------------------------------------------------------------------------------------------------------------

const FEMALE = new Set(`aline amanda ana andreia andressa angela angelica bianca bruna camila camille carla carolina caroline cassia catarina cecilia
claudia cristiane cristina daiana daiane daniela debora denise dienifer diana eduarda elaine eliane elisa fabiana fabiola fernanda flavia francisca gabriela
giovana giovanna helena heloisa isabela isabella isadora jaqueline jessica joana julia juliana karen karina kelly larissa laura leticia lidia livia luana
luciana luisa luiza marcela marcia maria mariana marina marta mayara mayumi michele milena monica natalia nathalia patricia paula priscila priscilla rafaela
raquel rebeca renata roberta rosana sabrina samara sandra sara sarah silvia simone sofia sonia stefani stephanie suelen tais tatiana tereza thais thaina vanessa
vera viviane yasmin yara`.split(/\s+/));

const MALE = new Set(`adriano alan alessandro alexandre alisson anderson andre antonio arthur augusto benedito bernardo bruno caio carlos cauan cesar claudio
cleber daniel danilo davi diego diogo douglas edson eduardo elias emanuel enzo erick fabio felipe fernando filipe flavio francisco frederico gabriel gilberto
guilherme gustavo heitor henrique hugo igor ismael italo ivan jair joao joaquim jonas jorge jose julio kaique leandro leonardo lucas luciano luis luiz marcelo
marcio marcos mateus mathias matheus mauricio miguel murilo nelson nicolas otavio paulo pedro rafael raimundo renan renato ricardo roberto rodrigo rogerio
ronaldo samuel sergio thiago tiago valter vicente victor vinicius vitor wagner wallace wellington wesley william wilson`.split(/\s+/));

const normalizeName = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "female" | "male" | null — só para o primeiro nome de pessoa (emoji, apelido, empresa ou nome fora das listas = null). */
export function inferFirstNameGender(profileName) {
  const first = firstName(profileName);
  if (!first) return null;
  const key = normalizeName(first);
  if (FEMALE.has(key) && !MALE.has(key)) return "female";
  if (MALE.has(key) && !FEMALE.has(key)) return "male";
  return null;
}

/** "Ana" a partir de "ANA PAULA" / "ana" — "" quando não parece nome de pessoa. */
export function displayFirstName(profileName) {
  const first = firstName(profileName);
  return first ? first.charAt(0).toLocaleUpperCase("pt-BR") + first.slice(1).toLocaleLowerCase("pt-BR") : "";
}

/** "Bom dia, minha amiga Ana!" | "Boa tarde, Ana!" | "Boa noite!" — saudação pelo fuso de São Paulo (fonte única getTimeGreeting). */
export function buildGreeting(profileName, now = new Date()) {
  const greeting = getTimeGreeting(now);
  const name = displayFirstName(profileName);
  const gender = inferFirstNameGender(profileName);
  if (!name) return `${greeting}!`;
  if (gender === "female") return `${greeting}, minha amiga ${name}!`;
  if (gender === "male") return `${greeting}, meu amigo ${name}!`;
  return `${greeting}, ${name}!`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Janela de transferência (07:00–21:00 em São Paulo)
// ---------------------------------------------------------------------------------------------------------------------

function saoPauloParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(map.hour), minute: Number(map.minute) };
}

export function isWithinTransferWindow(now = new Date(), config = DEFAULT_CONFIG) {
  const { hour } = saoPauloParts(now);
  return hour >= config.windowStartHour && hour < config.windowEndHour;
}

/** "hoje" (antes da abertura) ou "amanhã" (depois do fechamento) — para o aviso honesto ao cliente. */
export function nextOpeningDay(now = new Date(), config = DEFAULT_CONFIG) {
  return saoPauloParts(now).hour < config.windowStartHour ? "hoje" : "amanhã";
}

// ---------------------------------------------------------------------------------------------------------------------
// Rodízio entre os participantes configurados
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Próximo participante do rodízio. `participants` na ordem configurada ([{ userId, enabled }]); `eligibleIds` = quem pode
 * receber AGORA (ativo, WhatsApp conectado); `lastPickedUserId` = quem recebeu por último. Pula desligado/inelegível sem
 * perder o lugar. Nenhum elegível → null.
 */
export function orderParticipants({ participants = [], eligibleIds = [], lastPickedUserId = "" } = {}) {
  const eligible = new Set(eligibleIds);
  const list = participants.filter((item) => item.enabled !== false);
  if (!list.length) return [];
  const start = list.findIndex((item) => item.userId === lastPickedUserId);
  const ordered = [];
  for (let step = 1; step <= list.length; step += 1) {
    const candidate = list[(start + step + list.length) % list.length];
    if (eligible.has(candidate.userId)) ordered.push(candidate.userId);
  }
  return ordered;
}

export function pickNextParticipant(input = {}) {
  return orderParticipants(input)[0] || null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado do fluxo: resposta do cliente e temporizadores
// ---------------------------------------------------------------------------------------------------------------------

/**
 * O que fazer com uma mensagem do cliente numa sessão viva.
 *  - toque em Localização/Valores → avança; toque em "Falar com associado" ou QUALQUER outra coisa (texto livre, áudio,
 *    botão antigo) → transfere na hora; reação → ignora.
 */
export function decideInbound({ replyId = "", messageType = "text" } = {}) {
  if (String(messageType) === "reaction") return { action: "ignore" };
  if (replyId === REPLY_IDS.location) return { action: "step", step: STEPS.location };
  if (replyId === REPLY_IDS.values) return { action: "step", step: STEPS.values };
  if (replyId === REPLY_IDS.associate) return { action: "transfer", reason: "botao_associado" };
  return { action: "transfer", reason: "texto_livre" };
}

const ms = (value) => (value ? new Date(value).getTime() : 0);

/**
 * Temporizador de uma sessão ATIVA: "nudge" (1 cutucada após `remindAfterMin` parado), "transfer" (sem resposta
 * `transferAfterMin` depois da cutucada) ou "none". `session` = { status, step_entered_at, nudged_at }.
 * `humanSpoke` = alguém da equipe mandou mensagem humana na conversa depois da etapa (cliente em conversa: não cutuca).
 */
export function decideTimer({ session, now = new Date(), config = DEFAULT_CONFIG, humanSpoke = false } = {}) {
  if (!session || session.status !== STATUSES.active) return { action: "none" };
  if (humanSpoke) return { action: "stop", reason: "equipe_conversando" };
  const nowMs = now.getTime();
  if (!session.nudged_at) {
    return nowMs - ms(session.step_entered_at) >= config.remindAfterMin * 60_000 ? { action: "nudge" } : { action: "none" };
  }
  return nowMs - ms(session.nudged_at) >= config.transferAfterMin * 60_000 ? { action: "transfer", reason: "sem_resposta" } : { action: "none" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quem pode entrar no fluxo
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `input`: config, hasAdReferral (a mensagem veio do anúncio), client { distribution_type, status }, conversation
 * { private_at, deleted_at }, isTeamPhone, doNotContactReason, hasRecentSession. Devolve { start, reason }.
 */
export function decideStart(input = {}, adWaitingDistribution = "whatsapp_ad_waiting") {
  if (!input.config?.enabled) return { start: false, reason: "desligado" };
  if (!input.hasAdReferral) return { start: false, reason: "sem_anuncio" };
  if (input.isTeamPhone) return { start: false, reason: "numero_da_equipe" };
  if (input.doNotContactReason) return { start: false, reason: "nao_contactar" };
  if (input.conversation?.private_at) return { start: false, reason: "particular" };
  if (input.conversation?.deleted_at) return { start: false, reason: "conversa_excluida" };
  if (input.hasRecentSession) return { start: false, reason: "ja_iniciado" };
  if (!input.client || input.client.distribution_type !== adWaitingDistribution) return { start: false, reason: "cliente_nao_e_lead_novo_do_anuncio" };
  return { start: true, reason: "ok" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Textos e mensagens (formato da Cloud API)
// ---------------------------------------------------------------------------------------------------------------------

const cut = (value, max) => String(value || "").slice(0, max);

function menuButtons(excluded = []) {
  const all = [["location", REPLY_IDS.location], ["values", REPLY_IDS.values], ["associate", REPLY_IDS.associate]];
  return all.filter(([key]) => !excluded.includes(key)).map(([key, id]) => ({ type: "reply", reply: { id, title: BUTTON_TITLES[key] } }));
}

/** Passo 1: saudação + 3 botões. */
export function buildGreetingMessage(profileName, now = new Date()) {
  const text = `${buildGreeting(profileName, now)}\n\nQue bom ter você por aqui! Sobre o que você quer saber?`;
  return { text, message: { type: "interactive", interactive: { type: "button", body: { text }, action: { buttons: menuButtons() } } }, buttons: Object.values(BUTTON_TITLES) };
}

/** Passo 2: imagem + botão CTA "Google Maps" (cta_url com cabeçalho de imagem). */
export function buildLocationMessage({ imageUrl = "", mapsUrl = "", propertyName = "" } = {}) {
  const text = propertyName ? `Aqui está a localização do ${propertyName}.` : "Aqui está a localização.";
  const interactive = { type: "cta_url", body: { text }, action: { name: "cta_url", parameters: { display_text: MAPS_BUTTON_LABEL, url: mapsUrl } } };
  if (imageUrl) interactive.header = { type: "image", image: { link: imageUrl } };
  return { text, message: { type: "interactive", interactive }, link: { label: MAPS_BUTTON_LABEL, url: mapsUrl }, imageUrl };
}

/** Botões logo abaixo da localização/valores: de novo Valores | Falar com associado (ou Localização | Falar… após Valores). */
export function buildFollowUpButtons(afterStep) {
  const text = afterStep === STEPS.location ? "Quer ver mais alguma coisa?" : "Posso te ajudar com mais alguma coisa?";
  const excluded = afterStep === STEPS.location ? ["location"] : ["values"];
  return { text, message: { type: "interactive", interactive: { type: "button", body: { text }, action: { buttons: menuButtons(excluded) } } }, buttons: menuButtons(excluded).map((button) => button.reply.title) };
}

/** Passo 3: link "Descubra seu poder de compra" (cta_url). */
export function buildValuesMessage(link) {
  const text = `${VALUES_LINK_TITLE}: responda algumas perguntas rápidas e veja quanto você consegue financiar.`;
  return { text, message: { type: "interactive", interactive: { type: "cta_url", body: { text }, action: { name: "cta_url", parameters: { display_text: cut(VALUES_BUTTON_LABEL, 20), url: link } } } }, link: { label: VALUES_BUTTON_LABEL, url: link } };
}

const NUDGE_TEXT = {
  [STEPS.greeted]: "ficou alguma dúvida? É só tocar em uma das opções acima.",
  [STEPS.location]: "ficou alguma dúvida sobre a localização?",
  [STEPS.values]: "conseguiu abrir o link para descobrir seu poder de compra? Se ficou alguma dúvida, é só falar."
};

/** Cutucada contextual por etapa: "Ana, ficou alguma dúvida sobre a localização?" (sem nome: sem o prefixo). */
export function buildNudgeText(profileName, step) {
  const body = NUDGE_TEXT[step] || NUDGE_TEXT[STEPS.greeted];
  const name = displayFirstName(profileName);
  return name ? `${name}, ${body}` : `${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

/** Aviso ao cliente na transferência direta (dentro da janela). */
export function buildTransferNoticeText({ profileName = "", noParticipants = false } = {}) {
  const name = displayFirstName(profileName);
  const prefix = name ? `${name}, ` : "";
  const body = noParticipants
    ? "já avisei a nossa equipe. Um associado vai te chamar por aqui assim que possível."
    : "vou chamar um dos nossos associados para continuar com você. Ele já fala por aqui.";
  return `${prefix}${body}`.replace(/^./, (c) => c.toUpperCase());
}

/** Enquanto o CRM consulta os associados (oferta ao próximo da roleta). */
export function buildOfferWaitText({ profileName = "" } = {}) {
  const name = displayFirstName(profileName);
  return `${name ? `${name}, ` : ""}só um instante: estou chamando um dos nossos associados para falar com você.`.replace(/^./, (c) => c.toUpperCase());
}

/** Ninguém aceitou a oferta DE NOITE (fora do horário de atendimento): aviso honesto, o atendimento começa às 8h. De dia não se manda. */
export function buildNoOneAnsweredText({ profileName = "", config = DEFAULT_CONFIG } = {}) {
  const name = displayFirstName(profileName);
  return `${name ? `${name}, ` : ""}nossos associados já estão fora do horário. Um deles entra em contato com você a partir das ${Math.max(config.windowStartHour, 8)}h, aqui mesmo.`.replace(/^./, (c) => c.toUpperCase());
}

/** Etapa em que o cliente parou, em palavras (aviso ao corretor). */
export function stepLabel(step) {
  return { [STEPS.greeted]: "Recebeu a saudação (não escolheu nada)", [STEPS.location]: "Viu a localização", [STEPS.values]: "Recebeu o link de valores" }[step] || "Início do atendimento";
}

export function reasonLabel(reason) {
  return { botao_associado: "pediu para falar com um associado", texto_livre: "escreveu uma mensagem", sem_resposta: "parou de responder", pendente: "estava aguardando a abertura do atendimento" }[reason] || "pediu atendimento";
}

/** Google Maps: URL configurada ou busca pelo nome/endereço do empreendimento. "" sem nada para buscar. */
export function buildMapsUrl({ mapsUrl = "", query = "" } = {}) {
  if (mapsUrl) return mapsUrl;
  const text = String(query || "").trim();
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : "";
}

/** Chave de idempotência (índice único de whatsapp_messages.meta_message_id) de cada mensagem do fluxo. */
export function claimKey(sessionId, label, n = 1) {
  return `oaf:${sessionId}:${label}:${n}`;
}

/** Token do formulário (10 caracteres base32 minúsculos — o mesmo formato do `sms_t`, lib/sms-batch-token-core.mjs). */
export function generateFormToken(random = Math.random) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let token = "";
  for (let i = 0; i < 10; i += 1) token += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return token;
}

/** Link do formulário que abre direto nas perguntas e carrega o token do atendimento (`sms_t`). */
export function buildFormLink(baseLink, token) {
  try {
    const url = new URL(baseLink);
    url.searchParams.set("jornada", "simulacao");
    if (token) url.searchParams.set("sms_t", token);
    return url.toString();
  } catch {
    return baseLink;
  }
}
