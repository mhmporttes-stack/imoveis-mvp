// Sugestão de música do "bom dia, Henry" (dono, 2026-10-24: "não quero frase combinada [rock ou sertanejo]; quero que
// soe natural, com o Henry SUGERINDO músicas, playlists ou estilos de um jeito que varie de dia para dia").
// Regras PURAS (sem banco, sem env, sem rede):
//   - base preferida = o gosto do dono no Spotify (mais ouvidos, tocadas recentemente, playlists dele) quando o token
//     tiver os escopos de leitura (SPOTIFY_TASTE_SCOPES); sem isso, um banco fixo variado (rock e sertanejo raiz, os
//     gostos que ele já deu ao Henry) com o momento do dia/semana;
//   - nunca a mesma sugestão em dias seguidos: o MESMO sorteio das frases de espera (pickWaitPhrase) sobre os ids
//     sugeridos nos últimos dias (crm_settings henry_morning_music, só id + o que tocar, sem fala nem dado de cliente);
//   - alterna o tipo (artista, música, playlist dele, estilo) em relação à última sugestão;
//   - uma frase curta terminando em "?" (pergunta aberta: "pode", "manda", "não" valem sem o nome — openPendingReply).
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { pickWaitPhrase } from "./henry-voice-narration.mjs";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { morningGenreOf, resolveMorningMusic, sanitizeMorningMusic } from "./henry-morning-core.mjs";

export const MORNING_MUSIC_SETTING_ID = "henry_morning_music";
export const MORNING_SUGGESTION_TOPIC = "bom_dia_musica";
export const MORNING_SUGGESTION_HISTORY = 20; // ids guardados (≈ 3 semanas de bom dia)
export const MORNING_SUGGESTION_AVOID = 10; // banco esgotado: nunca uma das últimas 10
// Escopos que o gosto do dono exige (o OAuth de hoje NÃO pede — trocar exige o dono reconectar o Spotify).
export const SPOTIFY_TASTE_SCOPES = Object.freeze(["user-top-read", "user-read-recently-played", "playlist-read-private"]);

// genre = id do gênero de MORNING_GENRES (henry-morning-core.mjs) — Treino 11: "Pense em Mim, do Leandro e Leonardo" →
// "pode ser sertanejo mesmo" tocou o Zezé (o texto da sugestão não tem a palavra "sertanejo"); com o gênero no item, o
// gênero pedido igual ao da sugestão toca a sugestão.
const item = (id, kind, say, target, { mood = "animado", choice = "", genre = "" } = {}) => Object.freeze({ id, kind, say, target: Object.freeze(target), mood, choice, genre, topics: [MORNING_SUGGESTION_TOPIC] });

// Banco sem o Spotify do dono. say = como ele fala; target = o que a busca do Spotify toca (exatamente o sugerido).
// choice "sertanejo" = Zezé Di Camargo & Luciano → mantém o "TOOOCA, MIROSMAR!" de sempre (morningMusicPrefix).
export const MORNING_SUGGESTIONS = Object.freeze([
  item("artista-zeze", "artist", "um Zezé Di Camargo e Luciano", { query: "Zezé Di Camargo & Luciano", type: "artist" }, { mood: "leve", choice: "sertanejo", genre: "sertanejo" }),
  item("artista-chitaozinho", "artist", "um Chitãozinho e Xororó", { query: "Chitãozinho & Xororó", type: "artist" }, { mood: "leve", genre: "sertanejo" }),
  item("artista-leandro", "artist", "um Leandro e Leonardo", { query: "Leandro & Leonardo", type: "artist" }, { mood: "leve", genre: "sertanejo" }),
  item("artista-milionario", "artist", "um Milionário e José Rico", { query: "Milionário & José Rico", type: "artist" }, { mood: "leve", genre: "sertanejo" }),
  item("artista-almir", "artist", "um Almir Sater", { query: "Almir Sater", type: "artist" }, { mood: "leve", genre: "sertanejo" }),
  item("artista-legiao", "artist", "um Legião Urbana", { query: "Legião Urbana", type: "artist" }, { genre: "rock-nacional" }),
  item("artista-titas", "artist", "um Titãs", { query: "Titãs", type: "artist" }, { genre: "rock-nacional" }),
  item("artista-barao", "artist", "um Barão Vermelho", { query: "Barão Vermelho", type: "artist" }, { genre: "rock-nacional" }),
  item("artista-engenheiros", "artist", "um Engenheiros do Hawaii", { query: "Engenheiros do Hawaii", type: "artist" }, { mood: "leve", genre: "rock-nacional" }),
  item("artista-queen", "artist", "um Queen", { query: "Queen", type: "artist" }, { genre: "rock" }),
  item("artista-bonjovi", "artist", "um Bon Jovi", { query: "Bon Jovi", type: "artist" }, { genre: "rock" }),
  item("artista-creedence", "artist", "um Creedence", { query: "Creedence Clearwater Revival", type: "artist" }, { genre: "rock" }),
  item("musica-evidencias", "track", "Evidências, do Chitãozinho e Xororó", { query: "Evidências Chitãozinho & Xororó", type: "track" }, { mood: "leve", genre: "sertanejo" }),
  item("musica-e-o-amor", "track", "É o Amor, do Zezé e Luciano", { query: "É o Amor Zezé Di Camargo & Luciano", type: "track" }, { mood: "leve", choice: "sertanejo", genre: "sertanejo" }),
  item("musica-pense-em-mim", "track", "Pense em Mim, do Leandro e Leonardo", { query: "Pense em Mim Leandro & Leonardo", type: "track" }, { mood: "leve", genre: "sertanejo" }),
  item("musica-tocando-em-frente", "track", "Tocando em Frente, do Almir Sater", { query: "Tocando em Frente Almir Sater", type: "track" }, { mood: "leve", genre: "sertanejo" }),
  item("musica-tempo-perdido", "track", "Tempo Perdido, da Legião", { query: "Tempo Perdido Legião Urbana", type: "track" }, { genre: "rock-nacional" }),
  item("musica-bohemian", "track", "Bohemian Rhapsody, do Queen", { query: "Bohemian Rhapsody Queen", type: "track" }, { genre: "rock" }),
  item("musica-livin", "track", "Livin' on a Prayer, do Bon Jovi", { query: "Livin' on a Prayer Bon Jovi", type: "track" }, { genre: "rock" }),
  item("musica-sweet-child", "track", "Sweet Child O' Mine, do Guns", { query: "Sweet Child O' Mine Guns N' Roses", type: "track" }, { genre: "rock" }),
  item("estilo-rock-classico", "style", "algo mais animado, tipo um rock clássico", { query: "rock clássico", type: "playlist" }, { genre: "rock" }),
  item("estilo-rock-nacional", "style", "um rock nacional das antigas", { query: "rock nacional anos 80", type: "playlist" }, { genre: "rock-nacional" }),
  item("estilo-sertanejo-raiz", "style", "um sertanejo raiz de respeito", { query: "sertanejo raiz", type: "playlist" }, { mood: "leve", genre: "sertanejo" }),
  item("estilo-modao", "style", "um modão de viola", { query: "modão", type: "playlist" }, { mood: "leve", genre: "sertanejo" }),
  item("estilo-acustico", "style", "um som acústico mais leve", { query: "acústico", type: "playlist" }, { mood: "leve" })
]);

const clean = (value, max = 60) => String(value || "").replace(/[\u0000-\u001f<>{}[\]`"\\|#*^$]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const isUri = (value) => /^spotify:(track|playlist|album|artist):[A-Za-z0-9]{10,40}$/.test(String(value || ""));
const firstArtist = (track) => clean(track?.artists?.[0]?.name || "", 40);

// Gosto do dono (respostas da Web API: /me/top/artists, /me/top/tracks, /me/player/recently-played, /me/playlists) →
// sugestões com a URI exata (tocar = exatamente o sugerido, sem busca). Nome que não pode ser falado é filtrado no
// servidor (safeHenryReply). Repetidos (mesma URI) entram uma vez; no máximo 8 de cada tipo.
export function spotifyTasteSuggestions({ topArtists = null, topTracks = null, recent = null, playlists = null } = {}) {
  const out = new Map();
  const add = (uri, kind, say, mood = "animado") => {
    if (!isUri(uri) || !say || out.has(uri)) return;
    out.set(uri, Object.freeze({ id: `sp:${uri}`, kind, say, target: Object.freeze({ uri }), mood, choice: "", topics: [MORNING_SUGGESTION_TOPIC], taste: true }));
  };
  for (const artist of (topArtists?.items || []).slice(0, 8)) add(artist?.uri, "artist", clean(artist?.name) ? `um ${clean(artist.name)}` : "");
  const tracks = [...(topTracks?.items || []).slice(0, 8), ...(recent?.items || []).map((entry) => entry?.track).slice(0, 8)];
  for (const track of tracks) {
    const name = clean(String(track?.name || "").replace(/\s+[-–(\[].*$/, ""), 50); // sem " - Remastered 2011", "(Ao Vivo)"
    const artist = firstArtist(track);
    add(track?.uri, "track", name ? (artist ? `${name}, do ${artist}` : name) : "");
  }
  for (const list of (playlists?.items || []).slice(0, 8)) add(list?.uri, "playlist", clean(list?.name) ? `aquela sua playlist ${clean(list.name)}` : "", "leve");
  return [...out.values()];
}

// Momento do dia/semana (São Paulo) → complemento da frase e o "clima" preferido do som. Antes das 7h e fim de semana =
// mais leve; segunda e sexta = mais animado; resto = tanto faz.
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

// Escolha da sugestão. recent = ids sugeridos nos últimos dias, do mais antigo ao mais novo (henry_morning_music).
// Preferência: tipo diferente do da última sugestão + clima do momento; nada fresco nesse recorte → o banco inteiro.
// O sorteio e a não repetição são os de pickWaitPhrase (ids "usados" = recent; esgotado → nunca uma das últimas 10).
export function pickMorningSuggestion({ taste = [], recent = [], lastKind = "", now = new Date(), random = Math.random, pool = MORNING_SUGGESTIONS } = {}) {
  const base = [...(taste || []), ...(taste?.length ? pool.filter((entry) => entry.kind === "style") : pool)];
  if (!base.length) return null;
  const moment = morningMoment(now);
  const recentIds = (recent || []).map(String);
  const used = new Set(recentIds);
  const tries = [
    base.filter((entry) => entry.kind !== lastKind && (!moment.mood || entry.mood === moment.mood)),
    base.filter((entry) => entry.kind !== lastKind),
    base
  ];
  for (const scope of tries) {
    if (!scope.some((entry) => !used.has(entry.id))) continue;
    const choice = pickWaitPhrase({ topic: MORNING_SUGGESTION_TOPIC, recentIds, usedToday: recentIds, random, phrases: scope, avoid: MORNING_SUGGESTION_AVOID });
    if (choice) return choice;
  }
  return pickWaitPhrase({ topic: MORNING_SUGGESTION_TOPIC, recentIds, usedToday: recentIds, random, phrases: base, avoid: Math.min(MORNING_SUGGESTION_AVOID, base.length - 1) });
}

// Frase falada: saudação + sugestão, curta, sempre terminando em "?". avoid = começos já usados hoje (openingsFrom),
// como em morningOpening — repetir o bom dia no mesmo dia (botão ▶) muda a abertura.
const GREETINGS = [(name) => `Bom dia, ${name}!`, (name) => `E aí, ${name}!`, (name) => `Fala, ${name}!`, (name) => `Opa, bom dia, ${name}!`];
const OFFERS = {
  artist: [(s, w) => `Que tal ${s} ${w}?`, (s) => `Tô com vontade de soltar ${s} enquanto te passo o dia, pode ser?`, (s) => `Vai ${s} de fundo enquanto eu te conto como tá o dia?`, (s, w) => `Bora de ${s} ${w}?`],
  track: [(s, w) => `Que tal começar com ${s}?`, (s) => `Solto ${s} enquanto te passo o dia?`, (s, w) => `Bora de ${s} ${w}?`],
  playlist: [(s, w) => `Que tal ${s} ${w}?`, (s) => `Coloco ${s} de fundo enquanto te passo o dia?`],
  style: [(s, w) => `Que tal ${s} ${w}?`, (s) => `Tô pensando em ${s} de fundo enquanto te passo o dia, bora?`, (s, w) => `Vai ${s} ${w}?`]
};
// Abertura para estilo ou cantor depois da sugestão (dono, 2026-10-24: "acrescente também opção de estilo musical como
// rock, sertanejo; aí eu posso ou falar qual estilo ou responder o cantor e ele procura"). A sugestão concreta vem
// primeiro (nunca só "rock ou sertanejo"); sempre termina em "?" (pergunta aberta); said = falas dele de hoje: a abertura já dita hoje não volta enquanto houver outra.
// Os 3 estilos citados saem desta lista, SEM o estilo da própria sugestão (Treino 4, 2026-10-25: "Vai um sertanejo raiz…?
// Ou tá na vibe de outro estilo, rock, sertanejo, pagode…" repetia o sugerido).
const MORNING_OPEN_STYLES = ["rock", "sertanejo", "pagode", "MPB"];
const MORNING_OPEN_TEMPLATES = [
  ([a, b, c]) => `Ou prefere me falar um estilo, tipo ${a}, ${b} ou ${c}, ou um cantor que eu procuro?`,
  ([a, b, c]) => `Ou quer escolher um estilo, ${a}, ${b}, ${c}, ou falar o nome de um cantor?`,
  ([a, b, c]) => `Ou prefere outro estilo, tipo ${a}, ${b} ou ${c}, ou algum cantor?`,
  ([a, b, c]) => `Ou tá na vibe de outro estilo, ${a}, ${b}, ${c}, ou de algum cantor?`,
  ([a, b, c]) => `Ou me diz um cantor ou um estilo, pode ser ${a}, ${b}, ${c}, que eu acho, beleza?`
];
// Aberturas para uma sugestão (sem o estilo dela). Sem sugestão: rock, sertanejo e pagode, como sempre.
export function morningOpenChoices(suggestion = null) {
  const said = ` ${normalizeSpeechText(suggestion?.say || "")} `;
  const styles = MORNING_OPEN_STYLES.filter((style) => !said.includes(` ${normalizeSpeechText(style)} `)).slice(0, 3);
  return MORNING_OPEN_TEMPLATES.map((template) => template(styles));
}
export const MORNING_OPEN_CHOICES = Object.freeze(morningOpenChoices(null));
export function morningSuggestionLine(suggestion, address = "Matheus", { now = new Date(), avoid = [], said = [], random = Math.random } = {}) {
  const name = address || "Matheus";
  const { when } = morningMoment(now);
  const offers = OFFERS[suggestion?.kind] || OFFERS.style;
  const offer = offers[pickIndex(offers.length, random)](suggestion?.say || "uma música", when);
  const used = new Set((avoid || []).map((text) => normalizeSpeechText(text)));
  const lines = GREETINGS.map((greet) => `${greet(name)} ${offer.charAt(0).toUpperCase()}${offer.slice(1)}`);
  const startOf = (text) => normalizeSpeechText(text.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?…:;]+$/, ""));
  const fresh = lines.filter((text) => !used.has(startOf(text)));
  const list = fresh.length ? fresh : lines;
  const line = list[pickIndex(list.length, random)];
  const saidToday = (said || []).map((text) => normalizeSpeechText(text)).join(" | ");
  // Abertura já dita hoje = o mesmo começo (as 4 primeiras palavras; os estilos citados mudam conforme a sugestão).
  const choices = morningOpenChoices(suggestion);
  const headOf = (tail) => normalizeSpeechText(tail.split(/\s+/).slice(0, 4).join(" "));
  const tails = choices.filter((tail) => !saidToday.includes(headOf(tail)));
  const tailList = tails.length ? tails : choices;
  return `${line} ${tailList[pickIndex(tailList.length, random)]}`;
}

// Gênero escolhido na resposta (classifyMorningMusicReply) → o que tocar. Ordem: link/nome configurado na tela (rock e
// sertanejo, como sempre) → uma playlist DELE com o gênero no nome (gosto do Spotify, só com SPOTIFY_TASTE_SCOPES) →
// padrão do dono (rock clássico / Zezé) → busca de playlist do gênero. choice "sertanejo" só no Zezé/configurado (MIROSMAR).
// Treino 12: com qualificador falado (mood, "um sertanejo mais animado") = busca de playlist "<gênero> <qualificador>"
// ("sertanejo animado"), antes do link configurado/Zezé — o padrão do dono não é "animado".
export function morningGenreTarget(genre, { style = {}, taste = null, mood = "" } = {}) {
  if (!genre?.id) return null;
  const qualifier = clean(mood, 20);
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
