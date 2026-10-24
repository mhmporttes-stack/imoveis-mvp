import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertOwnerAdmin } from "./admin-access";
import { decryptSecret, encryptSecret, hasSecretsEncryptionKey } from "./secrets-crypto";
import { grantedTasteScopes } from "./henry-morning-music-core.mjs";
import {
  SPOTIFY_API,
  SPOTIFY_DEFAULT_REDIRECT_URI,
  SPOTIFY_SETTING_ID,
  createSpotifyTokenManager,
  describeSpotifyOpenResult,
  describeSpotifyResult,
  duckSpotifyVolume,
  setSpotifyVolume,
  exchangeSpotifyCode,
  normalizeSpotifyCommand,
  normalizeSpotifyDeviceRequest,
  playOnSpotifyWhenReady,
  readSpotifyNowPlaying,
  readSpotifyTaste,
  runSpotifyCommand,
  spotifyDeviceLine,
  spotifySearchUrl,
  transferSpotifyPlayback
} from "./henry-spotify-core.mjs";

// Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1): só o DONO, na conta real (fora de "Alterar conta").
// Variáveis: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (opcional SPOTIFY_REDIRECT_URI). O refresh token fica SÓ no servidor,
// em crm_settings `henry_spotify` (cifrado com CRM_SECRETS_ENCRYPTION_KEY quando a chave existe); o token de acesso só na
// memória da função. Nunca logar token nem segredo.

export function assertHenrySpotifyOwner(auth) {
  assertOwnerAdmin(auth);
  if (auth?.accountSwitchMode) throw Object.assign(new Error("O Spotify do Henry é só do dono, na conta dele (fora de \"Alterar conta\")."), { status: 403 });
}

export function isSpotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

export function spotifyRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI || SPOTIFY_DEFAULT_REDIRECT_URI;
}

async function readRow() {
  const { data, error } = await getSupabaseAdminClient().from("crm_settings").select("setting_value").eq("id", SPOTIFY_SETTING_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value || {};
}

async function writeRow(auth, value) {
  const { error } = await getSupabaseAdminClient()
    .from("crm_settings")
    .upsert({ id: SPOTIFY_SETTING_ID, setting_value: value, updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function sealToken(token) {
  return hasSecretsEncryptionKey() ? { refreshToken: encryptSecret(token), encrypted: true } : { refreshToken: token, encrypted: false };
}

function openToken(row) {
  if (!row?.refreshToken) return "";
  return row.encrypted ? decryptSecret(row.refreshToken) : row.refreshToken;
}

let tokenManager = null;
function tokens() {
  if (!tokenManager) {
    tokenManager = createSpotifyTokenManager({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      readRefreshToken: async () => openToken(await readRow()),
      saveRefreshToken: async (token) => {
        const row = await readRow();
        await writeRow(null, { ...row, ...sealToken(token) });
      }
    });
  }
  return tokenManager;
}

export async function readSpotifyStatus() {
  if (!isSpotifyConfigured()) return { configured: false, connected: false, account: "" };
  const row = await readRow();
  return { configured: true, connected: Boolean(row.refreshToken), account: row.account || "", connectedAt: row.connectedAt || null };
}

// Callback: troca o código pelos tokens e guarda o refresh token (e o nome da conta, se vier).
export async function connectSpotify(auth, code) {
  const result = await exchangeSpotifyCode({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    code,
    redirectUri: spotifyRedirectUri()
  });
  if (!result.refreshToken) throw new Error("spotify_no_refresh_token");
  let account = "";
  try {
    const me = await fetch(`${SPOTIFY_API}/v1/me`, { headers: { Authorization: `Bearer ${result.accessToken}` }, signal: AbortSignal.timeout(8000) });
    if (me.ok) account = String((await me.json().catch(() => ({})))?.display_name || "").slice(0, 60);
  } catch {
    // nome da conta é só enfeite da tela
  }
  // scopes: o que o dono liberou nesta conexão (o gosto do bom dia só lê o que estiver aqui — readHenrySpotifyTaste).
  await writeRow(auth, { ...sealToken(result.refreshToken), account, scopes: result.scope, connectedAt: new Date().toISOString() });
  tokens().clear();
}

export async function disconnectSpotify(auth) {
  await writeRow(auth, { disconnectedAt: new Date().toISOString() });
  tokens().clear();
}

// Ferramenta `spotify` do Henry → texto para o modelo; openUrl = busca no Spotify Web (só no fallback sem variáveis);
// openSpotify = { uri } quando o pedido é tocar e não há aparelho (o navegador abre o app pela URI, dono 2026-10-23).
export async function runHenrySpotifyTool(input) {
  const command = normalizeSpotifyCommand(input);
  if (command.error) return { text: "Comando de música não entendido. Pergunte, curto, o que ele quer ouvir." };
  if (!isSpotifyConfigured()) {
    if (command.action !== "tocar") return { text: "Sem a conexão com o Spotify só consigo abrir a busca no navegador. Diga isso em uma frase." };
    const url = spotifySearchUrl(command.query);
    return { text: `Abrindo a busca de "${command.query}" no Spotify do navegador. Confirme em poucas palavras.`, openUrl: url, query: command.query };
  }
  const status = await readSpotifyStatus();
  if (!status.connected) return { text: describeSpotifyResult(command, { ok: false, reason: "not_connected" }), command, result: { ok: false, reason: "not_connected" } };
  try {
    const result = await runSpotifyCommand(command, { tokens: tokens() });
    return { text: describeSpotifyResult(command, result), command, result, ...(result.uri ? { openSpotify: { uri: result.uri } } : {}) };
  } catch (error) {
    if (error?.message === "spotify_revoked") return { text: describeSpotifyResult(command, { ok: false, reason: "not_connected" }), command, result: { ok: false, reason: "not_connected" } };
    console.warn(`[henry] spotify falhou: ${error?.status || error?.name || "erro"}.`);
    return { text: describeSpotifyResult(command, { ok: false, reason: "failed" }), command, result: { ok: false, reason: "failed" } };
  }
}

// Ferramenta `mudar_aparelho_spotify` (dono, 2026-10-23): passa a música para outro aparelho do Spotify Connect.
// { text (para o modelo), line (fala fixa), result }. restoreVolume = volume guardado pela tela antes de abaixar a música.
export async function runHenrySpotifyDeviceTool(input, { restoreVolume = null } = {}) {
  const request = normalizeSpotifyDeviceRequest(input);
  if (request.error) return { text: "Pergunte, curto, para qual aparelho ele quer passar a música.", line: "", result: null };
  const finish = (result) => {
    const line = spotifyDeviceLine(result);
    return { text: `${result.ok ? "Feito." : "Não trocou."} Diga exatamente: ${line}`, line, result };
  };
  if (!isSpotifyConfigured() || !(await readSpotifyStatus()).connected) return finish({ ok: false, reason: "not_connected", requested: request.kind });
  try {
    return finish(await transferSpotifyPlayback(request, { tokens: tokens(), restoreVolume }));
  } catch (error) {
    if (error?.message === "spotify_revoked") return finish({ ok: false, reason: "not_connected", requested: request.kind });
    console.warn(`[henry] spotify (trocar aparelho) falhou: ${error?.status || error?.name || "erro"}.`);
    return finish({ ok: false, reason: "failed", requested: request.kind });
  }
}

// "Tocando agora" (ondas sonoras da tela cheia): leitura leve, sem escrever nada. Sem Spotify → { isPlaying: false }.
const tempoCache = new Map();
export async function readHenryNowPlaying() {
  if (!isSpotifyConfigured()) return { configured: false, isPlaying: false };
  const status = await readSpotifyStatus();
  if (!status.connected) return { configured: true, connected: false, isPlaying: false };
  return { configured: true, connected: true, ...(await readSpotifyNowPlaying({ tokens: tokens(), tempoCache })) };
}

// Abaixa a música enquanto o Henry escuta/fala ({ ducked, previous }) e restaura depois (volume guardado pela tela).
export async function duckHenrySpotify() {
  if (!isSpotifyConfigured() || !(await readSpotifyStatus()).connected) return { ducked: false };
  return duckSpotifyVolume({ tokens: tokens() });
}

export async function restoreHenrySpotify(volume) {
  if (!isSpotifyConfigured()) return { ok: false };
  return setSpotifyVolume(volume, { tokens: tokens() });
}

// Bom dia com música (dono, 2026-10-23): toca o estilo escolhido com volume baixo. target = { uri } ou { query, type }.
// { ok, reason?, openSpotify? } — openSpotify = { uri } quando não há aparelho (a tela abre o app; o play vem depois).
// acceptBest = toca o melhor resultado mesmo sem bater bem (estilo/sugestão); false (cantor falado, dono 2026-10-24) =
// nada bate → { ok: false, reason: "confirm", candidate } para a pergunta "Achei X, de Y. É essa?".
export async function startHenryMorningMusic(target, volume, { acceptBest = true } = {}) {
  if (!isSpotifyConfigured() || !target) return { ok: false, reason: "not_connected" };
  try {
    const result = await runSpotifyCommand({ action: "tocar", query: target.query || "", type: target.type || "playlist", uri: target.uri || "", volume, acceptBest, broad: target.broad === true }, { tokens: tokens() });
    return { ok: result.ok, reason: result.reason, playing: result.playing || null, uri: result.uri || "", ...(result.uri ? { openSpotify: { uri: result.uri } } : {}), ...(result.candidate ? { candidate: result.candidate } : {}) };
  } catch (error) {
    console.warn(`[henry] spotify (bom dia) falhou: ${error?.status || error?.message === "spotify_revoked" ? "revogado" : error?.name || "erro"}.`);
    return { ok: false, reason: "failed" };
  }
}

// Depois de o navegador abrir o Spotify (`open_spotify`): espera um aparelho aparecer (~10 s) e toca a URI nele.
// { ok, reply } — reply vazio quando tocou; senão a frase curta pedindo um play no Spotify.
export async function playSpotifyAfterOpen(uri, { volume = null } = {}) {
  if (!isSpotifyConfigured()) return { ok: false, reply: describeSpotifyOpenResult({ ok: false, reason: "failed" }) };
  try {
    const result = await playOnSpotifyWhenReady(uri, { tokens: tokens(), volume });
    return { ok: result.ok, reply: describeSpotifyOpenResult(result) };
  } catch (error) {
    console.warn(`[henry] spotify (abrir e tocar) falhou: ${error?.status || error?.name || "erro"}.`);
    return { ok: false, reply: describeSpotifyOpenResult({ ok: false, reason: "failed" }) };
  }
}

// Gosto do dono no Spotify para a sugestão do bom dia. null = sem os escopos de leitura (conexão de hoje) ou sem Spotify —
// nenhuma chamada à API nesse caso. Os escopos vêm da própria conexão (crm_settings henry_spotify.scopes).
export async function readHenrySpotifyTaste() {
  if (!isSpotifyConfigured()) return null;
  const row = await readRow();
  const granted = row.refreshToken ? grantedTasteScopes(row.scopes) : [];
  if (!granted.length) return null;
  try {
    return await readSpotifyTaste(granted, { tokens: tokens() });
  } catch (error) {
    console.warn(`[henry] spotify (gosto do bom dia) falhou: ${error?.status || error?.name || "erro"}.`);
    return null;
  }
}
