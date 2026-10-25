// Sugestão de música do "bom dia, Henry".
// [REGRA OFICIAL — dono, 2026-10-25] "Eu quero que, quando iniciar o dia, o Henry sugira algo do tipo, como ele já fala:
// 'Matheus, enquanto passo as informações, gostaria que eu tocasse alguma música de fundo?' Então, se eu falar ok, ele
// toca músicas nesse estilo." + (mesmo dia) "Eu quero que ele toque músicas no estilo que você descreveu, as da série
// Suits. Se eu quiser outro estilo, eu respondo pedindo." — substitui a sugestão de faixa/artista específico variada por
// dia (dono, 2026-10-24: "Bora de Pense em Mim, do Leandro e Leonardo…?"), histórico em docs/BUSINESS_RULES.md HENRY-1.
// Regras PURAS (sem banco, sem env, sem rede):
//   - a abertura oferece música DE FUNDO num estilo FIXO: o clima da trilha de Suits (indie/rock alternativo com
//     eletrônico, soul/funk e um pouco de hip-hop — "Greenback Boogie", Ima Robot; The Black Keys, Kings of Leon, Foster
//     the People, Fitz and The Tantrums, The Heavy, Moby). Sem rodízio de estilos: varia só a frase;
//   - aceite curto ("ok", "pode", "bora") = PLAYLIST de Suits (várias músicas, nunca uma faixa só); sem playlist → a
//     reserva (MORNING_SUITS_FALLBACKS: outra busca de playlist, depois o artista Ima Robot);
//   - uma frase curta terminando em "?" (pergunta aberta: "pode", "manda", "não" valem sem o nome — openPendingReply),
//     sempre aberta para outro estilo ou cantor (classifyMorningMusicReply, regra de sempre);
//   - o registro (crm_settings henry_morning_music) guarda o que foi oferecido hoje (id + estilo + o que tocar).
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { morningGenreOf, resolveMorningMusic, sanitizeMorningMusic } from "./henry-morning-core.mjs";

export const MORNING_MUSIC_SETTING_ID = "henry_morning_music";
export const MORNING_SUGGESTION_TOPIC = "bom_dia_musica";
export const MORNING_SUGGESTION_HISTORY = 20; // ofertas guardadas (≈ 3 semanas de bom dia)
// Escopos que o gosto do dono exige (o OAuth de hoje NÃO pede — trocar exige o dono reconectar o Spotify). Desde
// 2026-10-25 só a resposta com um gênero usa o gosto (playlist DELE com o gênero no nome, morningGenreTarget).
export const SPOTIFY_TASTE_SCOPES = Object.freeze(["user-top-read", "user-read-recently-played", "playlist-read-private"]);

// Dono, 2026-10-25: "Eu não quero uma playlist da trilha sonora de Suits. Quero que você analise o estilo musical e ele
// peça nesse estilo, porque senão vai tocar a música de abertura, que não é legal. Quero as músicas que tocam no meio da
// série." + "Não exatamente as mesmas músicas, eu quero aquele estilo." → a busca é SEMPRE por playlist de ESTILO
// (indie rock/rock alternativo com groove, soul-funk moderno, indie eletrônico, blues-rock), nunca pela série, nunca a
// abertura; resultado com "Suits", "Ima Robot" ou "Greenback" no nome é descartado (SUITS_EXCLUDED_WORDS).
// "um som no clima de Suits" é só a referência de estilo na fala.
export const SUITS_EXCLUDED_WORDS = Object.freeze(["suits", "ima robot", "greenback"]);
// Termos de busca de playlist do estilo (sorteados, nunca o de ontem).
export const SUITS_STYLE_QUERIES = Object.freeze(["indie rock groove", "soul funk moderno", "blues rock moderno", "indie alternative", "modern soul", "alt rock groove"]);
// Reserva só quando nenhuma playlist de estilo aparece: as mais tocadas de um artista desse estilo (nunca lista de faixas).
export const SUITS_STYLE_ARTISTS = Object.freeze(["The Black Keys", "Kings of Leon", "Foster the People", "Fitz and The Tantrums", "The Heavy", "Cage the Elephant", "Portugal. The Man", "Arctic Monkeys", "Alabama Shakes", "Black Pumas", "Gary Clark Jr.", "Glass Animals"]);
const SUITS_SAY = "um som no clima de Suits";

// genre "suits" = gênero de MORNING_GENRES (henry-morning-core.mjs, busca "indie rock groove"): "pode ser esse de Suits
// mesmo" toca a sugestão (Treino 10/11: gênero pedido = o sugerido); outro gênero → toca o pedido.
const suitsSuggestion = (query) => Object.freeze({
  id: "estilo-suits",
  kind: "style",
  say: SUITS_SAY,
  target: Object.freeze({ query, type: "playlist", exclude: SUITS_EXCLUDED_WORDS }),
  choice: "",
  genre: "suits",
  topics: [MORNING_SUGGESTION_TOPIC]
});
export const MORNING_SUGGESTIONS = Object.freeze(SUITS_STYLE_QUERIES.map(suitsSuggestion));

const clean = (value, max = 60) => String(value || "").replace(/[\u0000-\u001f<>{}[\]`"\\|#*^$]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const isUri = (value) => /^spotify:(track|playlist|album|artist):[A-Za-z0-9]{10,40}$/.test(String(value || ""));

// Momento do dia/semana (São Paulo) → complemento de uma das frases da oferta.
export function morningMoment(now = new Date()) {
  const { weekday, minutes } = saoPauloNow(now);
  if (weekday === 0) return { when: "pra um domingo de boa", mood: "leve" };
  if (weekday === 6) return { when: "pra um sábado de boa", mood: "leve" };
  if (minutes < 7 * 60) return { when: "pra acordar devagar", mood: "leve" };
  if (weekday === 1) return { when: "pra começar a semana", mood: "animado" };
  if (weekday === 5) return { when: "pra fechar a semana", mood: "animado" };
  return { when: "pra começar o dia", mood: "" };
}

const pickIndex = (length, random) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * length));

// Texto com "Suits", "Ima Robot" ou "Greenback" (a série/a abertura) — nunca vira busca.
export function hasSuitsExcludedWord(text) {
  const value = normalizeSpeechText(text);
  return SUITS_EXCLUDED_WORDS.some((word) => value.includes(word));
}
const hasExcluded = hasSuitsExcludedWord;

// O que oferecer: sempre o clima de Suits; o termo de busca do estilo é sorteado, nunca o de ontem (lastQuery = termo da
// última oferta guardada em henry_morning_music).
export function pickMorningSuggestion({ lastQuery = "", random = Math.random, pool = MORNING_SUGGESTIONS } = {}) {
  const list = (pool || []).filter((entry) => !hasExcluded(entry?.target?.query));
  if (!list.length) return null;
  const last = normalizeSpeechText(lastQuery);
  const fresh = list.filter((entry) => normalizeSpeechText(entry.target.query) !== last);
  const scope = fresh.length ? fresh : list;
  return scope[pickIndex(scope.length, random)];
}

// Nenhuma playlist do termo sorteado → outro termo do estilo (playlist) e, por último, as mais tocadas de um artista do
// estilo (rodízio pelo sorteio). Sempre com o filtro de "Suits/Ima Robot/Greenback". [] = não é a sugestão de Suits.
export function morningStyleFallbacks(suggestion, { random = Math.random } = {}) {
  if (suggestion?.kind !== "style" || suggestion?.genre !== "suits") return [];
  const tried = normalizeSpeechText(suggestion?.target?.query);
  const others = SUITS_STYLE_QUERIES.filter((query) => normalizeSpeechText(query) !== tried);
  const query = others[pickIndex(others.length, random)];
  const artist = SUITS_STYLE_ARTISTS[pickIndex(SUITS_STYLE_ARTISTS.length, random)];
  return [
    { query, type: "playlist", exclude: SUITS_EXCLUDED_WORDS },
    { query: artist, type: "artist", broad: true, exclude: SUITS_EXCLUDED_WORDS }
  ];
}

// Frase falada: saudação + oferta de música DE FUNDO no estilo + abertura para outro estilo ou cantor, sempre "?"
// (dono, 2026-10-25: "Matheus, enquanto passo as informações, gostaria que eu tocasse alguma música de fundo?").
// avoid = começos já usados hoje (openingsFrom); said = falas dele de hoje — repetir o bom dia no mesmo dia (botão ▶)
// muda a saudação, a oferta e a abertura enquanto houver outra.
const GREETINGS = [(name) => `Bom dia, ${name}!`, (name) => `E aí, ${name}!`, (name) => `Fala, ${name}!`, (name) => `Opa, bom dia, ${name}!`];
const OFFERS = [
  (s) => `Enquanto te passo as informações, quer que eu coloque ${s} de fundo?`,
  (s) => `Enquanto eu te conto como tá o dia, posso deixar ${s} tocando de fundo?`,
  (s) => `Quer ${s} de fundo enquanto te passo as informações?`,
  (s, w) => `Que tal ${s} de fundo ${w}, enquanto te passo as informações?`,
  (s) => `Bora deixar ${s} rolando de fundo enquanto eu te atualizo?`
];
// Abertura para outro estilo ou cantor (dono, 2026-10-24: "eu posso ou falar qual estilo ou responder o cantor e ele
// procura"). Sem lista de estilos: o estilo oferecido vem antes e nada repete o que ele acabou de sugerir (Treino 4).
const MORNING_OPEN_TEMPLATES = Object.freeze([
  "Ou prefere outro estilo ou algum cantor?",
  "Se quiser outro estilo ou um cantor, é só falar, beleza?",
  "Ou tá mais na vibe de outro estilo ou de algum cantor?",
  "Ou me diz outro estilo ou cantor que eu procuro, pode ser?"
]);
export function morningOpenChoices() {
  return [...MORNING_OPEN_TEMPLATES];
}
export const MORNING_OPEN_CHOICES = MORNING_OPEN_TEMPLATES;
export function morningSuggestionLine(suggestion, address = "Matheus", { now = new Date(), avoid = [], said = [], random = Math.random } = {}) {
  const name = address || "Matheus";
  const { when } = morningMoment(now);
  const say = suggestion?.say || "uma música";
  const saidToday = (said || []).map((text) => normalizeSpeechText(text)).join(" | ");
  const headOf = (text, words = 4) => normalizeSpeechText(text.split(/\s+/).slice(0, words).join(" ").replace(/[.,!?…:;]+$/, ""));
  // Oferta já dita hoje (o mesmo começo) não volta enquanto houver outra.
  const offers = OFFERS.map((offer) => offer(say, when));
  const freshOffers = offers.filter((offer) => !saidToday.includes(headOf(offer, 5)));
  const offerList = freshOffers.length ? freshOffers : offers;
  const offer = offerList[pickIndex(offerList.length, random)];
  const used = new Set((avoid || []).map((text) => normalizeSpeechText(text)));
  const lines = GREETINGS.map((greet) => `${greet(name)} ${offer}`);
  const fresh = lines.filter((text) => !used.has(headOf(text)));
  const list = fresh.length ? fresh : lines;
  const line = list[pickIndex(list.length, random)];
  const tails = MORNING_OPEN_TEMPLATES.filter((tail) => !saidToday.includes(headOf(tail)));
  const tailList = tails.length ? tails : MORNING_OPEN_TEMPLATES;
  return `${line} ${tailList[pickIndex(tailList.length, random)]}`;
}

// Aceite do estilo oferecido ("ok", "pode"): confirma curto antes do relatório ("Lá vai um som no clima de Suits de fundo.").
// Só para sugestão de estilo (registro antigo de faixa/artista do mesmo dia = sem frase, como antes).
export function morningStyleAcceptLine(suggestion) {
  const say = clean(suggestion?.say, 60);
  return suggestion?.kind === "style" && say ? `Lá vai ${say} de fundo.` : "";
}

// Gênero escolhido na resposta (classifyMorningMusicReply) → o que tocar. Ordem: link/nome configurado na tela (rock e
// sertanejo, como sempre) → uma playlist DELE com o gênero no nome (gosto do Spotify, só com SPOTIFY_TASTE_SCOPES) →
// padrão do dono (rock clássico / Zezé) → busca de playlist do gênero. choice "sertanejo" só no Zezé/configurado (MIROSMAR).
// Treino 12: com qualificador falado (mood, "um sertanejo mais animado") = busca de playlist "<gênero> <qualificador>"
// ("sertanejo animado"), antes do link configurado/Zezé — o padrão do dono não é "animado".
export function morningGenreTarget(genre, { style = {}, taste = null, mood = "" } = {}) {
  if (!genre?.id) return null;
  const qualifier = clean(mood, 20);
  // Clima de Suits pedido na resposta: busca de playlist do ESTILO (nunca "Suits" nem playlist dele com "Suits" no nome).
  if (genre.id === "suits") {
    const query = qualifier ? `${genre.query} ${qualifier}` : genre.query;
    return { target: { query, type: "playlist", exclude: SUITS_EXCLUDED_WORDS }, choice: "genero", query };
  }
  if (qualifier) {
    const query = `${genre.label} ${qualifier}`;
    return { target: { query, type: "playlist" }, choice: "genero", query };
  }
  const legacy = genre.id === "rock" || genre.id === "sertanejo" ? genre.id : "";
  const configured = legacy ? sanitizeMorningMusic(legacy === "rock" ? style?.rockMusic : style?.sertanejoMusic) : "";
  if (legacy && configured) return { target: resolveMorningMusic(legacy, style), choice: legacy, query: configured };
  const mine = (taste?.playlists?.items || []).find((list) => isUri(list?.uri) && genre.words.some((word) => ` ${normalizeSpeechText(list?.name)} `.includes(` ${word} `)));
  if (mine) return { target: { uri: mine.uri }, choice: "genero", query: clean(mine.name) || genre.label };
  if (legacy) {
    const target = resolveMorningMusic(legacy, style);
    return { target, choice: legacy, query: target.query || genre.label };
  }
  return { target: { query: genre.query, type: "playlist" }, choice: "genero", query: genre.query };
}

// Cantor/banda falado → busca larga (faixa, artista, playlist, álbum) preferindo o ARTISTA: tocar o artista = as músicas
// mais tocadas dele. Nada bate → o servidor pergunta "Achei X, de Y. É essa?" (step music_confirm), sem tocar.
export function morningArtistTarget(query) {
  const value = clean(query, 60);
  return value ? { query: value, type: "artist", broad: true } : null;
}

// "Achei X, de Y. É essa?" — a mesma frase da regra da busca (describeSpotifyResult), curta para a voz.
export function morningConfirmLine(candidate = {}) {
  const name = clean(candidate?.name, 60);
  if (!name) return "";
  const who = candidate?.artists && candidate.artists !== "playlist" ? `, de ${clean(candidate.artists, 50)}` : "";
  return `Achei ${name}${who}. É essa?`;
}

// Candidato da pergunta "É essa?" guardado no mesmo registro (henry_morning_music.confirm: só URI, nome e data).
export function rememberMorningConfirm(stored, candidate, today) {
  const base = { recent: morningSuggestionHistory(stored) };
  if (!isUri(candidate?.uri)) return base;
  return { ...base, confirm: { date: today, uri: candidate.uri, name: clean(candidate.name), artists: clean(candidate.artists, 50) } };
}

export function todaysMorningConfirm(stored, today) {
  const confirm = stored?.confirm;
  return confirm && confirm.date === today && isUri(confirm.uri) ? confirm : null;
}

// Registro dos últimos dias (crm_settings henry_morning_music): { recent: [{ id, date, kind, say, target, choice }] }.
export function morningSuggestionHistory(stored) {
  const list = Array.isArray(stored?.recent) ? stored.recent : [];
  return list.filter((entry) => entry && typeof entry.id === "string" && entry.target && typeof entry.target === "object").slice(-MORNING_SUGGESTION_HISTORY);
}

export function rememberMorningSuggestion(stored, suggestion, today) {
  const entry = { id: suggestion.id, date: today, kind: suggestion.kind, say: suggestion.say, choice: suggestion.choice || "", ...(suggestion.genre ? { genre: suggestion.genre } : {}), target: { ...suggestion.target } };
  return { recent: [...morningSuggestionHistory(stored), entry].slice(-MORNING_SUGGESTION_HISTORY) };
}

// Sugestão feita HOJE (a mais nova) — o que tocar quando ele aceita ("pode", "manda"). null = não houve (ex.: a gravação
// falhou) → o servidor cai na pergunta antiga do estilo.
export function todaysMorningSuggestion(stored, today) {
  const list = morningSuggestionHistory(stored);
  const last = list[list.length - 1];
  return last && last.date === today ? last : null;
}

// Treino 10 (2026-10-25: sugestão "um sertanejo raiz de respeito" → "pode ser um sertanejo mesmo, tanto faz o cantor"): o
// gênero pedido é o da sugestão de hoje → toca a SUGESTÃO (o que foi oferecido); outro gênero → toca o gênero pedido.
export function morningSuggestionMatchesGenre(suggestion, genre) {
  if (!suggestion || !genre?.id) return false;
  // Treino 11: o gênero do item (guardado com a sugestão; registro antigo sem ele → o do banco pelo id) antes do texto.
  const own = suggestion.genre || MORNING_SUGGESTIONS.find((entry) => entry.id === suggestion.id)?.genre || morningGenreOf(`${suggestion.say || ""} ${suggestion.target?.query || ""}`)?.id || "";
  // Rock nacional sugerido + "um rock" pedido = rock clássico (Treino 10: o gênero mais específico decide).
  return Boolean(own) && own === genre.id;
}

// Tem os escopos do gosto? scopes = texto do Spotify ("a b c") ou lista. Basta um para usar o que ele liberar.
export function grantedTasteScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/);
  return SPOTIFY_TASTE_SCOPES.filter((scope) => list.includes(scope));
}

// Resposta à sugestão: igual à pergunta da música, mas "toca <outra coisa>" vira "other" (o pedido dele vai para a
// ferramenta do Spotify, nunca toca a sugestão no lugar do que ele pediu).
const ACCEPT_FILLERS = new Set(["ai", "ae", "isso", "essa", "esse", "ela", "ele", "entao", "la", "sim", "pra", "mim", "por", "favor", "pode", "ser", "logo", "ja", "agora", "vai", "manda", "ver", "bora", "a", "o", "musica", "som"]);
export function isOtherMusicRequest(text) {
  const value = normalizeSpeechText(text).replace(/\b(henry|henri)\b/g, " ").replace(/\s+/g, " ").trim();
  const match = /^(?:pode |entao |nao )?(?:toca|toque|tocar|coloca|coloque|bota|bote|poe|ponha|solta|solte)\s+(.+)$/.exec(value);
  if (!match) return false;
  return match[1].split(" ").some((word) => word && !ACCEPT_FILLERS.has(word));
}
