import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MORNING_MIROSMAR,
  MORNING_STYLE_QUESTION,
  MORNING_VOLUME,
  birthdayDraft,
  birthdayQuestion,
  classifyMorningMusicAnswer,
  classifyMorningStyle,
  classifyYesNo,
  composeMorningExtras,
  morningMusicPrefix,
  morningOpening,
  parseMorningState,
  resolveMorningMusic,
  spotifyUriFromLink
} from "../lib/henry-morning-core.mjs";
import { runSpotifyCommand } from "../lib/henry-spotify-core.mjs";
import { mergeHenryStyle, parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";
import { safeHenryReply } from "../lib/henry-voice-core.mjs";

const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });

test("bom dia: abertura, estado e leitura das respostas (música → estilo → aniversário)", () => {
  assert.equal(morningOpening("Matheus"), "E aí, Matheus! Posso dar play numa playlist enquanto te passo as tarefas, agendas e pendências de hoje?");
  assert.equal(MORNING_STYLE_QUESTION, "Qual vibe: aquela playlist top de rock ou aquele sertanejo raiz?");
  assert.deepEqual(parseMorningState({ step: "music" }), { step: "music" });
  assert.deepEqual(parseMorningState({ step: "birthday", names: ["x"] }), { step: "birthday" });
  assert.equal(parseMorningState({ step: "apagar" }), null);
  assert.equal(parseMorningState("music"), null);
  for (const text of ["pode ser", "Pode ser, não tem problema", "sim por favor", "bora", "manda ver"]) assert.equal(classifyMorningMusicAnswer(text), "yes", text);
  for (const text of ["não", "não, hoje não", "agora não", "sem música hoje"]) assert.equal(classifyMorningMusicAnswer(text), "no", text);
  assert.equal(classifyMorningMusicAnswer("bora de sertanejo"), "sertanejo");
  assert.equal(classifyMorningMusicAnswer("põe um rock"), "rock");
  assert.equal(classifyMorningMusicAnswer("quantos clientes entraram ontem?"), "other");
  assert.equal(classifyMorningStyle("sertanejo raiz"), "sertanejo");
  assert.equal(classifyMorningStyle("aquele sertanejo raiz"), "sertanejo");
  assert.equal(classifyMorningStyle("rock"), "rock");
  assert.equal(classifyMorningStyle("tanto faz"), "rock");
  assert.equal(classifyMorningStyle("nenhum, deixa"), "no");
  assert.equal(classifyMorningStyle("qual a agenda de hoje?"), "other");
  assert.equal(classifyYesNo("sim, prepara"), "yes");
  assert.equal(classifyYesNo("não precisa"), "no");
  assert.equal(classifyYesNo("e as vendas?"), "other");
});

test("bom dia: música do estilo (padrões, link configurado, texto = playlist) e fala antes do relatório", () => {
  assert.deepEqual(resolveMorningMusic("rock", {}), { query: "rock clássico", type: "playlist" });
  assert.deepEqual(resolveMorningMusic("sertanejo", {}), { query: "Zezé Di Camargo & Luciano", type: "artist" });
  assert.deepEqual(resolveMorningMusic("rock", { rockMusic: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc" }), { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" });
  assert.deepEqual(resolveMorningMusic("sertanejo", { sertanejoMusic: "Modão de viola" }), { query: "Modão de viola", type: "playlist" });
  assert.equal(resolveMorningMusic("pagode", {}), null);
  assert.equal(spotifyUriFromLink("https://evil.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), "");
  assert.equal(morningMusicPrefix("sertanejo", { ok: true }), MORNING_MIROSMAR);
  assert.equal(morningMusicPrefix("sertanejo", { ok: false, openSpotify: { uri: "spotify:artist:1111111111" } }), `Abrindo o Spotify… ${MORNING_MIROSMAR}`);
  assert.equal(morningMusicPrefix("rock", { ok: true }), "");
  assert.match(morningMusicPrefix("rock", { ok: false, reason: "premium" }), /Não consegui dar o play/);
  assert.equal(MORNING_MIROSMAR, "Vou começar daquele jeito: TOOOCA, MIROSMAR!");
  for (const text of [MORNING_MIROSMAR, morningOpening("Matheus"), MORNING_STYLE_QUESTION]) assert.equal(safeHenryReply(text), text);
});

test("bom dia: tocar com volume baixo no aparelho (fetch mockado) e sem aparelho devolve a URI para abrir o app", async () => {
  const tokens = { getAccessToken: async () => "at" };
  const log = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace("https://api.spotify.com", "");
    log.push(`${options.method} ${path}`);
    if (path.startsWith("/v1/search")) return reply(200, { artists: { items: [{ uri: "spotify:artist:3kM5mmtwFE3GPhrxXRe3PL", name: "Zezé Di Camargo & Luciano" }] } });
    return reply(204);
  };
  const played = await runSpotifyCommand({ action: "tocar", query: "Zezé Di Camargo & Luciano", type: "artist", volume: MORNING_VOLUME }, { fetchImpl, tokens });
  assert.equal(played.ok, true);
  assert.ok(log.includes(`PUT /v1/me/player/volume?volume_percent=${MORNING_VOLUME}`));
  assert.ok(log.findIndex((line) => line.startsWith("PUT /v1/me/player/play")) < log.findIndex((line) => line.startsWith("PUT /v1/me/player/volume")));
  log.length = 0;
  const viaLink = await runSpotifyCommand({ action: "tocar", uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", type: "playlist", volume: MORNING_VOLUME }, { fetchImpl, tokens });
  assert.equal(viaLink.ok, true);
  assert.ok(!log.some((line) => line.startsWith("GET /v1/search")), "link configurado não busca");
  const closed = await runSpotifyCommand({ action: "tocar", query: "rock clássico", type: "playlist", volume: MORNING_VOLUME }, {
    tokens,
    fetchImpl: async (url) => {
      if (url.includes("/v1/search")) return reply(200, { playlists: { items: [{ uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", name: "Rock Classics" }] } });
      if (url.includes("/devices")) return reply(200, { devices: [] });
      return reply(404, { error: { reason: "NO_ACTIVE_DEVICE" } });
    }
  });
  assert.deepEqual({ ok: closed.ok, uri: closed.uri }, { ok: false, uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" });
});

test("bom dia: frases do relatório com números reais, sem dizer 'enviei'; aniversário só rascunho", () => {
  assert.equal(composeMorningExtras({ newClients: 5, autoSimulations: 3 }), "Desde ontem entraram 5 clientes novos no CRM. 3 já têm a simulação automática gerada pelo site.");
  assert.equal(composeMorningExtras({ newClients: 1, autoSimulations: 1 }), "Desde ontem entrou 1 cliente novo no CRM. 1 já tem a simulação automática gerada pelo site.");
  assert.equal(composeMorningExtras({ newClients: 0, autoSimulations: 0 }), "Desde ontem não entrou cliente novo no CRM.");
  assert.equal(composeMorningExtras({ newClients: 4, autoSimulations: null }), "Desde ontem entraram 4 clientes novos no CRM.");
  assert.equal(composeMorningExtras({ newClients: null, autoSimulations: 2 }), ""); // leitura falhou: some, nunca zero falso
  for (const sample of [{ newClients: 5, autoSimulations: 3 }, { newClients: 2, autoSimulations: 0 }]) assert.doesNotMatch(composeMorningExtras(sample), /envi/i);
  assert.equal(birthdayQuestion(["Jean"]), "Hoje é aniversário do cliente Jean. Quer que eu prepare uma mensagem pra ele?");
  assert.equal(birthdayQuestion(["Jean", "Ana"]), "Hoje é aniversário dos clientes Jean e Ana. Quer que eu prepare uma mensagem pra eles?");
  assert.equal(birthdayQuestion([]), "");
  assert.match(birthdayDraft("Jean", "Matheus"), /^Feliz aniversário, Jean!.*Matheus\.$/);
});

test("bom dia: músicas configuráveis em Voz e personalidade (sanitizadas; vazio = padrão)", () => {
  const parsed = parseHenryStylePatch({ rockMusic: "  <b>Rock</b> anos 80 ", sertanejoMusic: "" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.patch.rockMusic, "b Rock /b anos 80");
  const merged = mergeHenryStyle({ tone: "descontraido", sertanejoMusic: "Modão" }, parsed.patch);
  assert.equal(merged.rockMusic, "b Rock /b anos 80");
  assert.ok(!("sertanejoMusic" in merged)); // vazio volta ao padrão
  assert.equal(resolveHenryStyle({}).rockMusic, "");
  assert.equal(parseHenryStylePatch({ rockMusic: "x".repeat(200) }).ok, false);
});

test("bom dia: fluxo ligado no servidor e na tela (só o dono, somente leitura, janela de conversa)", () => {
  const voice = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(voice, /await morningMusicAvailable\(\)/); // sem Spotify conectado pula a pergunta
  assert.match(voice, /morning: \{ step: "music" \}/);
  assert.match(voice, /morning: \{ step: "style" \}/);
  assert.match(voice, /step: "birthday"/);
  assert.match(voice, /startHenryMorningMusic\(resolveMorningMusic\(answer, style\), MORNING_VOLUME\)/);
  const loader = readFileSync(new URL("../lib/henry-morning.js", import.meta.url), "utf8");
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete)\(/); // somente leitura
  assert.match(loader, /AUTOMATIC_SIMULATION_SOURCE/);
  assert.match(loader, /listBirthdayRegistrations/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /parseMorningState\(body\?\.morning\)/);
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /isConversationExpired\(conversationNow\.lastAt\)/);
  assert.match(ui, /morningRef\.current = null;/);
});
