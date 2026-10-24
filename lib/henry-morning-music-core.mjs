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

export const MORNING_MUSIC_SETTING_ID = "henry_morning_music";
export const MORNING_SUGGESTION_TOPIC = "bom_dia_musica";
export const MORNING_SUGGESTION_HISTORY = 20; // ids guardados (≈ 3 semanas de bom dia)
export const MORNING_SUGGESTION_AVOID = 10; // banco esgotado: nunca uma das últimas 10
// Escopos que o gosto do dono exige (o OAuth de hoje NÃO pede — trocar exige o dono reconectar o Spotify).
export const SPOTIFY_TASTE_SCOPES = Object.freeze(["user-top-read", "user-read-recently-played", "playlist-read-private"]);

const item = (id, kind, say, target, { mood = "animado", choice = "" } = {}) => Object.freeze({ id, kind, say, target: Object.freeze(target), mood, choice, topics: [MORNING_SUGGESTION_TOPIC] });

// Banco sem o Spotify do dono. say = como ele fala; target = o que a busca do Spotify toca (exatamente o sugerido).
// choice "sertanejo" = Zezé Di Camargo & Luciano → mantém o "TOOOCA, MIROSMAR!" de sempre (morningMusicPrefix).
export const MORNING_SUGGESTIONS = Object.freeze([
  item("artista-zeze", "artist", "um Zezé Di Camargo e Luciano", { query: "Zezé Di Camargo & Luciano", type: "artist" }, { mood: "leve", choice: "sertanejo" }),
  item("artista-chitaozinho", "artist", "um Chitãozinho e Xororó", { query: "Chitãozinho & Xororó", type: "artist" }, { mood: "leve" }),
  item("artista-leandro", "artist", "um Leandro e Leonardo", { query: "Leandro & Leonardo", type: "artist" }, { mood: "leve" }),
  item("artista-milionario", "artist", "um Milionário e José Rico", { query: "Milionário & José Rico", type: "artist" }, { mood: "leve" }),
  item("artista-almir", "artist", "um Almir Sater", { query: "Almir Sater", type: "artist" }, { mood: "leve" }),
  item("artista-legiao", "artist", "um Legião Urbana", { query: "Legião Urbana", type: "artist" }),
  item("artista-titas", "artist", "um Titãs", { query: "Titãs", type: "artist" }),
  item("artista-barao", "artist", "um Barão Vermelho", { query: "Barão Vermelho", type: "artist" }),
  item("artista-engenheiros", "artist", "um Engenheiros do Hawaii", { query: "Engenheiros do Hawaii", type: "artist" }, { mood: "leve" }),
  item("artista-queen", "artist", "um Queen", { query: "Queen", type: "artist" }),
  item("artista-bonjovi", "artist", "um Bon Jovi", { query: "Bon Jovi", type: "artist" }),
  item("artista-creedence", "artist", "um Creedence", { query: "Creedence Clearwater Revival", type: "artist" }),
  item("musica-evidencias", "track", "Evidências, do Chitãozinho e Xororó", { query: "Evidências Chitãozinho & Xororó", type: "track" }, { mood: "leve" }),
  item("musica-e-o-amor", "track", "É o Amor, do Zezé e Luciano", { query: "É o Amor Zezé Di Camargo & Luciano", type: "track" }, { mood: "leve", choice: "sertanejo" }),
  item("musica-pense-em-mim", "track", "Pense em Mim, do Leandro e Leonardo", { query: "Pense em Mim Leandro & Leonardo", type: "track" }, { mood: "leve" }),
  item("musica-tocando-em-frente", "track", "Tocando em Frente, do Almir Sater", { query: "Tocando em Frente Almir Sater", type: "track" }, { mood: "leve" }),
  item("musica-tempo-perdido", "track", "Tempo Perdido, da Legião", { query: "Tempo Perdido Legião Urbana", type: "track" }),
  item("musica-bohemian", "track", "Bohemian Rhapsody, do Queen", { query: "Bohemian Rhapsody Queen", type: "track" }),
  item("musica-livin", "track", "Livin' on a Prayer, do Bon Jovi", { query: "Livin' on a Prayer Bon Jovi", type: "track" }),
  item("musica-sweet-child", "track", "Sweet Child O' Mine, do Guns", { query: "Sweet Child O' Mine Guns N' Roses", type: "track" }),
  item("estilo-rock-classico", "style", "algo mais animado, tipo um rock clássico", { query: "rock clássico", type: "playlist" }),
  item("estilo-rock-nacional", "style", "um rock nacional das antigas", { query: "rock nacional anos 80", type: "playlist" }),
  item("estilo-sertanejo-raiz", "style", "um sertanejo raiz de respeito", { query: "sertanejo raiz", type: "playlist" }, { mood: "leve" }),
  item("estilo-modao", "style", "um modão de viola", { query: "modão", type: "playlist" }, { mood: "leve" }),
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
export function morningSuggestionLine(suggestion, address = "Matheus", { now = new Date(), avoid = [], random = Math.random } = {}) {
  const name = address || "Matheus";
  const { when } = morningMoment(now);
  const offers = OFFERS[suggestion?.kind] || OFFERS.style;
  const offer = offers[pickIndex(offers.length, random)](suggestion?.say || "uma música", when);
  const used = new Set((avoid || []).map((text) => normalizeSpeechText(text)));
  const lines = GREETINGS.map((greet) => `${greet(name)} ${offer.charAt(0).toUpperCase()}${offer.slice(1)}`);
  const startOf = (text) => normalizeSpeechText(text.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?…:;]+$/, ""));
  const fresh = lines.filter((text) => !used.has(startOf(text)));
  const list = fresh.length ? fresh : lines;
  return list[pickIndex(list.length, random)];
}

// Registro dos últimos dias (crm_settings henry_morning_music): { recent: [{ id, date, kind, say, target, choice }] }.
export function morningSuggestionHistory(stored) {
  const list = Array.isArray(stored?.recent) ? stored.recent : [];
  return list.filter((entry) => entry && typeof entry.id === "string" && entry.target && typeof entry.target === "object").slice(-MORNING_SUGGESTION_HISTORY);
}

export function rememberMorningSuggestion(stored, suggestion, today) {
  const entry = { id: suggestion.id, date: today, kind: suggestion.kind, say: suggestion.say, choice: suggestion.choice || "", target: { ...suggestion.target } };
  return { recent: [...morningSuggestionHistory(stored), entry].slice(-MORNING_SUGGESTION_HISTORY) };
}

// Sugestão feita HOJE (a mais nova) — o que tocar quando ele aceita ("pode", "manda"). null = não houve (ex.: a gravação
// falhou) → o servidor cai na pergunta antiga do estilo.
export function todaysMorningSuggestion(stored, today) {
  const list = morningSuggestionHistory(stored);
  const last = list[list.length - 1];
  return last && last.date === today ? last : null;
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
