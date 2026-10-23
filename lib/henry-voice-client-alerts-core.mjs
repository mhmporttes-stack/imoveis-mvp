// Henry avisa cliente novo e cliente transferido (HENRY-1, REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23: "Quero que o
// Henry me avise sempre que um cliente novo entrar e quando o cliente já tiver sido transferido também; nesse caso quero
// que ele me chame de 'chefe', 'patrão', 'mestre'. Sempre com tom de pergunta no começo [...] Crie umas 5 variantes
// diferentes para não ficar repetindo."). Regras PURAS (sem banco, sem rede): montagem dos eventos a partir dos
// registros que as entregas JÁ gravam, quando soltar o aviso, e o texto falado. Servidor: lib/henry-voice-client-alerts.js.
// Testes: tests/henry-client-alerts.test.mjs.

import { pickVariant, rememberVariant } from "./henry-voice-persona.mjs";
import { genderFromFirstName, speakableFirstName } from "./client-voice-audio-core.mjs";
import { firstName as safeFirstName } from "./alexa-config-core.mjs";
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { currentAbsence, isCheckinIgnoredByAbsence } from "./office-presence-core.mjs";

export const ALERT_LOOKBACK_MS = 10 * 60 * 1000; // CRM aberto depois de um tempo fechado: no máximo os últimos 10 min
export const ALERT_OVERLAP_MS = 60 * 1000; // releitura do último minuto (registro gravado no limite do cursor)
export const ALERT_SETTLE_MS = 20 * 1000; // rajada: espera 20 s sem evento novo para virar UM aviso resumido...
export const ALERT_MAX_HOLD_MS = 60 * 1000; // ...mas nunca segura mais de 60 s
export const ALERT_POLL_MS = 30 * 1000; // consulta leve (sem voz) a cada 30 s com o Henry parado
export const ALERT_WAITING_MIN_MINUTES = 2; // "aguardando há X" só a partir de 2 min
export const ALERT_WAITING_MAX_MINUTES = 24 * 60;
export const ALERT_PATH_STEPS = 3; // caminho da transferência: no máximo os 3 últimos passos
export const ALERT_SUMMARY_NAMES = 4; // resumo: até 4 nomes, o resto vira "e mais N"
export const ALERT_HOURS = Object.freeze({ start: 7 * 60, end: 22 * 60 }); // o Henry não tem modo silencioso: só 7h–22h

// Liga/desliga em "Voz e personalidade": nasce LIGADO; só `clientAlerts: false` desliga.
export function henryClientAlertsFromSetting(value) {
  return value?.clientAlerts !== false;
}

// "Avisar chegada da equipe" (dono, 2026-10-23): também nasce LIGADO; só `teamArrivals: false` desliga.
export function henryTeamArrivalsFromSetting(value) {
  return value?.teamArrivals !== false;
}

export function isAlertHour(minutes) {
  const value = Number(minutes);
  return Number.isFinite(value) && value >= ALERT_HOURS.start && value < ALERT_HOURS.end;
}

// Só o aparelho ativo do Henry fala (henry_active_device = o último aparelho que conversou com ele). Sem registro, qualquer
// um. Não reserva o aparelho (o aviso nunca tira a conversa de outro aparelho).
export function isAlertDevice(current, deviceId) {
  const id = String(deviceId || "");
  if (!current?.deviceId) return true;
  return Boolean(id) && current.deviceId === id;
}

// Janela da consulta: do cursor (menos 1 min de releitura) até agora, nunca mais de 10 min para trás.
export function alertWindowStart(sinceIso, now = Date.now()) {
  const since = Date.parse(sinceIso || "");
  const floor = now - ALERT_LOOKBACK_MS;
  if (!Number.isFinite(since) || since > now) return new Date(now).toISOString();
  return new Date(Math.max(floor, since - ALERT_OVERLAP_MS)).toISOString();
}

// Rajada vira 1 aviso: solta quando o último evento tem 20 s ou o primeiro tem 60 s.
export function shouldReleaseAlert({ oldestAt, newestAt, now = Date.now() } = {}) {
  const oldest = Date.parse(oldestAt || "");
  const newest = Date.parse(newestAt || "");
  if (!Number.isFinite(oldest) || !Number.isFinite(newest)) return true;
  return now - newest >= ALERT_SETTLE_MS || now - oldest >= ALERT_MAX_HOLD_MS;
}

const HOLDER_FLAGS = ["toWaitingQueue", "heldByOwner"];
export const ALERT_JOURNEY_TRANSFER_TYPES = Object.freeze(["manual", "distributed"]); // "roulette" já está na lead_distribution_history

// Passos de responsável do cliente, em ordem, lidos do que as entregas JÁ gravam (mesmas fontes da FUN-15h):
// lead_distribution_history (roleta, fila de espera, redistribuição, "Devolver para a roleta", fila de reativação,
// anúncio, Fluxos, Marketplace) e client_journey_events responsible_transferred manual/distribuída (ficha, Chat, exclusão
// de usuário, corretor que transfere o próprio cliente). Registro que só deixa o cliente na fila com o dono (toWaitingQueue/
// heldByOwner) não é entrega. Mesmo responsável seguido = um passo.
export function responsibleSteps({ distribution = [], journey = [] } = {}) {
  const entries = [];
  for (const row of distribution || []) {
    const details = row?.details || {};
    if (!row?.to_user_id || HOLDER_FLAGS.some((flag) => details[flag] === true)) continue;
    entries.push({ at: row.created_at, from: row.from_user_id || "", to: row.to_user_id });
  }
  for (const row of journey || []) {
    const details = row?.details || {};
    if (!ALERT_JOURNEY_TRANSFER_TYPES.includes(details.transferType) || !details.toId) continue;
    entries.push({ at: row.occurred_at, from: details.fromId || "", to: details.toId });
  }
  entries.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  const steps = [];
  const push = (userId, at) => {
    if (userId && steps[steps.length - 1]?.userId !== userId) steps.push({ userId, at });
  };
  for (const entry of entries) {
    push(entry.from, entry.at);
    push(entry.to, entry.at);
  }
  return steps;
}

// Eventos do aviso, um por cliente. registration = { id, full_name, created_at, responsible_user_id, direct_broker_link };
// steps = responsibleSteps(...); attended = houve atendimento depois da entrada (client-attendance). Evento = entrega
// dentro da janela (passo novo) ou cadastro pelo link pessoal de corretor criado na janela. Quem recebeu = o responsável
// ATUAL (o último passo precisa ser ele: senão o cliente já mudou de novo e o próximo aviso conta). requireFresh = false na
// hora de falar um aviso pendente (os dados são relidos; a entrega pode ter sido há mais tempo).
export function buildClientAlertEvent({ registration, steps = [], fromIso, attended = false, requireFresh = true, now = Date.now() } = {}) {
  if (!registration?.id || !registration.responsible_user_id) return null;
  const from = Date.parse(fromIso || "");
  const inWindow = (at) => Number.isFinite(Date.parse(at || "")) && Date.parse(at) >= from;
  const path = steps.length ? steps : [{ userId: registration.responsible_user_id, at: registration.created_at }];
  const last = path[path.length - 1];
  if (last.userId !== registration.responsible_user_id) return null;
  const fresh = (steps.length && inWindow(last.at)) || (registration.direct_broker_link === true && inWindow(registration.created_at));
  if (requireFresh && !fresh) return null;
  const createdAt = Date.parse(registration.created_at || "");
  const waited = !attended && Number.isFinite(createdAt) ? Math.max(0, Math.floor((now - createdAt) / 60000)) : null;
  // Espera de mais de 24 h (cliente antigo transferido, ex.: FUN-15) não é "aguardando atendimento": não é falada.
  const waitingMinutes = waited !== null && waited <= ALERT_WAITING_MAX_MINUTES ? waited : null;
  return {
    clientId: registration.id,
    clientName: registration.full_name || "",
    receiverId: registration.responsible_user_id,
    kind: path.length >= 2 ? "transfer" : "new",
    path: path.slice(-ALERT_PATH_STEPS).map((step) => step.userId),
    at: last.at || registration.created_at,
    waitingMinutes
  };
}

export const alertEventKey = (event) => (event?.kind === "arrival" ? `arrival:${event.userId || ""}:${event.day || ""}` : `${event?.clientId || ""}:${event?.receiverId || ""}`);

// --- Chegada da equipe na imobiliária (dono, 2026-10-23) -----------------------------------------------------------------
// "Quando um corretor chegar na imobiliária ele segue a mesma regra de aviso." Chegada = a que a ROL-2f JÁ detecta: a
// linha do dia em office_presence_checkins gravada pelo heartbeat no Wi-Fi da imobiliária (source "wifi"; uma linha por
// pessoa por dia, first_seen_at = 1ª chegada). Não conta: "Liberar hoje"/"Chegou sem Wi-Fi" (source "manual"), quem está
// marcado ausente (ausência valendo agora ou que anula a chegada), o próprio dono e quem não é gestora/corretor/associado
// ativo. checkins = [{ user_id, checkin_date, first_seen_at, valid_until, source }]; users = Map(id -> { id, name, gender,
// role, status }); absences = Map(id -> [...]) de loadOfficeAbsences.
export const ARRIVAL_ROLES = Object.freeze(["manager", "broker", "associate"]);

export function buildArrivalEvents({ checkins = [], users = new Map(), absences = new Map(), ownerId = "", now = Date.now() } = {}) {
  const events = [];
  const done = new Set();
  for (const row of checkins || []) {
    const user = users.get(row?.user_id);
    if (!user || row.source !== "wifi" || !row.first_seen_at || done.has(row.user_id)) continue;
    if (user.id === ownerId || user.status !== "active" || !ARRIVAL_ROLES.includes(user.role)) continue;
    const list = absences.get(row.user_id) || [];
    if (currentAbsence(list, now) || isCheckinIgnoredByAbsence({ firstSeenAt: row.first_seen_at, validUntil: row.valid_until }, list)) continue;
    done.add(row.user_id);
    events.push({ kind: "arrival", userId: user.id, name: user.name || "", gender: user.gender || null, day: row.checkin_date || "", at: row.first_seen_at });
  }
  return events.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}

// --- Texto ------------------------------------------------------------------------------------------------------------
// Chamado: só o vocativo, em tom de pergunta (não repete seguido). A informação vem depois da resposta do dono.
// Ajuste do dono (2026-10-23: "a chamada 'patrão?' está muito rápida e não está com tom de pergunta"): nunca uma palavra
// só (a ElevenLabs entoa mal palavra isolada) — sempre "Ô, ..." ou vocativo + "tá aí?"; "…" vira pausa curta na voz. A voz
// do chamado tem perfil próprio (mais lenta e expressiva): buildElevenLabsSpeechRequest profile "call".
export const HENRY_ALERT_VOCATIVES = Object.freeze([
  "Ô, patrão?",
  "Patrão… tá aí?",
  "Chefe? Tá me ouvindo?",
  "Meu patrão, tem um minutinho?",
  "Ô, chefe… tá por aí?",
  "Mestre? Tá na escuta?",
  "Chefe… tem um segundinho?",
  "Ô, mestre… tá aí?"
]);

// O texto é um chamado (vocativo)? Só esses usam o perfil de voz do chamado.
export function isHenryAlertCall(text) {
  return HENRY_ALERT_VOCATIVES.includes(text);
}

// Pessoa da equipe com artigo ("o Gabriel"/"a Bruna"; sem gênero: só o nome); o dono = "você".
function person(user, ownerId) {
  if (user?.id && user.id === ownerId) return { name: "você", with: "com você", to: "para você", by: "por você", pron: "você", owner: true };
  const first = safeFirstName(user?.name) || "um corretor";
  const article = user?.gender === "female" ? "a " : user?.gender === "male" ? "o " : "";
  const to = user?.gender === "female" ? "pra " : user?.gender === "male" ? "pro " : "para ";
  const by = user?.gender === "female" ? "pela " : user?.gender === "male" ? "pelo " : "por ";
  const pron = user?.gender === "female" ? "ela" : user?.gender === "male" ? "ele" : "";
  return { name: `${article}${first}`, with: `com ${article}${first}`, to: `${to}${first}`, by: `${by}${first}`, pron, owner: false };
}

// Gênero do cliente pelo primeiro nome (mesma regra da VOZ-1, lib/client-voice-audio-core.mjs); na dúvida, frase neutra.
export function clientVoice(fullName) {
  const first = speakableFirstName(fullName);
  const gender = genderFromFirstName(first);
  const name = first || "um cliente sem nome";
  if (gender === "female") return { name, gender, novo: "uma nova cliente", art: "a ", pron: "Ela", o: "a" };
  if (gender === "male") return { name, gender, novo: "um novo cliente", art: "o ", pron: "Ele", o: "o" };
  return { name, gender: null, novo: "um novo lead", art: "", pron: "", o: "" };
}

const cap = (text) => (text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text);

// Cliente NOVO (r = quem recebeu, c = cliente). Cada modelo funciona nos três gêneros do cliente.
export const HENRY_ALERT_NEW = Object.freeze([
  { id: "n1", render: ({ r, c }) => `${cap(r.name)} acabou de receber ${c.novo}: ${c.name}.` },
  { id: "n2", render: ({ r, c }) => `Chegou ${c.novo} ${r.to}: ${c.name}.` },
  { id: "n3", render: ({ r, c }) => `${c.name} acabou de entrar e caiu ${r.with}.` },
  { id: "n4", render: ({ r, c }) => `Tem ${c.novo} na área, ${c.name}, e quem pegou foi ${r.name}.` },
  { id: "n5", render: ({ r, c }) => `Entrou ${c.novo} agora: ${c.name}, que ficou ${r.with}.` },
  { id: "n6", render: ({ r, c }) => `Novidade fresquinha: ${c.name} chegou e está ${r.with}.` }
]);

// Cliente TRANSFERIDO.
export const HENRY_ALERT_TRANSFER = Object.freeze([
  { id: "t1", render: ({ r, c }) => `${cap(r.name)} acabou de receber ${c.art}${c.name}, que veio transferid${c.o || "o(a)"}.`, neutral: ({ r, c }) => `${cap(r.name)} acabou de receber ${c.name} por transferência.` },
  { id: "t2", render: ({ r, c }) => `${c.name} mudou de mãos e agora está ${r.with}.` },
  { id: "t3", render: ({ r, c }) => `Transferiram ${c.art}${c.name} ${r.to}.` },
  { id: "t4", render: ({ r, c }) => `${c.name} trocou de corretor: agora quem atende é ${r.name}.`, owner: ({ c }) => `${c.name} trocou de corretor: agora quem atende é você.` },
  { id: "t5", render: ({ r, c }) => `Passaram ${c.art}${c.name} ${r.to}, por transferência.` },
  { id: "t6", render: ({ r, c }) => `Olha a transferência: ${c.name} foi parar ${r.with}.` }
]);

// Há quanto tempo aguarda atendimento (só sem atendimento).
export const HENRY_ALERT_WAITING = Object.freeze([
  { id: "w1", render: ({ c, t }) => `${c.name} está aguardando atendimento há ${t}.` },
  { id: "w2", render: ({ t }) => `Ninguém atendeu ainda: já são ${t} de espera.` },
  { id: "w3", render: ({ c, t }) => `${c.pron || c.name} tá esperando atendimento faz ${t}.` },
  { id: "w4", render: ({ t }) => `Ainda sem atendimento, há ${t}.` },
  { id: "w5", render: ({ c, t }) => `Já faz ${t} que ${c.art}${c.name} espera alguém chamar.` }
]);

// Caminho da transferência (2 ou 3 passos, o último = quem tem o cliente agora).
function pathSentence(names, c, variant) {
  const [a, b, d] = names;
  const subject = c.pron || c.name;
  if (names.length === 2) {
    if (variant === 0 && c.o) return `${subject} foi primeiro ${a.to} e depois transferid${c.o} ${b.to}.`;
    return `Antes estava ${a.with}, agora está ${b.with}.`;
  }
  if (variant === 0 && c.o) return `${subject} foi ${a.to}, depois ${b.to} e por fim transferid${c.o} ${d.to}.`;
  return `${variant === 0 ? `${subject} passou` : "Passou"} ${a.by}, depois ${b.by} e agora está ${d.with}.`;
}

// Resumo de vários (cabeçalho com a contagem).
export const HENRY_ALERT_SUMMARY = Object.freeze([
  { id: "s1", render: ({ head }) => `Entraram ${head}.` },
  { id: "s2", render: ({ head }) => `Chegou uma leva: ${head}.` },
  { id: "s3", render: ({ head }) => `Movimento bom por aqui: ${head}.` },
  { id: "s4", render: ({ head }) => `Rapidinho, ${head} nos últimos minutos.` },
  { id: "s5", render: ({ head }) => `Olha só, ${head}.` }
]);

// Chegada da equipe (p = pessoa com artigo pelo admin_users.gender: "a Bruna"/"o Gabriel"; sem gênero, só o nome). Os
// modelos começam em minúscula ou pelo nome: viram frase com cap() ou entram depois do aviso de cliente com "Ah, e ...".
export const HENRY_ALERT_ARRIVAL = Object.freeze([
  { id: "a1", render: ({ p }) => `só pra avisar que ${p.name} acabou de chegar na imobiliária.` },
  { id: "a2", render: ({ p }) => `${p.name} chegou aí na imobiliária agora.` },
  { id: "a3", render: ({ p }) => `chegou ${p.name} na imobiliária.` },
  { id: "a4", render: ({ p }) => `${p.name} acabou de chegar aí na imobiliária.` },
  { id: "a5", render: ({ p }) => (p.pron ? `chegou ${p.name}: ${p.pron} já está na imobiliária.` : `chegou ${p.name}, que já está na imobiliária.`) },
  { id: "a6", render: ({ p }) => `${p.name} deu as caras na imobiliária agora há pouco.` }
]);

// Várias chegadas juntas: um aviso resumido ("Chegaram a Bruna e o Gabriel na imobiliária.").
export const HENRY_ALERT_ARRIVAL_SUMMARY = Object.freeze([
  { id: "as1", render: ({ names }) => `chegaram ${names} na imobiliária.` },
  { id: "as2", render: ({ names }) => `só pra avisar que chegaram ${names} na imobiliária.` },
  { id: "as3", render: ({ names }) => `${names} acabaram de chegar na imobiliária.` }
]);

export function formatWaiting(minutes) {
  const value = Math.max(0, Math.floor(Number(minutes) || 0));
  if (value < 60) return value === 1 ? "1 minuto" : `${value} minutos`;
  if (value < 24 * 60) {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    const h = hours === 1 ? "1 hora" : `${hours} horas`;
    return rest ? `${h} e ${rest === 1 ? "1 minuto" : `${rest} minutos`}` : h;
  }
  const days = Math.floor(value / (24 * 60));
  return days === 1 ? "1 dia" : `${days} dias`;
}

function list(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function countPhrase(n, singular, plural) {
  return n === 1 ? singular : `${n} ${plural}`;
}

// Escolhe sem repetir os últimos (pickVariant da persona do Henry) e devolve o "recente" atualizado.
function choose(bank, recent = [], random) {
  const ids = bank.map((item) => item.id || item);
  const id = pickVariant(ids, recent, random);
  return { item: bank[ids.indexOf(id)], recent: rememberVariant(recent, id) };
}

export const EMPTY_ALERT_RECENT = Object.freeze({ new: [], transfer: [], waiting: [], summary: [], path: [], arrival: [], arrivalSummary: [] });

function normalizeRecent(recent) {
  const result = {};
  for (const key of Object.keys(EMPTY_ALERT_RECENT)) {
    const value = recent?.[key];
    result[key] = Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-10) : [];
  }
  return result;
}

// --- Chamado, resposta do dono e frases curtas (ajuste do dono, 2026-10-23) --------------------------------------------
// "Sempre depois de chefe? Ou patrão? etc., ele aguarda uma resposta minha, como 'sim, pode falar' ou 'oi', aí ele me
// passa a informação." O Henry fala SÓ o vocativo, abre o microfone e espera; a informação sai só com resposta afirmativa.
export const ALERT_ANSWER_WAIT_MS = 9000; // sem resposta em ~9 s: chama mais uma vez
export const ALERT_MAX_CALLS = 2; // depois do 2º chamado sem resposta: fica pendente (nada é falado)
export const ALERT_RETRY_MS = 10 * 60 * 1000; // "agora não"/sem resposta: tenta de novo em ~10 min
export const ALERT_MAX_RETRIES = 3; // sem resposta em 3 tentativas seguidas: só no próximo cliente ou quando ele falar com o Henry

// Frases curtas fixas (sintetizadas uma vez por voz e guardadas, como as frases de espera). Lista FECHADA: o servidor só
// sintetiza o que está aqui.
export const HENRY_ALERT_PHRASES = Object.freeze({
  none: Object.freeze(["Nenhum aviso pendente agora.", "Tá tudo em dia, nenhum aviso guardado.", "Por enquanto nenhum aviso, chefe.", "Sem aviso pendente agora.", "Nada guardado por aqui, tá limpo."]),
  later: Object.freeze(["Beleza, depois te falo.", "Tranquilo, te falo daqui a pouco.", "Fechou, eu seguro aqui.", "Suave, depois eu te conto.", "Combinado, falo mais tarde."]),
  offer: Object.freeze(["E aquele aviso, posso falar?", "Ah, e o aviso de antes, posso falar agora?", "Voltando: posso te passar aquele aviso?", "E sobre aquele aviso, falo agora?", "Posso te contar aquele aviso agora?"]),
  resume: Object.freeze(["Ah, chefe, tinha um aviso pra você. Posso falar?", "Ah, patrão, tenho um aviso guardado. Falo?", "Mestre, ficou um aviso pra você. Posso contar?", "Chefe, tem um aviso esperando. Posso falar?", "Ô patrão, guardei um aviso pra você. Falo agora?"])
});

export function isHenryAlertPhrase(text) {
  return isHenryAlertCall(text) || Object.values(HENRY_ALERT_PHRASES).some((bank) => bank.includes(text));
}

// Todas as frases fixas do aviso (vocativos + curtas), para sintetizar de uma vez e guardar no navegador.
export function henryAlertFixedPhrases() {
  return [...HENRY_ALERT_VOCATIVES, ...Object.values(HENRY_ALERT_PHRASES).flat()];
}

// Sorteio sem repetir seguido (pickVariant da persona do Henry). kind = "vocative" | "later" | "offer" | "resume".
export function pickAlertPhrase(kind, recent = [], random = Math.random) {
  const bank = kind === "vocative" ? HENRY_ALERT_VOCATIVES : HENRY_ALERT_PHRASES[kind] || [];
  const text = pickVariant([...bank], recent, random);
  return { text, recent: rememberVariant(recent, text) };
}

// Resposta do dono ao chamado, por lista de palavras (sem IA). "yes" = pode falar; "no" = agora não; "noise" = ignora e
// continua esperando; "other" = é outra coisa (o Henry responde e depois oferece o aviso). Na dúvida, frase curta (até 4
// palavras) e não negativa = "yes".
const ANSWER_FILLER = new Set(["henry", "henri", "enri", "enry", "chefe", "patrao", "mestre", "ai", "ei", "e", "ah", "ue", "entao", "por", "favor", "la", "meu", "querido", "cara"]);
const NEGATIVE_PHRASES = [
  "agora nao", "nao agora", "agora nao da", "depois", "mais tarde", "daqui a pouco", "daqui pouco", "ja ja", "to ocupado", "estou ocupado",
  "ocupado", "ocupada", "espera", "espere", "pera", "perai", "segura", "aguarda", "aguenta", "calma", "nao", "nao posso", "nao da", "agora nao posso",
  "to em reuniao", "em reuniao", "to no telefone", "to em ligacao", "em ligacao", "deixa pra depois", "deixa quieto", "pode parar", "pare", "silencio", "tchau", "nada"
];
const AFFIRMATIVE_PHRASES = new Set([
  "oi", "fala", "pode falar", "sim", "diz", "diga", "manda", "pode mandar", "manda ver", "o que foi", "que foi", "o que", "que", "o que e", "que e",
  "to ouvindo", "estou ouvindo", "opa", "pode", "pode dizer", "pode contar", "conta", "conta ai", "fala ai", "fala comigo", "pois nao", "claro", "bora",
  "vai", "pode ser", "e ai", "pronto", "ok", "aham", "uhum", "sim pode falar", "sim pode", "oi pode falar", "diga la", "sou todo ouvidos", "hum", "quem"
]);
const ANSWER_NOISE = new Set(["", "hmm", "humm", "ahn", "eh", "ne", "o", "a"]);

export function classifyAlertAnswer(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  const core = tokens.filter((word) => !ANSWER_FILLER.has(word));
  const phrase = core.join(" ");
  if (ANSWER_NOISE.has(phrase) && !tokens.some((word) => ["chefe", "patrao", "mestre", "henry", "henri"].includes(word))) return "noise";
  if (!core.length) return "yes"; // só "Henry?"/"chefe?" de volta: pode falar
  if (AFFIRMATIVE_PHRASES.has(phrase)) return "yes";
  if (core.length <= 6) {
    const padded = ` ${phrase} `;
    if (NEGATIVE_PHRASES.some((item) => padded.includes(` ${item} `))) return "no";
  }
  if (core.length <= 4) return "yes";
  return "other";
}

// --- Texto da informação (sem o vocativo: ele já foi falado no chamado) ----------------------------------------------
// users = Map(id -> { id, name, gender }); ownerId = o dono (vira "você"); away = eram avisos pendentes (o dono não
// respondeu antes): o resumo diz "enquanto você estava fora". Devolve { text, recent } (recent = o que já foi usado,
// guardado no navegador para não repetir seguido) ou { text: "" } se nada é seguro de falar.
// Eventos "arrival" (chegada da equipe) vêm DEPOIS dos de cliente (prioridade do dono: cliente novo/transferido primeiro),
// no mesmo aviso.
export function composeHenryClientAlert(events = [], { users = new Map(), ownerId = "", recent = EMPTY_ALERT_RECENT, away = false, random = Math.random } = {}) {
  const all = (events || []).filter(Boolean);
  const items = all.filter((event) => event.kind !== "arrival");
  const arrivals = all.filter((event) => event.kind === "arrival");
  if (!all.length) return { text: "", recent: normalizeRecent(recent) };
  const state = normalizeRecent(recent);
  const pickInto = (key, bank) => {
    const { item, recent: next } = choose(bank, state[key], random);
    state[key] = next;
    return item;
  };
  const who = (id) => person(users.get(id) || { id }, ownerId);
  const parts = [];

  if (!items.length) {
    if (away) parts.push("Enquanto você estava fora:");
  } else if (items.length === 1) {
    const event = items[0];
    const c = clientVoice(event.clientName);
    const r = who(event.receiverId);
    if (event.kind === "transfer") {
      const model = pickInto("transfer", HENRY_ALERT_TRANSFER);
      parts.push(r.owner && model.owner ? model.owner({ c }) : !c.gender && model.neutral ? model.neutral({ r, c }) : model.render({ r, c }));
    } else {
      parts.push(pickInto("new", HENRY_ALERT_NEW).render({ r, c }));
    }
    if (Number.isFinite(event.waitingMinutes) && event.waitingMinutes >= ALERT_WAITING_MIN_MINUTES) {
      parts.push(pickInto("waiting", HENRY_ALERT_WAITING).render({ c, t: formatWaiting(event.waitingMinutes) }));
    }
    if (event.kind === "transfer" && event.path.length >= 2) {
      const variant = pickInto("path", ["p0", "p1"]) === "p0" ? 0 : 1;
      parts.push(pathSentence(event.path.map(who), c, variant));
    }
    if (away) parts.unshift("Enquanto você estava fora:");
  } else {
    const fresh = items.filter((event) => event.kind !== "transfer");
    const moved = items.filter((event) => event.kind === "transfer");
    const heads = [];
    if (fresh.length) heads.push(countPhrase(fresh.length, "um cliente novo", "clientes novos"));
    if (moved.length) heads.push(countPhrase(moved.length, "uma transferência", "transferências"));
    const shown = items.slice(0, ALERT_SUMMARY_NAMES).map((event) => `${clientVoice(event.clientName).name} ${who(event.receiverId).with}`);
    const extra = items.length - shown.length;
    const head = list(heads);
    const opening = away ? `Enquanto você estava fora, entraram ${head}.` : pickInto("summary", HENRY_ALERT_SUMMARY).render({ head });
    parts.push(opening);
    parts.push(`${list(extra > 0 ? [...shown, `mais ${extra}`] : shown)}.`);
    const longest = items
      .filter((event) => Number.isFinite(event.waitingMinutes) && event.waitingMinutes >= ALERT_WAITING_MIN_MINUTES)
      .sort((a, b) => b.waitingMinutes - a.waitingMinutes)[0];
    if (longest) parts.push(pickInto("waiting", HENRY_ALERT_WAITING.filter((item) => item.id === "w1" || item.id === "w5")).render({ c: clientVoice(longest.clientName), t: formatWaiting(longest.waitingMinutes) }));
  }
  if (arrivals.length) {
    const people = arrivals.map((event) => person({ id: event.userId, name: event.name, gender: event.gender }, ownerId));
    let line;
    if (people.length === 1) line = pickInto("arrival", HENRY_ALERT_ARRIVAL).render({ p: people[0] });
    else {
      const shown = people.slice(0, ALERT_SUMMARY_NAMES).map((p) => p.name);
      const extra = people.length - shown.length;
      const names = list(extra > 0 ? [...shown, `mais ${extra} da equipe`] : shown);
      line = pickInto("arrivalSummary", HENRY_ALERT_ARRIVAL_SUMMARY).render({ names });
    }
    parts.push(items.length ? `Ah, e ${line}` : cap(line));
  }
  const text = cap(parts.join(" ").replace(/\s+/g, " ").trim());
  if (!isSafeToSpeak(text)) return { text: "", recent: normalizeRecent(recent) };
  return { text, recent: state };
}

// --- Estado do navegador (pendentes e já vistos) ----------------------------------------------------------------------
export const ALERT_SEEN_MS = 30 * 60 * 1000;
export const ALERT_PENDING_MAX_AGE_MS = 2 * 60 * 60 * 1000; // pendente de mais de 2 h (CRM fechado) é descartado

// Pendentes sem repetir o mesmo cliente:corretor; o mais recente fica.
export function mergeAlertPending(pending = [], events = []) {
  const byKey = new Map();
  for (const item of [...(pending || []), ...(events || [])]) if (item?.key && (item.clientId || (item.kind === "arrival" && item.userId) || (item.kind === "notice" && item.noticeId))) byKey.set(item.key, item);
  return [...byKey.values()].slice(-30);
}

export function pruneAlertPending(pending = [], now = Date.now()) {
  return (pending || []).filter((item) => now - (Date.parse(item?.at || "") || 0) <= ALERT_PENDING_MAX_AGE_MS);
}

// seen = [{ key, at }] (at em ms): o que já foi avisado ou está pendente, por 30 min.
export function addAlertSeen(seen = [], keys = [], now = Date.now()) {
  const kept = (seen || []).filter((item) => item?.key && now - Number(item.at || 0) <= ALERT_SEEN_MS && !keys.includes(item.key));
  return [...kept, ...keys.map((key) => ({ key, at: now }))].slice(-200);
}

// --- Avisos da Central de Alertas por voz (dono, 2026-10-23: "Os alertas podem parar de aparecer na minha tela; ele pode
// simplesmente me avisar como já faz com os avisos" e "Quando eu disser 'Henry, leia os avisos' ele já fala tudo que está
// acumulado"). Só o DONO e só com o Henry ativo neste aparelho (ligado, fora do mudo, aparelho ativo, 7h–22h) e a opção
// "Avisos só por voz" ligada (nasce LIGADA): o card INFORMATIVO não aparece e vira um pendente do mesmo chamado do aviso.
// O IMPORTANTE (janela que bloqueia o CRM) continua na tela como sempre. Henry desligado/fechado = os cards voltam.
export function henryVoiceNoticesFromSetting(value) {
  return value?.voiceNotices !== false;
}

export const HENRY_VOICE_NOTICES_EVENT = "mm-henry-voice-notices"; // Henry → Central: { active }
export const HENRY_NOTICE_ITEMS_EVENT = "mm-henry-notice-items"; // Central → Henry: { items: [{ id, created_at }] }
export const HENRY_NOTICE_DONE_EVENT = "mm-henry-notice-done"; // Henry → Central: { ids, release } (lidos / devolvidos à tela)
export const NOTICE_SPOKEN_MAX = 5; // lidos de uma vez; o resto: "e mais N na Central de Alertas"

export function noticePendingItems(items = [], now = Date.now()) {
  return (items || [])
    .filter((item) => item?.id && typeof item.id === "string")
    .map((item) => ({ key: `notice:${item.id}`, noticeId: item.id, kind: "notice", at: Number.isFinite(Date.parse(item.created_at || "")) ? new Date(Date.parse(item.created_at)).toISOString() : new Date(now).toISOString() }));
}

// "Henry, leia os avisos" / "quais os avisos?" / "tem aviso?" / "o que tem de aviso pendente?" (sem IA).
const READ_ALERTS_PATTERNS = [
  /^(henr[yi] )?(me )?(le|leia|ler|lê|fala|fale|conta|conte|diz|diga|passa|passe|mostra) (os|as|o|a|meus|minhas)? ?(avisos?|alertas?|notificacoes|notificacao|recados?)( pendentes?)?( ai| pra mim| por favor)?$/,
  /^(henr[yi] )?(quais|qual|que) (sao )?(os|as|o|a)? ?(avisos?|alertas?|notificacoes|recados?)( pendentes?)?( de hoje)?$/,
  /^(henr[yi] )?(tem|teve|tem algum|tem alguma|chegou|chegou algum) (algum )?(aviso|alerta|notificacao|recado)s?( novo| nova| pendente)?( ai| pra mim)?$/,
  /^(henr[yi] )?(o )?que (que )?(tem|ha|chegou) de (aviso|alerta|notificacao|recado)s?( novo| novos| pendentes?)?$/,
  /^(henr[yi] )?(avisos?|alertas?)( pendentes?)?$/
];
export function isReadAlertsCommand(text) {
  const value = normalizeSpeechText(text).replace(/\b(vamos ver se (ta|esta) funcionando|por favor)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!value || value.split(" ").length > 9) return false;
  return READ_ALERTS_PATTERNS.some((pattern) => pattern.test(value));
}

// Texto dos avisos da Central (título + corpo, o mais recente primeiro). Cada um passa sozinho pela barreira da fala:
// o que tiver dado sensível vira "um aviso que é melhor ver na tela". Devolve { text, spokenIds, extra }.
const cleanLine = (value) => String(value || "").replace(/\s+/g, " ").replace(/[.!?…]+$/, "").trim();
export function composeHenryNoticeLines(notices = [], { max = NOTICE_SPOKEN_MAX, lead = true } = {}) {
  const list = [...(notices || [])].filter((item) => item?.id).sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));
  if (!list.length) return { text: "", spokenIds: [], extra: 0 };
  const spoken = list.slice(0, max);
  let hidden = 0;
  const lines = [];
  for (const item of spoken) {
    const title = cleanLine(item.title).slice(0, 120);
    const body = cleanLine(item.body).slice(0, 220);
    const line = [title, body && body !== title ? body : ""].filter(Boolean).join(": ");
    if (line && isSafeToSpeak(`${line}.`)) lines.push(`${line}.`);
    else hidden += 1;
  }
  const count = list.length;
  const opener = !lead ? "" : count === 1 ? "Tem um aviso da Central." : `Tem ${count} avisos da Central.`;
  const parts = [opener, ...lines];
  if (hidden) parts.push(hidden === 1 ? "Mais um que é melhor ver na tela." : `Mais ${hidden} que é melhor ver na tela.`);
  if (count > spoken.length) parts.push(`E mais ${count - spoken.length} na Central de Alertas.`);
  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const safe = isSafeToSpeak(text);
  return { text: safe ? text : opener, lines: safe ? lines : [], spokenIds: spoken.map((item) => item.id), extra: count - spoken.length };
}

// Lista dos avisos lidos pelo Henry na tela (dono, 2026-10-23, protótipo v22): canto esquerdo, sem fundo, tipo pequeno e
// colorido + texto. Um item por aviso falado, na ordem da fala: o de cliente novo/transferido/chegada (texto já composto
// para a voz) e cada aviso da Central. Só o que ele FALA (nada a mais na tela).
export const HENRY_ALERT_LIST_COLORS = Object.freeze({ new: "#e9c27a", transfer: "#b59cff", arrival: "#9be7c4", notice: "#4fc3e0" });
export function alertDisplayItems({ clientText = "", events = [], noticeLines = [] } = {}) {
  const items = [];
  if (clientText) {
    const kinds = new Set((events || []).map((event) => event?.kind));
    const kind = kinds.has("new") ? "new" : kinds.has("transfer") ? "transfer" : "arrival";
    const kicker = kind === "new" ? (kinds.size > 1 ? "Clientes e equipe" : "Cliente novo") : kind === "transfer" ? "Cliente transferido" : "Chegada na imobiliária";
    items.push({ kicker, text: clientText, color: HENRY_ALERT_LIST_COLORS[kind] });
  }
  for (const line of noticeLines || []) if (line) items.push({ kicker: "Aviso da Central", text: line, color: HENRY_ALERT_LIST_COLORS.notice });
  return items;
}

// Quando cada item entra na tela (ms depois de a fala começar): o 1º na hora; os seguintes pela posição do texto dele
// na fala inteira × duração estimada (~14 caracteres por segundo — a fala sai num áudio só). Texto não achado = na hora.
export const HENRY_ALERT_LIST_CPS = 14;
export function alertItemOffsets(items = [], spokenText = "", { charsPerSecond = HENRY_ALERT_LIST_CPS } = {}) {
  const total = String(spokenText || "");
  return (items || []).map((item, index) => {
    if (index === 0) return 0;
    const at = total.indexOf(String(item?.text || "").slice(0, 40));
    return at > 0 ? Math.round((at / charsPerSecond) * 1000) : 0;
  });
}
