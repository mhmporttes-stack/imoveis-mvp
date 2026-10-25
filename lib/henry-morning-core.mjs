// "Bom dia, Henry" como conversa (dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-1): pergunta da música → estilo (rock ou
// sertanejo raiz) → toca baixinho e emenda o relatório → aniversariantes (só RASCUNHO de mensagem, nunca envia).
// Regras PURAS (sem banco, sem env): estados, leitura das respostas, frases fixas, música escolhida e frases do relatório.
// O estado mora na tela (vale só dentro da janela de conversa de 40 s) e volta ao servidor a cada resposta.
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { genderFromFirstName } from "./client-voice-audio-core.mjs";

// "birthday_alert" = pergunta do aviso de aniversariante (dono, 2026-10-24, lib/henry-birthday-alerts-core.mjs): o mesmo
// mecanismo de estado na tela, fora do bom dia.
// "music_confirm" = "Achei X, de Y. É essa?" depois de um cantor que não bateu na busca (dono, 2026-10-24).
export const MORNING_STEPS = Object.freeze(["music", "style", "music_confirm", "birthday", "birthday_alert"]);
// Sem volume fixo no play do bom dia (dono, 2026-10-24: "toda vez que ele dá play, ele vai para o volume mínimo"): a
// música fica no volume do Spotify do dono e só baixa enquanto o Henry fala (speechDuckAction, henry-spotify-core.mjs).
// Pergunta do estilo: desde 2026-10-24 só a reserva quando a sugestão do dia (henry-morning-music-core.mjs) não foi gravada.
export const MORNING_STYLE_QUESTION = "Qual vibe: aquela playlist top de rock ou aquele sertanejo raiz?";
// Bom dia com o Spotify JÁ tocando (dono, 2026-10-23): não oferece playlist — emenda direto o relatório.
export const MORNING_ALREADY_PLAYING = "Já tá rolando um som, então bora pro dia:";
export const MORNING_MIROSMAR = "Vou começar daquele jeito: TOOOCA, MIROSMAR!";
export const MORNING_MUSIC_MAX = 120;
// Padrões (dono): rock = playlist de rock clássico pela busca; sertanejo raiz = Zezé Di Camargo & Luciano.
export const MORNING_MUSIC_DEFAULTS = Object.freeze({
  rock: Object.freeze({ query: "rock clássico", type: "playlist" }),
  sertanejo: Object.freeze({ query: "Zezé Di Camargo & Luciano", type: "artist" })
});

// Aberturas genéricas: desde 2026-10-24 só a reserva quando não sai a sugestão de música (morningSuggestionLine).
// variant = índice sorteado no servidor (dono, 2026-10-23: "vocabulário muito repetitivo"): 0 = a frase de sempre; as
// outras dizem o mesmo (pergunta da música, terminando em "?") de outro jeito. avoid = começos já usados hoje.
export const MORNING_OPENINGS = Object.freeze([
  (name) => `E aí, ${name}! Posso dar play numa playlist enquanto te passo as tarefas, agendas e pendências de hoje?`,
  (name) => `Bom dia, ${name}! Quer um som de fundo enquanto eu te conto como tá o dia?`,
  (name) => `Fala, ${name}! Antes do resumo do dia, bora colocar uma música?`,
  (name) => `Opa, ${name}, bom dia! Solto uma playlist enquanto passo a agenda e as pendências?`,
  (name) => `Bom dia, ${name}! Começo com uma trilha sonora pra acompanhar o relatório?`,
  (name) => `Olha quem chegou! ${name}, quer uma música enquanto eu te passo o dia?`
]);
export function morningOpening(address = "Matheus", { avoid = [], random = null } = {}) {
  const name = address || "Matheus";
  if (typeof random !== "function") return MORNING_OPENINGS[0](name);
  const used = new Set((avoid || []).map((item) => normalizeSpeechText(item)));
  const fresh = MORNING_OPENINGS.map((build) => build(name)).filter((text) => !used.has(normalizeSpeechText(text.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?…:;]+$/, ""))));
  const list = fresh.length ? fresh : MORNING_OPENINGS.map((build) => build(name));
  return list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
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

// --- Estilo ou cantor na resposta do bom dia (dono, 2026-10-24: "acrescente também opção de estilo musical como rock,
// sertanejo; aí eu posso ou falar qual estilo ou responder o cantor e ele procura") -------------------------------------
// Lista curta de gêneros em pt-BR com sinônimos falados (normalizados). query = busca de playlist no Spotify. rock e
// sertanejo mantêm os padrões do dono (MORNING_MUSIC_DEFAULTS / campo da tela): "sertanejo" = Zezé, com o MIROSMAR.
const genre = (id, label, list, query) => Object.freeze({ id, label, words: Object.freeze(list), query });
export const MORNING_GENRES = Object.freeze([
  genre("rock", "rock", ["rock", "rock n roll", "rockn roll", "roque", "rock classico", "classic rock", "classico", "classicos"], "rock clássico"),
  genre("rock-nacional", "rock nacional", ["rock nacional", "rock brasileiro", "rock br"], "rock nacional anos 80"),
  genre("sertanejo", "sertanejo", ["sertanejo", "sertaneja", "sertanejo raiz", "raiz", "mirosmar", "zeze", "modao", "moda de viola", "caipira"], "sertanejo raiz"),
  genre("sertanejo-universitario", "sertanejo universitário", ["sertanejo universitario", "universitario", "sertanejo novo"], "sertanejo universitário"),
  genre("pagode", "pagode", ["pagode", "pagodinho", "pagodao"], "pagode"),
  genre("samba", "samba", ["samba", "sambinha", "samba raiz"], "samba"),
  genre("mpb", "MPB", ["mpb", "musica popular brasileira"], "MPB"),
  genre("forro", "forró", ["forro", "forrozinho", "xote", "baiao"], "forró"),
  genre("piseiro", "piseiro", ["piseiro", "pisadinha"], "piseiro"),
  genre("funk", "funk", ["funk", "funkzinho"], "funk"),
  genre("rap", "rap", ["rap", "hip hop", "trap"], "rap nacional"),
  genre("pop", "pop", ["pop"], "pop"),
  genre("eletronica", "eletrônica", ["eletronica", "eletronico", "house", "techno", "dance"], "eletrônica"),
  genre("reggae", "reggae", ["reggae", "regue"], "reggae"),
  genre("axe", "axé", ["axe"], "axé"),
  genre("bossa", "bossa nova", ["bossa nova", "bossa"], "bossa nova"),
  genre("jazz", "jazz", ["jazz"], "jazz"),
  genre("blues", "blues", ["blues"], "blues"),
  genre("metal", "metal", ["metal", "heavy metal"], "heavy metal"),
  genre("country", "country", ["country"], "country"),
  genre("gospel", "gospel", ["gospel", "louvor"], "gospel"),
  genre("classica", "música clássica", ["musica classica", "classica", "erudita"], "música clássica"),
  genre("acustico", "acústico", ["acustico", "acustica", "voz e violao", "violao"], "acústico"),
  genre("flashback", "flashback", ["flashback", "anos 80", "anos 90", "das antigas"], "flashback anos 80"),
  genre("romantica", "românticas", ["romantica", "romanticas", "romantico"], "românticas")
]);

// Palavras que só enfeitam a resposta ("pode ser um ...", "não, toca uma ...", "quero algo mais ...") — tiradas das pontas.
const REPLY_FILLERS = new Set(["nao", "sim", "pode", "ser", "entao", "ah", "ai", "ae", "olha", "hum", "hmm", "opa", "beleza", "ok", "quero", "prefiro", "melhor", "vamos", "vai", "bora", "manda", "ver", "me", "ve", "coloca", "coloque", "bota", "bote", "poe", "ponha", "toca", "toque", "tocar", "solta", "solte", "de", "um", "uma", "uns", "umas", "o", "a", "os", "as", "do", "da", "dos", "das", "algo", "alguma", "algum", "coisa", "mais", "tipo", "estilo", "musica", "musicas", "som", "sonzinho", "playlist", "hoje", "la", "isso", "essa", "esse", "pra", "mim", "por", "favor", "agora", "sem", "deixa", "nada", "claro", "show", "top", "fechou", "partiu", "demorou", "uhum", "aham", "dispenso", "silencio", "e", "bem", "so", "tem", "problema"]);
// Em volta do gênero só pode sobrar enfeite ("um rock bem animado" = rock; "pagode do Thiaguinho" = cantor).
const GENRE_FILLERS = new Set([...REPLY_FILLERS, "animado", "animada", "leve", "tranquilo", "tranquila", "calmo", "calma", "bom", "boa", "raiz", "antigo", "antiga", "antigos", "antigas", "classico", "classicos", "pesado", "nacional"]);
// Cara de pergunta/pedido do CRM, não de cantor: segue o fluxo normal do modelo.
const QUESTION_START = /^(quanto|quantos|quantas|qual|quais|como|o que|oque|que|quem|onde|quando|por que|porque|cade|fala|diz|passa|mostra|abre|abrir|lembra|lembrete|avisa|liga|desliga|para|pausa|volume|aumenta|abaixa|teve|esquece)\b/;
const CRM_WORDS = /\b(cliente|clientes|relatorio|agenda|meta|metas|ranking|corretor|corretora|corretores|venda|vendas|lead|leads|simulacao|simulacoes|whatsapp|tela|financeiro|tarefa|tarefas|pendencia|pendencias|reuniao|aniversario|aniversariante|dia|resumo)\b/;
export const MORNING_ARTIST_MAX_WORDS = 5;

function findGenre(normalized) {
  let best = null;
  for (const item of MORNING_GENRES) {
    for (const word of item.words) {
      if (` ${normalized} `.includes(` ${word} `) && (!best || word.length > best.word.length)) best = { genre: item, word };
    }
  }
  return best;
}

const isFillerToken = (token) => token.norm.split(" ").every((part) => REPLY_FILLERS.has(part));

// Resposta à pergunta da música do bom dia → { kind: "yes" | "no" | "genre" | "artist" | "other", genre?, query? }.
// Sem IA: só enfeite/aceite = classifyMorningMusicAnswer ("yes"/"no"); "tanto faz" = "yes" (toca a sugestão); gênero da
// lista = "genre"; nome curto (até 5 palavras) que não é pergunta nem assunto do CRM = "artist" (query = o nome como ele
// falou, para a busca); o resto = "other" (fluxo normal do modelo).
export function classifyMorningMusicReply(text) {
  const raw = String(text || "").replace(/\b(henry|henri)\b[,!.]?/gi, " ").trim();
  if (!normalizeSpeechText(raw)) return { kind: "other" };
  if (/\?["'”’)\s]*$/.test(raw)) return { kind: "other" };
  const tokens = raw.split(/\s+/).map((piece) => ({ original: piece.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}&'’]+$/gu, ""), norm: normalizeSpeechText(piece) })).filter((token) => token.norm);
  let start = 0;
  let end = tokens.length;
  while (start < end && isFillerToken(tokens[start])) start += 1;
  while (end > start && isFillerToken(tokens[end - 1])) end -= 1;
  const core = tokens.slice(start, end);
  const coreNorm = core.map((token) => token.norm).join(" ");
  if (!coreNorm) {
    const answer = classifyMorningMusicAnswer(raw);
    return { kind: answer === "no" ? "no" : answer === "other" ? "other" : "yes" };
  }
  if (has(` ${coreNorm} `, ANY) || has(words(raw), ["nao sei", "sei la"])) return { kind: "yes" };
  if (QUESTION_START.test(coreNorm) || CRM_WORDS.test(coreNorm)) return { kind: "other" };
  const found = findGenre(coreNorm);
  if (found) {
    const rest = ` ${coreNorm} `.replace(` ${found.word} `, " ").trim().split(" ").filter((word) => word && !GENRE_FILLERS.has(word));
    if (!rest.length) return { kind: "genre", genre: found.genre };
  }
  if (core.length > MORNING_ARTIST_MAX_WORDS) return { kind: "other" };
  const query = core.map((token) => token.original).filter(Boolean).join(" ").trim().slice(0, 60);
  return query ? { kind: "artist", query } : { kind: "other" };
}

// Sim/não curto (rascunho do aniversário e aviso de aniversariante) → "yes" | "no" | "other".
export function classifyYesNo(text) {
  const value = words(text);
  if (!value.trim()) return "other";
  const answer = yesOrNo(value);
  if (answer) return answer;
  return has(value, ["prepara", "prepare", "faz", "faca", "escreve", "rascunha", "avisa", "avise", "envia", "envie"]) ? "yes" : "other";
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

// Pergunta do aniversário (só primeiros nomes, no máximo 3 citados). Gênero pelo primeiro nome (regra da VOZ-1,
// genderFromFirstName): "da cliente Ana ... pra ela"; nome masculino ou incerto = masculino genérico, como antes (dono, 2026-10-24: concordância).
export function birthdayQuestion(names = []) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "";
  const genders = list.map((name) => genderFromFirstName(name));
  if (list.length === 1) {
    if (genders[0] === "female") return `Hoje é aniversário da cliente ${list[0]}. Quer que eu prepare uma mensagem pra ela?`;
    return `Hoje é aniversário do cliente ${list[0]}. Quer que eu prepare uma mensagem pra ele?`;
  }
  const shown = list.slice(0, 3);
  const rest = list.length - shown.length;
  const spoken = rest > 0 ? `${shown.join(", ")} e mais ${rest}` : joinNames(shown);
  if (genders.every((gender) => gender === "female")) return `Hoje é aniversário das clientes ${spoken}. Quer que eu prepare uma mensagem pra elas?`;
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
