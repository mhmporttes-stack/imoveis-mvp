// Spotify no Henry (dono, 2026-10-22: "Spotify, só para mim"; docs/BUSINESS_RULES.md HENRY-1). Regras PURAS (sem banco,
// sem env): endereço de autorização, comando vindo da ferramenta `spotify`, renovação do token de acesso e execução dos
// comandos na Web API com `fetch` injetado (testes em tests/henry-spotify.test.mjs). A parte de servidor (env, crm_settings,
// cifra do refresh token) fica em lib/henry-spotify.js.

// Gosto musical do dono (24/10): top-read, tocadas recentes e playlists privadas alimentam a sugestão do bom dia (readHenrySpotifyTaste).
export const SPOTIFY_SCOPES = Object.freeze(["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-top-read", "user-read-recently-played", "playlist-read-private"]);
export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API = "https://api.spotify.com";
export const SPOTIFY_SETTING_ID = "henry_spotify";
export const SPOTIFY_STATE_COOKIE = "mm_henry_spotify_state";
export const SPOTIFY_DEFAULT_REDIRECT_URI = "https://www.matheusmachadoimoveis.com.br/api/admin/henry/spotify/callback";
export const SPOTIFY_ACTIONS = Object.freeze(["tocar", "pausar", "continuar", "proxima", "anterior", "volume", "tocando"]);
export const SPOTIFY_TYPES = Object.freeze({ musica: "track", artista: "artist", playlist: "playlist", album: "album" });
const VOLUME_STEP = 15;
const REFRESH_MARGIN_MS = 60 * 1000;

export function buildSpotifyAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, scope: SPOTIFY_SCOPES.join(" "), redirect_uri: redirectUri, state });
  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

// Comparação do `state` do callback com o do cookie (anti-CSRF): os dois precisam existir e ser iguais.
export function isValidSpotifyState(fromQuery, fromCookie) {
  const a = String(fromQuery || "");
  const b = String(fromCookie || "");
  if (a.length < 16 || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

// Fallback sem as variáveis: busca no Spotify Web (o dono toca de lá). Só este endereço sai para o navegador.
export function spotifySearchUrl(term) {
  const text = String(term || "").trim().slice(0, 100);
  return text ? `https://open.spotify.com/search/${encodeURIComponent(text)}` : "https://open.spotify.com/";
}

export function isSpotifyOpenUrl(url) {
  return typeof url === "string" && /^https:\/\/open\.spotify\.com\/(search\/[^\s?#]+)?$/.test(url);
}

// URI do item achado na busca (`open_spotify`): só estes formatos saem para o navegador e voltam para o play.
export function isSpotifyUri(uri) {
  return typeof uri === "string" && /^spotify:(track|playlist|album|artist):[A-Za-z0-9]{10,40}$/.test(uri);
}

// Corpo do play pela URI: música = `uris`; playlist/álbum/artista = `context_uri`.
export function spotifyPlayBody(uri) {
  return uri.startsWith("spotify:track:") ? { uris: [uri] } : { context_uri: uri };
}

// Entrada da ferramenta → comando validado. { action, query, type, volume, step } ou { error }.
// "tocar" sem busca = continuar; volume aceita número (0–100) ou ajuste mais_alto/mais_baixo.
export function normalizeSpotifyCommand(input = {}) {
  const action = SPOTIFY_ACTIONS.includes(input?.acao) ? input.acao : "";
  if (!action) return { error: "acao_invalida" };
  const query = String(input?.busca || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (action === "tocar") {
    if (!query) return { action: "continuar" };
    // Tipo diferente de música = ele disse o tipo ("a playlist…", "o artista…"); música (padrão) busca faixa, artista,
    // playlist e álbum e escolhe pela correspondência (runSpotifyCommand).
    return { action, query, type: SPOTIFY_TYPES[input?.tipo] || "track" };
  }
  if (action === "volume") {
    const raw = Number(input?.volume);
    if (input?.volume !== undefined && input?.volume !== null && input?.volume !== "" && Number.isFinite(raw)) {
      return { action, volume: Math.max(0, Math.min(100, Math.round(raw))) };
    }
    if (input?.ajuste === "mais_alto") return { action, step: VOLUME_STEP };
    if (input?.ajuste === "mais_baixo") return { action, step: -VOLUME_STEP };
    return { error: "volume_invalido" };
  }
  return { action };
}

export function spotifyTokenNeedsRefresh(cached, now = Date.now()) {
  return !cached?.accessToken || !(Number(cached.expiresAt) > now + REFRESH_MARGIN_MS);
}

const basicAuth = (clientId, clientSecret) => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

async function tokenRequest(fetchImpl, { clientId, clientSecret }, fields) {
  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    // invalid_grant = o dono revogou o acesso no Spotify: precisa conectar de novo.
    throw Object.assign(new Error(data?.error === "invalid_grant" ? "spotify_revoked" : "spotify_token_failed"), { status: response.status, code: data?.error || "" });
  }
  return data;
}

// Código do callback → { accessToken, expiresAt, refreshToken, scope } (scope = escopos que o dono liberou, "a b c").
export async function exchangeSpotifyCode({ fetchImpl = fetch, clientId, clientSecret, code, redirectUri, now = Date.now() }) {
  const data = await tokenRequest(fetchImpl, { clientId, clientSecret }, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return { accessToken: data.access_token, expiresAt: now + (Number(data.expires_in) || 3600) * 1000, refreshToken: data.refresh_token || "", scope: String(data.scope || "") };
}

// Token de acesso com renovação automática: usa o guardado enquanto vale (margem de 1 min); senão renova pelo refresh
// token. Se o Spotify devolver um refresh token NOVO, `saveRefreshToken` grava. force = renovar mesmo válido (401 da API).
export function createSpotifyTokenManager({ fetchImpl = fetch, clientId, clientSecret, readRefreshToken, saveRefreshToken = async () => {}, now = () => Date.now() }) {
  let cached = null;
  let pending = null;
  return {
    async getAccessToken({ force = false } = {}) {
      if (!force && !spotifyTokenNeedsRefresh(cached, now())) return cached.accessToken;
      if (pending) return pending;
      pending = (async () => {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) throw Object.assign(new Error("spotify_not_connected"), { status: 401 });
        const data = await tokenRequest(fetchImpl, { clientId, clientSecret }, { grant_type: "refresh_token", refresh_token: refreshToken });
        cached = { accessToken: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
        if (data.refresh_token && data.refresh_token !== refreshToken) await saveRefreshToken(data.refresh_token);
        return cached.accessToken;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
    clear() {
      cached = null;
    }
  };
}

// Chamada à Web API com o token; 401 → renova uma vez e repete.
async function spotifyCall(fetchImpl, tokens, method, path, { query = null, body = undefined } = {}) {
  const url = `${SPOTIFY_API}${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`;
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await tokens.getAccessToken({ force: attempt > 0 });
    response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000)
    });
    if (response.status !== 401) break;
  }
  const text = await response.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}

const playerError = (result) => {
  const reason = result?.data?.error?.reason || "";
  if (reason === "PREMIUM_REQUIRED") return "premium";
  if (result.status === 404 || reason === "NO_ACTIVE_DEVICE") return "no_device";
  if (result.status === 429) return "rate_limited";
  return "failed";
};

// Comando de player: tenta no aparelho ativo; sem aparelho ativo (404) usa o PRIMEIRO de /v1/me/player/devices.
async function onDevice(fetchImpl, tokens, run) {
  const first = await run(null);
  if (first.ok) return { ok: true };
  if (playerError(first) !== "no_device") return { ok: false, reason: playerError(first) };
  const devices = await spotifyCall(fetchImpl, tokens, "GET", "/v1/me/player/devices");
  const device = (devices.data?.devices || []).find((item) => item?.id && !item.is_restricted);
  if (!device) return { ok: false, reason: "no_device" };
  const second = await run(device.id);
  return second.ok ? { ok: true, device: device.name || "", deviceId: device.id } : { ok: false, reason: playerError(second) };
}

const withDevice = (query, deviceId) => (deviceId ? { ...(query || {}), device_id: deviceId } : query);
const artistsOf = (item) => (item?.artists || []).map((artist) => artist?.name).filter(Boolean).slice(0, 2).join(" e ");
// Capa do item (a busca e o "tocando" trazem `images`; música = a do álbum): a de ~300 px, senão a primeira.
export function spotifyImageOf(item) {
  const images = (item?.images?.length ? item.images : item?.album?.images) || [];
  const pick = images.find((image) => Number(image?.width) >= 200 && Number(image?.width) <= 400) || images[0];
  const url = typeof pick?.url === "string" ? pick.url : "";
  return /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\//i.test(url) ? url : "";
}

// --- Busca que respeita o pedido (dono, 2026-10-23) ----------------------------------------------------------------------
export const SPOTIFY_SEARCH_TYPES = "track,artist,playlist,album";
export const SPOTIFY_SEARCH_LIMIT = 10;
export const SPOTIFY_GOOD_MATCH = 60;
const SEARCH_STOP = new Set(["o", "a", "os", "as", "de", "da", "do", "das", "dos", "e", "um", "uma", "musica", "faixa", "som", "cancao", "the"]);
export function spotifyMatchText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\bpt\.?\s*(\d)/g, "parte $1").replace(/[^a-z0-9]+/g, " ").trim();
}
const wordsOf = (value) => spotifyMatchText(value).split(" ").filter((word) => word && !SEARCH_STOP.has(word));
// Palavra igual, ou variação ("clássico"/"classics", "vigia"/"vigias"): prefixo comum de 5+ letras e ≥ 80% da menor.
function sameWord(a, b) {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  let common = 0;
  while (common < shorter && a[common] === b[common]) common += 1;
  return common >= 5 && common >= shorter * 0.8;
}
const hasAll = (haystack, words) => {
  const list = spotifyMatchText(haystack).split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => list.some((other) => sameWord(word, other)));
};

// Nota de cada resultado: nome da faixa igual (100) ou com todas as palavras do pedido (90); faixa + artista com todas
// (80; só o artista bateu = 40); artista igual (85) ou com todas (70); álbum (65); playlist (60). Tipo pedido ganha +15; "toca X" sem tipo =
// faixa. good = nota ≥ SPOTIFY_GOOD_MATCH. Sem nenhum bom: o melhor candidato (1ª faixa) para perguntar "É essa?".
// exclude = palavras proibidas no resultado (nome, artistas, álbum, descrição, dono da playlist) — ex.: a escolha automática
// do bom dia nunca toca a trilha de Suits nem música latina/mexicana/regional (MORNING_MUSIC_EXCLUDED_WORDS; dono, 2026-10-25/26).
export function pickSpotifySearchResult(data = {}, query = "", { preferType = "track", exclude = [] } = {}) {
  const wanted = wordsOf(query);
  const exact = wanted.join(" ");
  const banned = (exclude || []).map((word) => spotifyMatchText(word)).filter(Boolean);
  const allowed = (item) => !banned.length || !banned.some((word) => ` ${spotifyMatchText(`${item.name || ""} ${artistsOf(item)} ${item.album?.name || ""} ${item.description || ""} ${item.owner?.display_name || ""}`)} `.includes(word));
  const candidates = [];
  const add = (type, items, score) => (items || []).filter((item) => item?.uri && isSpotifyUri(item.uri) && allowed(item)).forEach((item, index) => candidates.push({ type, item, index, score: score(item) + (type === preferType ? 15 : 0) }));
  add("track", data?.tracks?.items, (item) => {
    const name = wordsOf(item.name).join(" ");
    if (exact && name === exact) return 100;
    if (hasAll(item.name, wanted)) return 90;
    // Faixa + artista ("vida loka racionais"): pelo menos uma palavra no nome da faixa. Só o artista bateu = nota baixa
    // ("toca Racionais" é o artista, não uma faixa qualquer dele).
    if (hasAll(`${item.name} ${artistsOf(item)} ${item.album?.name || ""}`, wanted)) return wanted.some((word) => hasAll(item.name, [word])) ? 80 : 40;
    return 0;
  });
  add("artist", data?.artists?.items, (item) => (exact && wordsOf(item.name).join(" ") === exact ? 85 : hasAll(item.name, wanted) ? 70 : 0));
  add("album", data?.albums?.items, (item) => (hasAll(`${item.name} ${artistsOf(item)}`, wanted) ? 65 : 0));
  add("playlist", data?.playlists?.items, (item) => (hasAll(item.name, wanted) ? 60 : 0));
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (best.score >= SPOTIFY_GOOD_MATCH) return { type: best.type, item: best.item, score: best.score, good: true };
  const fallback = candidates.find((candidate) => candidate.type === preferType) || candidates[0];
  return { type: fallback.type, item: fallback.item, score: fallback.score, good: false };
}

// Depois do play: o que está tocando é o pedido? "ok" | "other" | "unknown" (sem leitura = não acusa erro).
export const SPOTIFY_VERIFY_DELAY_MS = 700;
async function confirmPlaying(call, uri, sleep) {
  await sleep(SPOTIFY_VERIFY_DELAY_MS);
  const now = await call("GET", "/v1/me/player/currently-playing").catch(() => null);
  const item = now?.ok ? now.data?.item : null;
  if (!item) return "unknown";
  if (item.uri === uri || now.data?.context?.uri === uri) return "ok";
  return uri.startsWith("spotify:track:") || now.data?.context?.uri ? "other" : "unknown";
}

// Executa o comando normalizado. Devolve { ok, reason?, playing? (nome/artista), volume? } — a frase fica com o modelo.
// baseVolume (volume "do dono" que a tela guardou ao abaixar a música para escutar/falar): base do "aumenta/abaixa" — sem
// ela o passo sairia do volume ABAIXADO e "aumentei" ficaria abaixo do que estava (bug real, dono 2026-10-24).
export async function runSpotifyCommand(command, { fetchImpl = fetch, tokens, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), baseVolume = null }) {
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  if (command.action === "tocando") {
    const result = await call("GET", "/v1/me/player/currently-playing");
    if (result.status === 204 || !result.data?.item) return { ok: true, playing: null };
    const item = result.data.item;
    return { ok: true, playing: { name: item.name || "", artists: artistsOf(item) || item.show?.name || "", isPlaying: result.data.is_playing === true, ...(spotifyImageOf(item) ? { image: spotifyImageOf(item) } : {}) } };
  }
  if (command.action === "tocar") {
    // URI já conhecida (link configurado no bom dia): sem busca.
    let item = isSpotifyUri(command.uri) ? { uri: command.uri, name: "" } : null;
    let type = command.type;
    if (!item) {
      // Busca larga (dono, 2026-10-23: pediu "O Quinto Vigia" e tocou outra coisa): faixa, artista, playlist e álbum,
      // 10 de cada, e escolhe pela correspondência com o pedido — nunca o 1º resultado às cegas (pickSpotifySearchResult).
      // broad (cantor falado no bom dia, dono 2026-10-24): busca nos 4 tipos, mas PREFERE o tipo pedido (artista).
      const explicit = Boolean(command.type && command.type !== "track") && !command.broad;
      const types = explicit ? command.type : SPOTIFY_SEARCH_TYPES;
      const search = await call("GET", "/v1/search", { query: { q: command.query, type: types, limit: String(SPOTIFY_SEARCH_LIMIT) } });
      if (!search.ok) return { ok: false, reason: playerError(search) };
      const picked = pickSpotifySearchResult(search.data, command.query, { preferType: (explicit || command.broad) && command.type ? command.type : "track", exclude: Array.isArray(command.exclude) ? command.exclude : [] });
      if (!picked) return { ok: false, reason: "not_found" };
      // strict (escolha automática do bom dia, dono 2026-10-26): só vale o ARTISTA com o nome exato pedido — nada parecido,
      // nada de faixa/playlist (a busca genérica de playlist trouxe música mexicana). Sem ele = not_found (o bom dia tenta
      // outro artista da lista), nunca "É essa?".
      if (command.strict && !(picked.type === "artist" && wordsOf(picked.item.name).join(" ") === wordsOf(command.query).join(" "))) return { ok: false, reason: "not_found" };
      // Nada bate bem com o pedido: não toca nada aleatório — pergunta "Achei X, de Y. É essa?".
      if (!picked.good && !command.acceptBest) return { ok: false, reason: "confirm", candidate: { name: picked.item.name || "", artists: artistsOf(picked.item) || (picked.type === "playlist" ? "playlist" : ""), type: picked.type, uri: picked.item.uri } };
      item = picked.item;
      type = picked.type;
    }
    const body = spotifyPlayBody(item.uri);
    const playOnce = () => onDevice(fetchImpl, tokens, (deviceId) => call("PUT", "/v1/me/player/play", { query: withDevice(null, deviceId), body }));
    let done = await playOnce();
    // Confere se o que está tocando é o pedido (o play pode "dar certo" e o aparelho seguir no contexto antigo). Não
    // bateu → tenta UMA vez de novo; de novo não → ok: false com o motivo (a fala diz em uma frase).
    if (done.ok) {
      let check = await confirmPlaying(call, item.uri, sleep);
      if (check === "other") {
        done = await playOnce();
        if (done.ok) check = await confirmPlaying(call, item.uri, sleep);
      }
      if (done.ok && check === "other") done = { ok: false, reason: "not_started" };
    }
    // O play NUNCA mexe no volume (dono, 2026-10-24: "toda vez que ele dá play, ele vai para o volume mínimo"): fica o
    // volume que o dono deixou no Spotify; abaixar enquanto o Henry fala é só do speechDuckAction (e volta depois).
    const playing = { name: item.name || "", artists: artistsOf(item) || (type === "playlist" ? "playlist" : ""), image: spotifyImageOf(item) };
    // Spotify fechado (nenhum aparelho): devolve a URI para o navegador abrir o app (`open_spotify`, dono 2026-10-23).
    if (!done.ok && done.reason === "no_device" && isSpotifyUri(item.uri)) return { ...done, uri: item.uri, playing };
    return { ...done, playing };
  }
  if (command.action === "volume") {
    let volume = command.volume;
    if (volume === undefined) {
      let base = Number.isInteger(baseVolume) && baseVolume >= 0 && baseVolume <= 100 ? baseVolume : null;
      if (base === null) {
        const state = await call("GET", "/v1/me/player");
        const current = Number(state.data?.device?.volume_percent);
        base = Number.isFinite(current) ? current : 50;
      }
      volume = Math.max(0, Math.min(100, base + command.step));
    }
    // Confere no player depois de mudar (dono, 2026-10-24: "ele fala que aumentou, mas não aumenta"): não bateu → uma
    // nova tentativa; de novo não → ok: false (a fala diz que não conseguiu). Sem leitura do volume → confirmed: false.
    const put = () => onDevice(fetchImpl, tokens, (deviceId) => call("PUT", "/v1/me/player/volume", { query: withDevice({ volume_percent: String(volume) }, deviceId) }));
    const readBack = async () => {
      await sleep(SPOTIFY_VOLUME_CHECK_MS);
      const state = await call("GET", "/v1/me/player").catch(() => null);
      const value = state?.ok ? state.data?.device?.volume_percent : null;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    let done = await put();
    if (!done.ok) return { ...done, volume };
    let actual = await readBack();
    if (actual !== null && !volumeStillHenrys(actual, volume)) {
      done = await put();
      if (!done.ok) return { ...done, volume };
      actual = await readBack();
    }
    const outcome = spotifyVolumeOutcome(volume, actual);
    return outcome.ok ? { ...done, volume, confirmed: outcome.confirmed } : { ok: false, reason: outcome.reason, volume, actual };
  }
  const simple = {
    pausar: ["PUT", "/v1/me/player/pause"],
    continuar: ["PUT", "/v1/me/player/play"],
    proxima: ["POST", "/v1/me/player/next"],
    anterior: ["POST", "/v1/me/player/previous"]
  }[command.action];
  if (!simple) return { ok: false, reason: "failed" };
  return onDevice(fetchImpl, tokens, (deviceId) => call(simple[0], simple[1], { query: withDevice(null, deviceId) }));
}

// "Tocando agora" da tela cheia do Henry (ondas sonoras, dono 2026-10-23): { isPlaying, name, artists, image, tempo }.
// tempo (BPM) só se o Spotify liberar /v1/audio-features (restrito para apps novos): falhou → null, sem erro; guardado
// por faixa em `tempoCache` (Map) para não pedir de novo a cada consulta.
export async function readSpotifyNowPlaying({ fetchImpl = fetch, tokens, tempoCache = null }) {
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  const result = await call("GET", "/v1/me/player/currently-playing");
  const item = result.ok ? result.data?.item : null;
  if (result.status === 204 || !item) return { isPlaying: false };
  let tempo = null;
  const id = item.type === "track" && /^[A-Za-z0-9]{10,40}$/.test(item.id || "") ? item.id : "";
  if (id && tempoCache?.has(id)) tempo = tempoCache.get(id);
  else if (id) {
    const features = await call("GET", `/v1/audio-features/${id}`).catch(() => null);
    const value = Number(features?.ok ? features.data?.tempo : NaN);
    tempo = Number.isFinite(value) && value >= 40 && value <= 220 ? Math.round(value) : null;
    if (tempoCache) {
      if (tempoCache.size > 50) tempoCache.clear();
      tempoCache.set(id, tempo);
    }
  }
  return { isPlaying: result.data.is_playing === true, name: String(item.name || "").slice(0, 80), artists: (artistsOf(item) || item.show?.name || "").slice(0, 60), image: spotifyImageOf(item), tempo };
}

// Volume pedido × volume lido no player depois de mudar: { ok, confirmed } ou { ok: false, reason: "volume_not_applied" }.
// Lido fora da tolerância de arredondamento do aparelho = não aplicou; sem leitura = aplicou sem confirmação.
export const SPOTIFY_VOLUME_CHECK_MS = 600;
// Fala fixa do volume aplicado (Treino 4, 2026-10-25: "Baixei o som. Se quiser, é só falar de novo que eu ajusto de novo."):
// só a frase curta; volume não conferido (confirmed false) ou falha = "" (o modelo diz o que houve).
export function spotifyVolumeLine(command = {}, result = {}) {
  if (command?.action !== "volume" || !result?.ok || result.confirmed === false) return "";
  if (Number.isInteger(command.volume)) return `Pronto, volume em ${command.volume} por cento.`;
  if (Number(command.step) < 0) return "Baixei o som.";
  if (Number(command.step) > 0) return "Aumentei o som.";
  return "";
}

// Fala fixa da próxima faixa (Treino 7, 2026-10-25: "troca essa música aí e coloca na Alexa"): só quando o Spotify
// confirmou (ou o modo treino); falha = "" (o modelo diz o que houve).
export function spotifyControlLine(command = {}, result = {}) {
  return command?.action === "proxima" && result?.ok ? "Troquei a música." : "";
}

export function spotifyVolumeOutcome(requested, actual) {
  if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) return { ok: true, confirmed: false };
  return volumeStillHenrys(actual, requested) ? { ok: true, confirmed: true } : { ok: false, reason: "volume_not_applied" };
}

// Música baixa enquanto o Henry escuta/fala (dono, 2026-10-23: "o Henry fica respondendo as músicas"): só se estiver
// TOCANDO e acima do nível; devolve o volume anterior para a tela restaurar depois. { ducked, previous?, level? }.
// ratio (fala do Henry, dono 2026-10-24): o nível passa a ser essa fração do volume atual (speechDuckLevel), um passo só.
export const SPOTIFY_DUCK_VOLUME = 15;
// userVolume/lastLevel (memória da tela): se o Spotify ainda está no nível que o Henry pôs, o "volume de antes" é o do
// dono, nunca o abaixado — abaixar de novo não encadeia (25% de 25%, bug real 2026-10-24; resolveDuckPrevious).
export async function duckSpotifyVolume({ fetchImpl = fetch, tokens, level = SPOTIFY_DUCK_VOLUME, ratio = null, userVolume = null, lastLevel = null }) {
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  const state = await call("GET", "/v1/me/player");
  const read = state.data?.device?.volume_percent;
  const previous = typeof read === "number" ? resolveDuckPrevious({ current: read, userVolume, lastLevel }) : NaN;
  const target = Number.isFinite(previous) && Number(ratio) > 0 ? speechDuckLevel(previous, Number(ratio)) : level;
  if (!state.ok || state.data?.is_playing !== true || !Number.isFinite(previous) || previous <= target) return { ducked: false };
  const done = await call("PUT", "/v1/me/player/volume", { query: { volume_percent: String(target) } });
  return done.ok ? { ducked: true, previous: Math.round(previous), level: target } : { ducked: false };
}

// expect = volume que o Henry pôs por último: se o Spotify não estiver mais nele (o dono mexeu no volume), não mexe
// ({ ok: false, skipped: "manual" }) — nunca sobrescreve o ajuste manual (dono, 2026-10-24).
// expectFrom = nível mais baixo que o Henry pôs nesta subida: o Spotify demora a refletir o volume novo, então qualquer
// valor entre expectFrom e expect (± tolerância) ainda é do Henry (antes a subida parava no meio e a música ficava baixa).
// Falha ao ler o player = { ok: false, reason: "failed" } (a tela tenta de novo), nunca "manual".
export async function setSpotifyVolume(volume, { fetchImpl = fetch, tokens, expect = null, expectFrom = null }) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) return { ok: false };
  if (Number.isInteger(expect)) {
    const state = await spotifyCall(fetchImpl, tokens, "GET", "/v1/me/player");
    if (!state.ok) return { ok: false, reason: "failed" };
    const current = state.data?.device?.volume_percent;
    if (typeof current === "number" && !volumeStillHenrys(current, expect, HENRY_SPOTIFY_MANUAL_TOLERANCE, expectFrom)) return { ok: false, skipped: "manual" };
  }
  const done = await spotifyCall(fetchImpl, tokens, "PUT", "/v1/me/player/volume", { query: { volume_percent: String(volume) } });
  return { ok: done.ok };
}

// --- Música abaixa quando o Henry fala (REGRA OFICIAL — dono, 2026-10-24) ----------------------------------------------
// "Toda vez que o Henry falar, a música do Spotify cai para uns 25% — ele diminui de uma vez e depois aumenta
// gradativamente." Começo de qualquer fala com música tocando: volume vai DIRETO para 25% do atual (um passo). Terminou e
// nada mais na fila por ~1 s: sobe em HENRY_SPOTIFY_RAMP_STEPS passos em ~2,5 s até o volume de antes; se o dono mexeu no
// volume no meio, para e não restaura. Já baixa pela escuta (SPOTIFY_DUCK_VOLUME) = continua baixa (um abaixar só).
export const HENRY_SPEECH_DUCK_RATIO = 0.25;
export const HENRY_SPOTIFY_RAMP_DELAY_MS = 1000;
export const HENRY_SPOTIFY_RAMP_STEPS = 5;
export const HENRY_SPOTIFY_RAMP_MS = 2500;
// Aparelhos arredondam o volume (iPhone em degraus de ~6%): diferença maior que isto = o dono mexeu.
export const HENRY_SPOTIFY_MANUAL_TOLERANCE = 7;

export function speechDuckLevel(previous, ratio = HENRY_SPEECH_DUCK_RATIO) {
  const value = Math.round(Number(previous) * Number(ratio));
  return Math.max(1, Math.min(100, Number.isFinite(value) ? value : 1));
}

// from (opcional) = outro volume que o Henry pôs há pouco (começo da subida): vale tudo entre os dois, ± tolerância.
export function volumeStillHenrys(current, expected, tolerance = HENRY_SPOTIFY_MANUAL_TOLERANCE, from = null) {
  if (current === null || current === undefined || current === "") return false;
  const now = Number(current);
  const set = Number(expected);
  if (!Number.isFinite(now) || !Number.isFinite(set)) return false;
  const other = from !== null && from !== undefined && Number.isFinite(Number(from)) ? Number(from) : set;
  return now >= Math.min(set, other) - tolerance && now <= Math.max(set, other) + tolerance;
}

// "Volume de antes" ao abaixar: o atual, salvo quando o Spotify ainda está no nível que o Henry pôs (lastLevel) e a tela
// lembra o volume do dono (userVolume, maior) — aí é o do dono. Nunca encadeia abaixar sobre abaixar.
export function resolveDuckPrevious({ current, userVolume = null, lastLevel = null, tolerance = HENRY_SPOTIFY_MANUAL_TOLERANCE } = {}) {
  const now = Number(current);
  if (current === null || current === undefined || !Number.isFinite(now)) return null;
  if (Number.isInteger(userVolume) && userVolume <= 100 && Number.isInteger(lastLevel) && userVolume > now && volumeStillHenrys(now, lastLevel, tolerance)) return userVolume;
  return Math.round(now);
}

// Memória do volume do dono na tela (sobrevive ao fim de um abaixar/subir): { volume, lastLevel, at }. Vale
// HENRY_SPOTIFY_USER_MEMORY_MS; pedido explícito de volume do dono troca por { volume: novo, lastLevel: null }.
export const HENRY_SPOTIFY_USER_MEMORY_MS = 15 * 60 * 1000;
export function spotifyUserMemoryFor(memory, now = Date.now()) {
  if (!memory || !Number.isInteger(memory.volume) || !(Number(memory.at) > 0) || now - Number(memory.at) > HENRY_SPOTIFY_USER_MEMORY_MS) return null;
  return { volume: memory.volume, lastLevel: Number.isInteger(memory.lastLevel) ? memory.lastLevel : null };
}

// Resultado de um passo da subida: "next" (aplicou), "manual" (o dono mexeu: para e esquece), "retry" (falha: tenta de
// novo uma vez) ou "keep" (falhou de novo: para, mas a tela LEMBRA o volume do dono para não encadear nem perder).
export function spotifyRestoreStep(result, { retried = false } = {}) {
  if (result?.ok) return "next";
  if (result?.skipped === "manual") return "manual";
  return retried ? "keep" : "retry";
}

// Começo de uma fala: "duck" (abaixar agora para 25% do atual), "back" (estava subindo → volta ao nível baixo) ou "keep"
// (já está baixa pelo Henry) ou "none" (sem música).
export function speechDuckAction({ musicPlaying = false, ducked = false, pending = false, ramping = false } = {}) {
  if (!musicPlaying && !ducked && !pending) return "none";
  if (ramping) return "back";
  if (ducked || pending) return "keep";
  return "duck";
}

// Plano da subida: passos crescentes { volume, atMs } (o 1º logo, o último em totalMs, no volume de antes); sem passos
// repetidos. Subir para baixo/igual não tem plano.
export function spotifyRampPlan({ from, to, steps = HENRY_SPOTIFY_RAMP_STEPS, totalMs = HENRY_SPOTIFY_RAMP_MS } = {}) {
  const start = Math.round(Number(from));
  const end = Math.round(Number(to));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > 100 || start < 0) return [];
  const count = Math.max(1, Math.min(Math.round(Number(steps)) || 1, end - start));
  const plan = [];
  for (let index = 1; index <= count; index += 1) {
    const volume = Math.round(start + ((end - start) * index) / count);
    const atMs = count === 1 ? 0 : Math.round((Math.max(0, Number(totalMs) || 0) * (index - 1)) / (count - 1));
    if (!plan.length || plan[plan.length - 1].volume !== volume) plan.push({ volume, atMs });
  }
  return plan;
}

// Depois de o navegador abrir o Spotify pela URI: consulta /v1/me/player/devices a cada `intervalMs` por até `timeoutMs`;
// quando um aparelho aparece, transfere para ele (sem tocar) e dá play com a URI nesse device_id. Aparelho que acabou de
// abrir pode recusar o primeiro play (404): tenta de novo na próxima volta. { ok, device? } ou { ok: false, reason }.
export async function playOnSpotifyWhenReady(uri, { fetchImpl = fetch, tokens, timeoutMs = 10000, intervalMs = 1200, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() }) {
  if (!isSpotifyUri(uri)) return { ok: false, reason: "failed" };
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  const deadline = now() + timeoutMs;
  for (;;) {
    const devices = await call("GET", "/v1/me/player/devices");
    if (!devices.ok && playerError(devices) !== "no_device") return { ok: false, reason: playerError(devices) };
    const device = (devices.data?.devices || []).find((item) => item?.id && !item.is_restricted);
    if (device) {
      await call("PUT", "/v1/me/player", { body: { device_ids: [device.id], play: false } });
      const played = await call("PUT", "/v1/me/player/play", { query: { device_id: device.id }, body: spotifyPlayBody(uri) });
      if (played.ok) {
        // Sem volume no play (dono, 2026-10-24): fica o volume do aparelho.
        return { ok: true, device: device.name || "" };
      }
      if (playerError(played) !== "no_device") return { ok: false, reason: playerError(played) };
    }
    if (now() + intervalMs > deadline) return { ok: false, reason: "no_device" };
    await sleep(intervalMs);
  }
}

// Frase depois do polling (o navegador fala): tocou → nada; sem aparelho → pedir um play no Spotify.
export function describeSpotifyOpenResult(result) {
  if (result?.ok) return "";
  if (result?.reason === "premium") return "O Spotify pediu conta Premium para tocar.";
  if (result?.reason === "no_device") return "Abri o Spotify. Dá play uma vez nele que eu assumo daqui.";
  return "O Spotify não respondeu agora. Dá play uma vez nele.";
}

// Resultado → texto para o modelo (ferramenta). Sem aparelho: frase curta pedindo para abrir o Spotify.
export function describeSpotifyResult(command, result) {
  if (!result?.ok) {
    const reason = result?.reason;
    if (reason === "no_device" && command.action === "tocar" && isSpotifyUri(result?.uri)) return "O Spotify está fechado: a tela vai abrir o app agora e tocar em seguida. Diga só: Abrindo o Spotify…";
    if (reason === "no_device") return "Nenhum aparelho com Spotify aberto. Diga, curto, para ele abrir o Spotify no celular ou no computador.";
    if (reason === "not_found") return `Não achei "${command.query}" no Spotify. Diga isso em poucas palavras.`;
    if (reason === "confirm" && result?.candidate?.name) {
      const who = result.candidate.artists && result.candidate.artists !== "playlist" ? `, de ${result.candidate.artists}` : "";
      return `Nada tocou: não achei exatamente "${command.query}". O mais parecido é "${result.candidate.name}"${who}. Pergunte exatamente assim, sem tocar nada: Achei '${result.candidate.name}'${who}. É essa? (Se ele disser sim, chame spotify tocar com busca "${result.candidate.name}${result.candidate.artists && result.candidate.artists !== "playlist" ? ` ${result.candidate.artists}` : ""}".)`;
    }
    if (reason === "not_started") return "O Spotify aceitou o pedido, mas a música não começou no aparelho. Diga isso em uma frase curta e peça para ele dar play uma vez no Spotify.";
    if (reason === "volume_not_applied") return `O volume NÃO mudou: pedi ${result.volume}% e o Spotify continua em ${Math.round(Number(result.actual))}%. Diga isso em uma frase curta; nunca diga que aumentou ou abaixou.`;
    if (reason === "premium") return "O Spotify recusou: o controle exige conta Premium.";
    if (reason === "not_connected") return "Spotify não conectado. Ofereça conectar na tela Alexa e Henry (abrir_tela destino alexa), em uma frase.";
    return "O Spotify não respondeu agora. Diga isso em poucas palavras.";
  }
  if (command.action === "tocando") {
    if (!result.playing) return "Nada tocando agora no Spotify.";
    return JSON.stringify({ tocando: result.playing.name, de: result.playing.artists, pausado: !result.playing.isPlaying });
  }
  if (command.action === "tocar") return JSON.stringify({ tocando_agora: result.playing?.name || command.query, de: result.playing?.artists || "", instrucao: "Confirme em poucas palavras dizendo a faixa e o artista; se ele pediu mais alguma coisa, responda o resto também." });
  if (command.action === "volume") {
    if (result.confirmed === false) return JSON.stringify({ volume_pedido: result.volume, conferido: false, instrucao: `Diga, curto, que pediu ${result.volume}% ao Spotify (não diga que já está nesse volume).` });
    return JSON.stringify({ volume: result.volume, conferido: true, instrucao: `Confirme em poucas palavras dizendo ${result.volume}%.` });
  }
  return "Feito. Confirme em 1–3 palavras.";
}

// --- Trocar o aparelho (dono, 2026-10-23: "Henry consegue alterar do computador para o Spotify tocar na Alexa?") -------
// Ferramenta `mudar_aparelho_spotify`: lista /v1/me/player/devices, casa o pedido pelo TIPO (Speaker/Smartphone/Computer)
// e pelo NOME ("Echo Dot de Matheus", "caixa da sala") e transfere com PUT /v1/me/player { device_ids: [id], play: true }.
// Echo/Alexa só aparece no Spotify Connect com a conta vinculada no app da Alexa e o aparelho ativo — ausente = pedir um
// "Alexa, toca Spotify" (nunca Voice Monkey para isso). Mais de um parecido = pergunta qual (pergunta aberta da tela).
export const SPOTIFY_DEVICE_KINDS = Object.freeze(["alexa", "computador", "celular", "caixa"]);
const DEVICE_KIND_WORDS = [
  ["alexa", /\b(alexa|echo|eco)\b/],
  ["computador", /\b(computador|pc|notebook|note|desktop|laptop|mac|macbook)\b/],
  ["celular", /\b(celular|telefone|iphone|smartphone|android)\b/],
  ["caixa", /\b(caixa|caixinha|speaker|som)\b/]
];
const DEVICE_FILLER = new Set(["a", "o", "as", "os", "da", "do", "das", "dos", "de", "na", "no", "nas", "nos", "pra", "pro", "para", "em", "meu", "minha", "aparelho", "dispositivo", "spotify", "musica", "som", "caixa", "caixinha", "e", "alexa", "echo", "eco", "dot", "computador", "pc", "notebook", "note", "desktop", "laptop", "celular", "telefone", "smartphone", "speaker"]);
const deviceText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Tipo pedido na fala ("Alexa", "volta pro computador", "caixa da sala") → alexa | computador | celular | caixa | "".
export function spotifyDeviceKindFromText(text) {
  const value = deviceText(text);
  return DEVICE_KIND_WORDS.find(([, pattern]) => pattern.test(value))?.[0] || "";
}

// Tipo de um aparelho do Spotify: Echo/Alexa costuma vir como Speaker com nome "Echo Dot de Matheus".
export function spotifyDeviceKindOf(device = {}) {
  const type = String(device?.type || "").toLowerCase();
  const name = deviceText(device?.name);
  if (/\b(alexa|echo)\b/.test(name)) return "alexa";
  if (type === "computer") return "computador";
  if (type === "smartphone" || type === "tablet") return "celular";
  if (type === "speaker" || type === "castaudio" || type === "avr") return "caixa";
  return "";
}

// Entrada da ferramenta → { target (como falado), kind, words (palavras do nome) } ou { error }.
export function normalizeSpotifyDeviceRequest(input = {}) {
  const target = String(input?.aparelho || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!target) return { error: "aparelho_invalido" };
  const words = deviceText(target).split(" ").filter((word) => word.length > 1 && !DEVICE_FILLER.has(word));
  return { target, kind: spotifyDeviceKindFromText(target), words };
}

// Pedido × lista do Spotify → { kind: "transfer"|"already", device } | { kind: "ask", options: [nomes] } | { kind: "missing" }.
// Tipo pedido filtra (Alexa = só Echo/Alexa; caixa = qualquer Speaker, inclusive Echo); as palavras do nome escolhem entre
// eles e, quando nada casa, o aparelho não está na lista (nunca chuta outro).
export function matchSpotifyDevice(devices = [], request = {}) {
  const usable = (Array.isArray(devices) ? devices : []).filter((device) => device?.id && !device.is_restricted);
  const kind = request?.kind || "";
  const byKind = usable.filter((device) => {
    const own = spotifyDeviceKindOf(device);
    if (!kind) return true;
    if (kind === "caixa") return own === "caixa" || own === "alexa";
    return own === kind;
  });
  let list = byKind;
  const words = Array.isArray(request?.words) ? request.words : [];
  if (words.length) {
    const scored = byKind.map((device) => ({ device, score: words.filter((word) => deviceText(device.name).split(" ").includes(word)).length }));
    const best = Math.max(0, ...scored.map((item) => item.score));
    list = best > 0 ? scored.filter((item) => item.score === best).map((item) => item.device) : [];
    // Só o tipo já basta quando o nome falado não casa e há UM do tipo pedido ("toca na Alexa do Matheus" → o único Echo).
    if (!list.length && kind && kind !== "caixa" && byKind.length === 1) list = byKind;
  }
  if (!list.length) return { kind: "missing" };
  if (list.length > 1) return { kind: "ask", options: list.map((device) => String(device.name || "").slice(0, 40)).slice(0, 4) };
  const device = list[0];
  return { kind: device.is_active ? "already" : "transfer", device };
}

const deviceSummary = (device) => ({ name: String(device?.name || "").slice(0, 40), kind: spotifyDeviceKindOf(device) });

// Executa a troca. restoreVolume = volume que a tela tinha guardado ao abaixar a música para ele falar: volta no aparelho
// de ORIGEM antes de trocar (senão o computador fica baixinho e o volume dele iria para a Alexa).
// { ok, device?: { name, kind }, already?, reason?: no_device|ask|premium|rate_limited|failed, options?, requested? }.
export async function transferSpotifyPlayback(request, { fetchImpl = fetch, tokens, restoreVolume = null }) {
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  const requested = request?.kind || "";
  const devices = await call("GET", "/v1/me/player/devices");
  if (!devices.ok) return { ok: false, reason: playerError(devices), requested };
  const list = devices.data?.devices || [];
  const match = matchSpotifyDevice(list, request);
  if (match.kind === "missing") return { ok: false, reason: "no_device", requested };
  if (match.kind === "ask") return { ok: false, reason: "ask", options: match.options, requested };
  if (match.kind === "already") return { ok: true, already: true, device: deviceSummary(match.device), requested };
  const source = list.find((device) => device?.is_active && device.id !== match.device.id);
  if (source && Number.isInteger(restoreVolume) && restoreVolume >= 0 && restoreVolume <= 100) {
    await call("PUT", "/v1/me/player/volume", { query: { volume_percent: String(restoreVolume), device_id: source.id } }).catch(() => null);
  }
  const done = await call("PUT", "/v1/me/player", { body: { device_ids: [match.device.id], play: true } });
  if (!done.ok) return { ok: false, reason: playerError(done) === "no_device" ? "failed" : playerError(done), requested };
  return { ok: true, device: deviceSummary(match.device), requested, ...(source ? { from: deviceSummary(source) } : {}) };
}

const KIND_LABEL = { alexa: "a Alexa", computador: "o computador", celular: "o celular", caixa: "a caixa" };
const KIND_TO = { alexa: "pra Alexa", computador: "pro computador", celular: "pro celular" };

// Fala fixa e curta (jeito de amigo) — a tela fala esta, não a do modelo.
export function spotifyDeviceLine(result = {}) {
  const kind = result?.device?.kind || result?.requested || "";
  const name = String(result?.device?.name || "").trim();
  if (result?.ok) {
    if (result.already) return kind === "alexa" ? "Já tá tocando na Alexa." : kind === "computador" ? "Já tá tocando no computador." : kind === "celular" ? "Já tá tocando no celular." : `Já tá tocando em ${name || "aí"}.`;
    if (kind === "computador") return "Voltou pro computador.";
    return KIND_TO[kind] ? `Pronto, passei ${KIND_TO[kind]}.` : `Pronto, passei pra ${name || "lá"}.`;
  }
  if (result?.reason === "ask") {
    const options = (result.options || []).filter(Boolean);
    return options.length > 1 ? `Achei ${options.length === 2 ? "dois" : "alguns"}: ${options.slice(0, -1).join(", ")} ou ${options[options.length - 1]}. Qual?` : "Qual aparelho?";
  }
  if (result?.reason === "no_device") {
    const want = result?.requested || "";
    if (want === "alexa") return "Não achei a Alexa no Spotify agora. Fala 'Alexa, toca Spotify' uma vez que ela aparece pra mim.";
    if (want === "computador" || want === "celular") return `Não achei ${KIND_LABEL[want]} no Spotify agora. Abre o Spotify nele que eu passo.`;
    return "Não achei esse aparelho no Spotify agora.";
  }
  if (result?.reason === "premium") return "O Spotify pediu conta Premium pra trocar de aparelho.";
  if (result?.reason === "not_connected") return "O Spotify não tá conectado. Dá pra conectar na tela Alexa e Henry.";
  return "O Spotify não deixou trocar agora.";
}

// Modo treino (Treino 7, 2026-10-25): a troca de aparelho é SIMULADA com sucesso coerente — a mesma fala fixa do sucesso
// real ("Pronto, passei pra Alexa."), nunca "não foi trocado de verdade" (o modelo lia como falha: "Não consegui trocar:
// o Spotify não respondeu de verdade…"). Nada é chamado no Spotify.
export function simulatedSpotifyDeviceTool(input = {}) {
  const request = normalizeSpotifyDeviceRequest(input);
  if (request.error) return { text: "Pergunte, curto, para qual aparelho ele quer passar a música.", line: "", result: null };
  const kind = request.kind || "";
  const result = { ok: true, simulated: true, requested: kind, device: { name: KIND_LABEL[kind] ? "" : request.target, kind } };
  const line = spotifyDeviceLine(result);
  return { text: `Feito. Diga exatamente: ${line}`, line, result };
}

// Gosto do dono para a sugestão do bom dia (henry-morning-music-core.mjs): só os endpoints dos escopos liberados
// (granted = grantedTasteScopes). Cada leitura que falhar vira null (a sugestão segue com o que vier ou com o banco fixo).
export async function readSpotifyTaste(granted = [], { fetchImpl = fetch, tokens }) {
  const read = (path, query) => spotifyCall(fetchImpl, tokens, "GET", path, { query }).then((result) => (result.ok ? result.data : null)).catch(() => null);
  const has = (scope) => granted.includes(scope);
  const [topArtists, topTracks, recent, playlists] = await Promise.all([
    has("user-top-read") ? read("/v1/me/top/artists", { time_range: "short_term", limit: "10" }) : null,
    has("user-top-read") ? read("/v1/me/top/tracks", { time_range: "short_term", limit: "10" }) : null,
    has("user-read-recently-played") ? read("/v1/me/player/recently-played", { limit: "20" }) : null,
    has("playlist-read-private") ? read("/v1/me/playlists", { limit: "20" }) : null
  ]);
  return { topArtists, topTracks, recent, playlists };
}
