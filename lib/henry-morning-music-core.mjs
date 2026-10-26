// Sugestão de música do "bom dia, Henry".
// [REGRA OFICIAL — dono, 2026-10-26] "Não é para o Henry dizer música no estilo de Suits. É para dizer: 'Que tal uma música
// de fundo? Posso escolher ou você tem alguma de preferência?' Com isso ele escolhe uma animada no estilo rock blues ou algo
// do tipo. Ele tocou uma música nada a ver, mexicana." — substitui a oferta "um som no clima de Suits" (2026-10-25) e a
// sugestão de faixa/artista variada por dia (2026-10-24); histórico em docs/BUSINESS_RULES.md HENRY-1.
// Regras PURAS (sem banco, sem env, sem rede):
//   - a abertura é SEMPRE a frase do dono, variando só a saudação (nunca cita Suits nem um estilo);
//   - aceite ("pode escolher", "escolhe você", "ok", "pode", "manda", "sim", "tanto faz") = o Henry escolhe um ARTISTA da
//     lista rock/blues animada (MORNING_ROCK_BLUES_ARTISTS, sorteado, nunca o de ontem) e toca o artista no Spotify
//     (`spotify:artist:<id>` como contexto = as mais tocadas dele). NUNCA busca de playlist genérica: foi ela que trouxe
//     música mexicana (termo em português "soul funk moderno" e playlists genéricas — docs/INCIDENTES.md). A busca é só de
//     ARTISTA e só vale o artista com o nome EXATO (strict, runSpotifyCommand); sem ele → outros 2 artistas da lista;
//   - preferência na resposta (gênero, cantor, "mas", mood) segue classifyMorningMusicReply, como sempre; "não" = sem música;
//   - o registro (crm_settings henry_morning_music) guarda o que foi oferecido hoje (id + estilo + o artista sorteado).
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { MORNING_OWNER_PLAYLIST_DEFAULT, MORNING_OWNER_PLAYLIST_OWNER, morningGenreOf, resolveMorningMusic, sanitizeMorningMusic, spotifyUriFromLink } from "./henry-morning-core.mjs";

export const MORNING_MUSIC_SETTING_ID = "henry_morning_music";
export const MORNING_SUGGESTION_TOPIC = "bom_dia_musica";
export const MORNING_SUGGESTION_HISTORY = 20; // ofertas guardadas (≈ 3 semanas de bom dia)
// Escopos que o gosto do dono exige (o OAuth de hoje NÃO pede — trocar exige o dono reconectar o Spotify). Desde
// 2026-10-25 só a resposta com um gênero usa o gosto (playlist DELE com o gênero no nome, morningGenreTarget).
export const SPOTIFY_TASTE_SCOPES = Object.freeze(["user-top-read", "user-read-recently-played", "playlist-read-private"]);

// Artistas da escolha automática (dono, 2026-10-26: "uma animada no estilo rock blues ou algo do tipo"): blues rock, rock
// alternativo com groove e indie rock animado. Só estes — a escolha automática nunca sai desta lista.
export const MORNING_ROCK_BLUES_ARTISTS = Object.freeze([
  "The Black Keys", "Rival Sons", "Gary Clark Jr.", "Larkin Poe", "Kaleo", "Greta Van Fleet",
  "The White Stripes", "Royal Blood", "Jack White", "Cage the Elephant", "Arctic Monkeys", "Kings of Leon"
]);
// Palavras proibidas em qualquer resultado da escolha automática (nome, artistas, álbum, descrição, dono): a série/abertura
// de Suits (regra de 2026-10-25, mantida) e o que já tocou fora do estilo (música mexicana, 2026-10-26) ou nada tem de rock/blues.
export const MORNING_MUSIC_EXCLUDED_WORDS = Object.freeze([
  "suits", "ima robot", "greenback",
  "latin", "latino", "latina", "mexicana", "mexicano", "mexico", "regional", "corridos", "corrido", "norteno", "nortena",
  "mariachi", "ranchera", "banda sinaloense", "cumbia", "reggaeton", "bachata", "sertanejo", "funk brasileiro", "pagode",
  "forro", "piseiro", "arrocha"
]);
const ROCK_BLUES_SAY = "um rock blues animado";
export const MORNING_ROCK_BLUES_GENRE = "rock-blues";

// Alvo do Spotify para um artista da lista: só ARTISTA (sem faixa/playlist/álbum), nome exato (strict), filtro acima.
export function rockBluesArtistTarget(artist) {
  return Object.freeze({ query: artist, type: "artist", strict: true, exclude: MORNING_MUSIC_EXCLUDED_WORDS });
}

const rockBluesSuggestion = (artist) => Object.freeze({
  id: "rock-blues",
  kind: "style",
  say: ROCK_BLUES_SAY,
  target: rockBluesArtistTarget(artist),
  choice: "",
  genre: MORNING_ROCK_BLUES_GENRE,
  topics: [MORNING_SUGGESTION_TOPIC]
});
export const MORNING_SUGGESTIONS = Object.freeze(MORNING_ROCK_BLUES_ARTISTS.map(rockBluesSuggestion));

const clean = (value, max = 60) => String(value || "").replace(/[\u0000-\u001f<>{}[\]`"\\|#*^$]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const isUri = (value) => /^spotify:(track|playlist|album|artist):[A-Za-z0-9]{10,40}$/.test(String(value || ""));

// Momento do dia/semana (São Paulo). Desde 2026-10-26 a frase do bom dia não usa o complemento (varia só a saudação).
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
const sameName = (a, b) => normalizeSpeechText(a) === normalizeSpeechText(b);

// Texto com palavra proibida (Suits/abertura, latina/mexicana, regional…) — nunca vira busca da escolha automática.
export function hasMorningExcludedWord(text) {
  const value = ` ${normalizeSpeechText(text)} `;
  return MORNING_MUSIC_EXCLUDED_WORDS.some((word) => value.includes(` ${word} `));
}
const hasExcluded = hasMorningExcludedWord;
const listedArtist = (name) => MORNING_ROCK_BLUES_ARTISTS.find((artist) => sameName(artist, name)) || "";

// O que oferecer: o artista é sorteado da lista, nunca o de ontem (lastQuery = query da última oferta guardada).
export function pickMorningSuggestion({ lastQuery = "", random = Math.random, pool = MORNING_SUGGESTIONS } = {}) {
  const list = (pool || []).filter((entry) => !hasExcluded(entry?.target?.query));
  if (!list.length) return null;
  const fresh = list.filter((entry) => !sameName(entry.target.query, lastQuery));
  const scope = fresh.length ? fresh : list;
  return scope[pickIndex(scope.length, random)];
}

// Sorteia um artista da lista, fora dos já tentados.
export function pickRockBluesArtist({ avoid = [], random = Math.random } = {}) {
  const fresh = MORNING_ROCK_BLUES_ARTISTS.filter((artist) => !(avoid || []).some((name) => sameName(artist, name)));
  const scope = fresh.length ? fresh : MORNING_ROCK_BLUES_ARTISTS;
  return scope[pickIndex(scope.length, random)];
}

// Sugestão de hoje → o que tocar. Rock/blues: o artista guardado (se for da lista) como alvo estrito. Registro antigo do
// mesmo dia (clima de Suits = playlist genérica, a que trouxe música mexicana) vira um artista da lista. Outra coisa
// (registro antigo de faixa/artista específico) = o alvo guardado, como antes.
export function morningSuggestionTarget(suggestion, { random = Math.random } = {}) {
  if (!suggestion?.target) return null;
  const artist = suggestion.genre === MORNING_ROCK_BLUES_GENRE ? listedArtist(suggestion.target.query) : "";
  if (artist) return rockBluesArtistTarget(artist);
  if (suggestion.genre === MORNING_ROCK_BLUES_GENRE || suggestion.genre === "suits") return rockBluesArtistTarget(pickRockBluesArtist({ random }));
  return suggestion.target;
}

// Artista da sugestão não achado (nome exato) → outros 2 artistas da lista, nunca o já tentado. [] = não é rock/blues.
export function morningStyleFallbacks(suggestion, { random = Math.random, tried = [] } = {}) {
  if (suggestion?.kind !== "style" || ![MORNING_ROCK_BLUES_GENRE, "suits"].includes(suggestion?.genre)) return [];
  const avoid = [suggestion?.target?.query, ...(tried || [])].filter(Boolean);
  const first = pickRockBluesArtist({ avoid, random });
  const second = pickRockBluesArtist({ avoid: [...avoid, first], random });
  return [rockBluesArtistTarget(first), rockBluesArtistTarget(second)];
}

// Frase falada (dono, 2026-10-26): saudação + "Que tal uma música de fundo? Posso escolher ou você tem alguma de
// preferência?" — varia SÓ a saudação; nunca cita Suits nem estilo. avoid = começos já usados hoje (openingsFrom); said =
// falas dele de hoje — repetir o bom dia no mesmo dia (botão ▶) troca a saudação enquanto houver outra.
export const MORNING_MUSIC_OFFER = "Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?";
const GREETINGS = [(name) => `Bom dia, ${name}!`, (name) => `E aí, ${name}!`, (name) => `Fala, ${name}!`, (name) => `Opa, bom dia, ${name}!`];
export function morningSuggestionLine(suggestion, address = "Matheus", { avoid = [], said = [], random = Math.random } = {}) {
  const name = address || "Matheus";
  const headOf = (text, words = 4) => normalizeSpeechText(String(text || "").split(/\s+/).slice(0, words).join(" ").replace(/[.,!?…:;]+$/, ""));
  const used = new Set([...(avoid || []), ...(said || [])].map((text) => headOf(text)));
  const greetings = GREETINGS.map((greet) => greet(name));
  const fresh = greetings.filter((text) => !used.has(headOf(`${text} ${MORNING_MUSIC_OFFER}`)));
  const list = fresh.length ? fresh : greetings;
  return `${list[pickIndex(list.length, random)]} ${MORNING_MUSIC_OFFER}`;
}

// Aceite da escolha automática: confirma antes do relatório. [REGRA OFICIAL — dono, 2026-10-26] fala literal, a MESMA
// para a playlist dele e para a reserva de artistas: "Já estou escolhendo uma música para iniciarmos o dia, em seguida já
// te atualizo do que aconteceu enquanto você estava fora." (substitui "Lá vai um rock blues animado de fundo." e a ideia
// "Lá vai a sua playlist …"). Registro antigo do mesmo dia (clima de Suits) também; faixa/artista antigo = sem frase.
export const MORNING_CHOICE_ACCEPT_LINE = "Já estou escolhendo uma música para iniciarmos o dia, em seguida já te atualizo do que aconteceu enquanto você estava fora.";
export function morningStyleAcceptLine(suggestion) {
  if (suggestion?.kind !== "style") return "";
  if ([MORNING_ROCK_BLUES_GENRE, "suits"].includes(suggestion?.genre)) return MORNING_CHOICE_ACCEPT_LINE;
  const say = clean(suggestion?.say, 60);
  return say && !hasExcluded(say) ? `Lá vai ${say} de fundo.` : "";
}

// Gênero escolhido na resposta (classifyMorningMusicReply) → o que tocar. Ordem: link/nome configurado na tela (rock e
// sertanejo, como sempre) → uma playlist DELE com o gênero no nome (gosto do Spotify, só com SPOTIFY_TASTE_SCOPES) →
// padrão do dono (rock clássico / Zezé) → busca de playlist do gênero. choice "sertanejo" só no Zezé/configurado (MIROSMAR).
// Treino 12: com qualificador falado (mood, "um sertanejo mais animado") = busca de playlist "<gênero> <qualificador>"
// ("sertanejo animado"), antes do link configurado/Zezé — o padrão do dono não é "animado".
export function morningGenreTarget(genre, { style = {}, taste = null, mood = "", random = Math.random } = {}) {
  if (!genre?.id) return null;
  const qualifier = clean(mood, 20);
  // "rock blues" (ou o antigo "clima de Suits") pedido na resposta: um artista da lista rock/blues, como a escolha
  // automática (dono, 2026-10-26) — nunca playlist genérica (a que trouxe música mexicana) nem "Suits".
  if (genre.id === MORNING_ROCK_BLUES_GENRE || genre.id === "suits") {
    const target = rockBluesArtistTarget(pickRockBluesArtist({ random }));
    return { target, choice: "genero", query: target.query };
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
  const own = suggestion.genre || MORNING_SUGGESTIONS.find((entry) => entry.id === suggestion.id)?.genre || (suggestion.id === "estilo-suits" ? "suits" : "") || morningGenreOf(`${suggestion.say || ""} ${suggestion.target?.query || ""}`)?.id || "";
  // Rock nacional sugerido + "um rock" pedido = rock clássico (Treino 10: o gênero mais específico decide).
  // O antigo "clima de Suits" (registro do mesmo dia ou dito na resposta) = o rock/blues de hoje (dono, 2026-10-26).
  const same = (id) => (id === "suits" ? MORNING_ROCK_BLUES_GENRE : id);
  return Boolean(own) && same(own) === same(genre.id);
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

// --- Playlist do dono no bom dia (dono, 2026-10-26) ---------------------------------------------------------------------
// [REGRA OFICIAL — dono, 2026-10-26] Print da playlist "Rock Blues Animadas" (dele, pública) + "Toque essa playlist.":
// quando ele deixa o Henry escolher (aceite da oferta do bom dia), toca ESSA playlist (aleatório), não um artista sorteado.
// A lista de artistas (MORNING_ROCK_BLUES_ARTISTS) fica como RESERVA quando a playlist não é achada ou não toca.
export const MORNING_PLAYLIST_SETTING_ID = "henry_morning_playlist"; // cache { name, uri, total, foundAt }
export const MORNING_PLAYLIST_CACHE_DAYS = 30;

// O que a tela configurou (style.morningPlaylist): link/URI do Spotify = toca direto; nome = procura; vazio = o padrão.
export function morningPlaylistSetting(style = {}) {
  const configured = sanitizeMorningMusic(style?.morningPlaylist);
  const uri = configured ? spotifyUriFromLink(configured) : "";
  if (uri && uri.startsWith("spotify:playlist:")) return { name: "", uri };
  if (uri) return { name: "", uri: "" }; // link de outra coisa (faixa/artista) não vale: volta ao padrão
  return { name: configured || MORNING_OWNER_PLAYLIST_DEFAULT, uri: "" };
}

// A aceitação usa a playlist? Só a escolha automática rock/blues (e o registro antigo "clima de Suits" do mesmo dia).
export function usesOwnerPlaylist(suggestion) {
  return suggestion?.kind === "style" && [MORNING_ROCK_BLUES_GENRE, "suits"].includes(suggestion?.genre);
}

// Escolhe a playlist do dono numa lista do Spotify (/v1/me/playlists ou busca type=playlist): nome EXATO (sem acento/caixa)
// E dono = a conta conectada (owner.id) ou, sem id, o nome do dono ("Matheus Machado" / display_name da conta). Nunca uma
// playlist parecida nem de outra pessoa com o mesmo nome. null = nenhuma.
export function pickOwnerPlaylist(items, { name = MORNING_OWNER_PLAYLIST_DEFAULT, ownerId = "", ownerNames = [MORNING_OWNER_PLAYLIST_OWNER] } = {}) {
  const wanted = normalizeSpeechText(name);
  if (!wanted) return null;
  const names = (ownerNames || []).map((value) => normalizeSpeechText(value)).filter(Boolean);
  const owned = (item) => {
    const owner = item?.owner || {};
    if (ownerId && owner.id) return owner.id === ownerId;
    return names.includes(normalizeSpeechText(owner.display_name));
  };
  return (items || []).find((item) => item && isUri(item.uri) && item.uri.startsWith("spotify:playlist:") && normalizeSpeechText(item.name) === wanted && owned(item)) || null;
}

// Quantas faixas (para começar numa posição sorteada): `tracks.total` (formato antigo) ou `items.total` (formato novo).
export function playlistTrackTotal(item) {
  const total = Number(item?.tracks?.total ?? item?.items?.total);
  return Number.isInteger(total) && total > 0 ? total : 0;
}

// Cache da playlist achada (crm_settings henry_morning_playlist): vale para o MESMO nome por até 30 dias.
export function cachedMorningPlaylist(stored, name, now = new Date()) {
  if (!stored || !isUri(stored.uri) || !String(stored.uri).startsWith("spotify:playlist:")) return null;
  if (normalizeSpeechText(stored.name) !== normalizeSpeechText(name)) return null;
  const foundAt = Date.parse(stored.foundAt || "");
  if (!Number.isFinite(foundAt) || now.getTime() - foundAt > MORNING_PLAYLIST_CACHE_DAYS * 86400000) return null;
  return { uri: stored.uri, name: clean(stored.name), total: Number.isInteger(stored.total) && stored.total > 0 ? stored.total : 0 };
}

export function rememberMorningPlaylist({ name, uri, total = 0 }, now = new Date()) {
  return { name: clean(name), uri, total: Number.isInteger(total) && total > 0 ? total : 0, foundAt: now.toISOString() };
}

// Posição de início sorteada (o shuffle do Spotify não sorteia a 1ª faixa): 0..total-1; sem total = sem posição.
export function morningPlaylistOffset(total, random = Math.random) {
  return total > 1 ? pickIndex(total, random) : null;
}
