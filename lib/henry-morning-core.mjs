// "Bom dia, Henry" como conversa (dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-1): pergunta da música → estilo (rock ou
// sertanejo raiz) → toca baixinho e emenda o relatório → aniversariantes (só RASCUNHO de mensagem, nunca envia).
// Regras PURAS (sem banco, sem env): estados, leitura das respostas, frases fixas, música escolhida e frases do relatório.
// O estado mora na tela (vale só dentro da janela de conversa de 40 s) e volta ao servidor a cada resposta.
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { saoPauloNow } from "./alexa-config-core.mjs";

export const MORNING_STEPS = Object.freeze(["music", "style", "birthday"]);
export const MORNING_VOLUME = 28; // % do Spotify com o bom dia: música de fundo, sem competir com a voz
export const MORNING_STYLE_QUESTION = "Qual vibe: aquela playlist top de rock ou aquele sertanejo raiz?";
export const MORNING_MIROSMAR = "Vou começar daquele jeito: TOOOCA, MIROSMAR!";
export const MORNING_MUSIC_MAX = 120;
// Padrões (dono): rock = playlist de rock clássico pela busca; sertanejo raiz = Zezé Di Camargo & Luciano.
export const MORNING_MUSIC_DEFAULTS = Object.freeze({
  rock: Object.freeze({ query: "rock clássico", type: "playlist" }),
  sertanejo: Object.freeze({ query: "Zezé Di Camargo & Luciano", type: "artist" })
});

export function morningOpening(address = "Matheus") {
  return `E aí, ${address || "Matheus"}! Posso dar play numa playlist enquanto te passo as tarefas, agendas e pendências de hoje?`;
}

// Estado que a tela devolve: só o passo (o resto o servidor recalcula). Qualquer outra coisa = sem estado.
export function parseMorningState(input) {
  const step = input && typeof input === "object" ? input.step : "";
  return MORNING_STEPS.includes(step) ? { step } : null;
}

const words = (text) => ` ${normalizeSpeechText(text).replace(/\b(henry|henri)\b/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (value, list) => list.some((item) => value.includes(` ${item} `));
const lead = (value, list) => list.some((item) => value.startsWith(` ${item} `));
// Sim/não pelo começo da frase ("pode ser, não tem problema" = sim; "não, hoje não" = não); depois, em qualquer lugar.
function yesOrNo(value) {
  if (lead(value, NO)) return "no";
  if (lead(value, YES)) return "yes";
  if (has(value, NO)) return "no";
  if (has(value, YES)) return "yes";
  return "";
}

const NO = ["nao", "nem", "sem musica", "agora nao", "hoje nao", "dispenso", "deixa", "deixa pra la", "melhor nao", "nada", "sem som", "silencio"];
const YES = ["sim", "pode", "pode ser", "claro", "bora", "manda", "manda ver", "quero", "beleza", "ok", "isso", "vai", "partiu", "com certeza", "demorou", "fechou", "solta", "toca", "da o play", "dá o play", "play", "por favor", "uhum", "aham", "show", "top"];
const ROCK = ["rock", "rock n roll", "rockn roll", "roque", "classico", "classicos"];
const SERTANEJO = ["sertanejo", "sertaneja", "raiz", "mirosmar", "zeze", "modao", "moda de viola", "caipira", "sertanejo raiz"];
const ANY = ["tanto faz", "qualquer", "qualquer um", "voce escolhe", "escolhe voce", "escolhe ai", "surpreende", "tanto faz pra mim"];

function styleOf(value) {
  if (has(value, SERTANEJO)) return "sertanejo";
  if (has(value, ROCK)) return "rock";
  return "";
}

// Resposta à pergunta da música → "yes" | "no" | "rock" | "sertanejo" | "other" (outra pergunta: segue o fluxo normal).
export function classifyMorningMusicAnswer(text) {
  const value = words(text);
  if (!value.trim()) return "other";
  const style = styleOf(value);
  if (lead(value, NO) && !lead(value, ["nao sei"])) return style && !has(value, ["sem musica"]) ? style : "no";
  if (style) return style;
  return yesOrNo(value) || "other";
}

// Resposta à pergunta do estilo → "rock" | "sertanejo" | "no" | "other". "Tanto faz"/"sim" = rock (o 1º oferecido).
export function classifyMorningStyle(text) {
  const value = words(text);
  if (!value.trim()) return "other";
  const style = styleOf(value);
  if (style) return style;
  if (has(value, ANY)) return "rock";
  const answer = yesOrNo(value);
  return answer === "no" ? "no" : answer === "yes" ? "rock" : "other";
}

// Sim/não curto (rascunho do aniversário) → "yes" | "no" | "other".
export function classifyYesNo(text) {
  const value = words(text);
  if (!value.trim()) return "other";
  const answer = yesOrNo(value);
  if (answer) return answer;
  return has(value, ["prepara", "prepare", "faz", "faca", "escreve", "rascunha"]) ? "yes" : "other";
}

// Campo da tela "Voz e personalidade": nome de playlist/artista para buscar ou link do Spotify. Uma linha, sem marcação.
export function sanitizeMorningMusic(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[<>{}[\]`"\\|#*^$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MORNING_MUSIC_MAX)
    .trim();
}

// Link do Spotify (open.spotify.com/…/playlist|artist|album|track/<id>) ou URI → URI; senão "".
export function spotifyUriFromLink(value) {
  const text = String(value || "").trim();
  const uri = /^spotify:(track|playlist|album|artist):([A-Za-z0-9]{10,40})$/.exec(text);
  if (uri) return text;
  const link = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album|artist)\/([A-Za-z0-9]{10,40})(?:[/?#].*)?$/.exec(text);
  return link ? `spotify:${link[1]}:${link[2]}` : "";
}

// Música do estilo escolhido: { uri } (link configurado) ou { query, type } (busca; texto configurado = playlist).
export function resolveMorningMusic(choice, style = {}) {
  const fallback = MORNING_MUSIC_DEFAULTS[choice];
  if (!fallback) return null;
  const configured = sanitizeMorningMusic(choice === "rock" ? style?.rockMusic : style?.sertanejoMusic);
  if (!configured) return { query: fallback.query, type: fallback.type };
  const uri = spotifyUriFromLink(configured);
  return uri ? { uri } : { query: configured, type: "playlist" };
}

// Abertura falada antes do relatório, pelo resultado do play.
export function morningMusicPrefix(choice, result) {
  const parts = [];
  if (result?.openSpotify) parts.push("Abrindo o Spotify…");
  else if (result && !result.ok) parts.push("Não consegui dar o play agora, mas bora pro dia.");
  if (choice === "sertanejo" && (result?.ok || result?.openSpotify)) parts.push(MORNING_MIROSMAR);
  return parts.join(" ");
}

const plural = (count, one, many) => (count === 1 ? one : many);

// Frases do relatório com os números reais: clientes novos desde ontem (00h de ontem, Brasília), quantos deles têm a
// simulação automática do site GERADA e quantas simulações saíram AUTOMATICAMENTE pelo WhatsApp (SIM-AUTO-ENVIO, dono
// 2026-10-23, `autoSimulationSends` = countAutoSimulationSendsSince). "Enviei" só com essa contagem acima de zero.
// null = leitura falhou → a frase some (nunca um zero falso).
export function composeMorningExtras({ newClients = null, autoSimulations = null, autoSimulationSends = null } = {}) {
  const sent = Number.isFinite(autoSimulationSends) && autoSimulationSends > 0
    ? ` Já enviei a simulação para ${plural(autoSimulationSends, "1 cliente", `${autoSimulationSends} clientes`)}.`
    : "";
  if (!Number.isFinite(newClients)) return sent.trim();
  if (newClients === 0) return `Desde ontem não entrou cliente novo no CRM.${sent}`;
  const first = `Desde ontem ${plural(newClients, "entrou 1 cliente novo", `entraram ${newClients} clientes novos`)} no CRM.`;
  if (!Number.isFinite(autoSimulations)) return `${first}${sent}`;
  if (autoSimulations === 0) return `${first} Nenhum deles teve simulação automática gerada.${sent}`;
  return `${first} ${plural(autoSimulations, "1 já tem", `${autoSimulations} já têm`)} a simulação automática gerada pelo site.${sent}`;
}

const joinNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

// Pergunta do aniversário (só primeiros nomes, no máximo 3 citados).
export function birthdayQuestion(names = []) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return `Hoje é aniversário do cliente ${list[0]}. Quer que eu prepare uma mensagem pra ele?`;
  const shown = list.slice(0, 3);
  const rest = list.length - shown.length;
  const spoken = rest > 0 ? `${shown.join(", ")} e mais ${rest}` : joinNames(shown);
  return `Hoje é aniversário dos clientes ${spoken}. Quer que eu prepare uma mensagem pra eles?`;
}

// Rascunho da mensagem (o dono copia e manda se quiser — o Henry NUNCA envia).
export function birthdayDraft(name, signature = "Matheus") {
  const who = String(name || "").trim();
  return `Feliz aniversário${who ? `, ${who}` : ""}! Que esse novo ano venha com muita saúde, alegria e conquistas — quem sabe a chave da casa nova. Um grande abraço, ${signature || "Matheus"}.`;
}

// Botão ▶ "Começar o bom dia" (dono, 2026-10-23: plano B "caso a automação não funcione"): ao lado do microfone, visível do
// início do dia até 11:00 de São Paulo e some sozinho na hora (a tela agenda a próxima troca por msUntilChange). O clique
// faz EXATAMENTE o mesmo pedido do "bom dia, Henry" falado (mode "report", sem pergunta) — pode repetir no mesmo dia.
export const MORNING_PLAY_END_MINUTES = 11 * 60;
export const MORNING_PLAY_LABEL = "Começar o bom dia";
export const MORNING_PLAY_SHOWN = "Bom dia, Henry";

export function morningPlayWindow(now = new Date()) {
  const { minutes } = saoPauloNow(now);
  const visible = minutes < MORNING_PLAY_END_MINUTES;
  const target = visible ? MORNING_PLAY_END_MINUTES : 24 * 60;
  const intoMinute = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds(); // fuso de SP é hora cheia: segundos iguais
  return { visible, msUntilChange: Math.max(1000, (target - minutes) * 60000 - intoMinute) };
}

export function morningPlayRequest() {
  return { mode: "report", question: "", shown: MORNING_PLAY_SHOWN };
}

// Data falada na cena de abertura ("quinta-feira, 23 de outubro"), sempre no fuso de São Paulo.
export function morningSceneDate(now = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(now);
}
