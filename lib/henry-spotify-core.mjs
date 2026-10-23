// Spotify no Henry (dono, 2026-10-22: "Spotify, só para mim"; docs/BUSINESS_RULES.md HENRY-1). Regras PURAS (sem banco,
// sem env): endereço de autorização, comando vindo da ferramenta `spotify`, renovação do token de acesso e execução dos
// comandos na Web API com `fetch` injetado (testes em tests/henry-spotify.test.mjs). A parte de servidor (env, crm_settings,
// cifra do refresh token) fica em lib/henry-spotify.js.

export const SPOTIFY_SCOPES = Object.freeze(["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"]);
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

// Código do callback → { accessToken, expiresAt, refreshToken }.
export async function exchangeSpotifyCode({ fetchImpl = fetch, clientId, clientSecret, code, redirectUri, now = Date.now() }) {
  const data = await tokenRequest(fetchImpl, { clientId, clientSecret }, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return { accessToken: data.access_token, expiresAt: now + (Number(data.expires_in) || 3600) * 1000, refreshToken: data.refresh_token || "" };
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
  return second.ok ? { ok: true, device: device.name || "" } : { ok: false, reason: playerError(second) };
}

const withDevice = (query, deviceId) => (deviceId ? { ...(query || {}), device_id: deviceId } : query);
const artistsOf = (item) => (item?.artists || []).map((artist) => artist?.name).filter(Boolean).slice(0, 2).join(" e ");

// Executa o comando normalizado. Devolve { ok, reason?, playing? (nome/artista), volume? } — a frase fica com o modelo.
export async function runSpotifyCommand(command, { fetchImpl = fetch, tokens }) {
  const call = (method, path, options) => spotifyCall(fetchImpl, tokens, method, path, options);
  if (command.action === "tocando") {
    const result = await call("GET", "/v1/me/player/currently-playing");
    if (result.status === 204 || !result.data?.item) return { ok: true, playing: null };
    const item = result.data.item;
    return { ok: true, playing: { name: item.name || "", artists: artistsOf(item) || item.show?.name || "", isPlaying: result.data.is_playing === true } };
  }
  if (command.action === "tocar") {
    const search = await call("GET", "/v1/search", { query: { q: command.query, type: command.type, limit: "1" } });
    if (!search.ok) return { ok: false, reason: playerError(search) };
    const key = `${command.type}s`;
    const item = search.data?.[key]?.items?.find(Boolean);
    if (!item?.uri) return { ok: false, reason: "not_found" };
    const body = command.type === "track" ? { uris: [item.uri] } : { context_uri: item.uri };
    const done = await onDevice(fetchImpl, tokens, (deviceId) => call("PUT", "/v1/me/player/play", { query: withDevice(null, deviceId), body }));
    const playing = { name: item.name || "", artists: artistsOf(item) || (command.type === "playlist" ? "playlist" : "") };
    // Spotify fechado (nenhum aparelho): devolve a URI para o navegador abrir o app (`open_spotify`, dono 2026-10-23).
    if (!done.ok && done.reason === "no_device" && isSpotifyUri(item.uri)) return { ...done, uri: item.uri, playing };
    return { ...done, playing };
  }
  if (command.action === "volume") {
    let volume = command.volume;
    if (volume === undefined) {
      const state = await call("GET", "/v1/me/player");
      const current = Number(state.data?.device?.volume_percent);
      volume = Math.max(0, Math.min(100, (Number.isFinite(current) ? current : 50) + command.step));
    }
    const done = await onDevice(fetchImpl, tokens, (deviceId) => call("PUT", "/v1/me/player/volume", { query: withDevice({ volume_percent: String(volume) }, deviceId) }));
    return { ...done, volume };
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
      if (played.ok) return { ok: true, device: device.name || "" };
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
    if (reason === "premium") return "O Spotify recusou: o controle exige conta Premium.";
    if (reason === "not_connected") return "Spotify não conectado. Ofereça conectar na tela Alexa e Henry (abrir_tela destino alexa), em uma frase.";
    return "O Spotify não respondeu agora. Diga isso em poucas palavras.";
  }
  if (command.action === "tocando") {
    if (!result.playing) return "Nada tocando agora no Spotify.";
    return JSON.stringify({ tocando: result.playing.name, de: result.playing.artists, pausado: !result.playing.isPlaying });
  }
  if (command.action === "tocar") return JSON.stringify({ tocando_agora: result.playing?.name || command.query, de: result.playing?.artists || "", instrucao: "Confirme em poucas palavras." });
  if (command.action === "volume") return JSON.stringify({ volume: result.volume, instrucao: "Confirme em poucas palavras." });
  return "Feito. Confirme em 1–3 palavras.";
}
