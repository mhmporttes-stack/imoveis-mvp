import { NextResponse } from "next/server";
import { isOwnerAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import {
  answerHenry,
  claimHenryDevice,
  getHenryNarration,
  henryNarrationVoiceKey,
  readHenryDayTurns,
  synthesizeHenryShort,
  henryDefaultVoice,
  henryVoiceProvider,
  isHenryVoiceConfigured,
  listElevenLabsVoices,
  readElevenLabsSubscription,
  previewHenryStyle,
  readHenrySettings,
  setHenrySettings,
  synthesizeHenrySample,
  synthesizeHenrySpeech,
  transcribeHenryAudio,
  warmHenryReport
} from "@/lib/henry-voice";
import { HENRY_FALLBACK_REPLY, HENRY_MAX_QUESTION_LENGTH, isHenryEligible, parseHenryImage, safeHenryReply, shouldUseHenryImage } from "@/lib/henry-voice-core.mjs";
import { henryBrowserRate, henryEndWaitMs, henryListenAckOn, henryStyleOptions, parseHenryStylePatch } from "@/lib/henry-voice-style.mjs";
import { splitForSpeech } from "@/lib/henry-voice-conversation.mjs";
import { henryInitialProgress } from "@/lib/henry-voice-narration.mjs";
import { isAllowedHenryNavigation, isHenryClientId } from "@/lib/henry-navigation-core.mjs";
import { isSpotifyOpenUrl, isSpotifyUri } from "@/lib/henry-spotify-core.mjs";
import { parseMorningState } from "@/lib/henry-morning-core.mjs";
import { readSpotifyStatus } from "@/lib/henry-spotify";
import { henryAlertPhraseAudio, pollHenryClientAlerts, speakHenryClientAlerts } from "@/lib/henry-voice-client-alerts";

// Navegação devolvida ao navegador: só tela da lista fechada ou ficha de cliente (id no formato do banco).
function navigationPayload(navigate) {
  if (!navigate?.path || !isAllowedHenryNavigation(navigate.path)) return null;
  return { path: navigate.path, label: navigate.label, key: navigate.key || "", ...(isHenryClientId(navigate.clientId) ? { clientId: navigate.clientId } : {}) };
}
// Link externo devolvido ao navegador: só a busca do Spotify Web (fallback sem as variáveis do Spotify).
function openUrlPayload(url) {
  return isSpotifyOpenUrl(url) ? url : null;
}

// Spotify fechado: ação `open_spotify` com a URI do item (só spotify:track|playlist|album|artist:<id>).
function spotifyPayload(spotify) {
  if (!(spotify?.action === "open_spotify" && isSpotifyUri(spotify.uri))) return null;
  const volume = Number.isInteger(spotify.volume) && spotify.volume >= 0 && spotify.volume <= 100 ? spotify.volume : null;
  return { action: "open_spotify", uri: spotify.uri, ...(volume !== null ? { volume } : {}) };
}

// Bom dia em conversa (dono, 2026-10-23): próximo passo que a tela guarda na janela de conversa (só o nome do passo).
function morningPayload(morning) {
  return parseMorningState(morning);
}
import { HENRY_AUDIO_MAX_MS, HENRY_PROVIDER_LABELS, checkHenryAudio } from "@/lib/henry-voice-providers.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // relatório de período longo (ex.: 90 dias) calculado na hora

// Assistente de voz "Henry" (docs/BUSINESS_RULES.md HENRY-1). Só o DONO, na conta real, fora de "Alterar conta" — os
// outros perfis recebem 403 (o componente nem é montado para eles; a barreira é esta rota). SOMENTE LEITURA.
async function requireHenryOwner(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return auth;
  if (!isHenryEligible({ ok: auth.ok, accountSwitchMode: auth.accountSwitchMode, isOwner: isOwnerAdminEmail(auth.user?.email) })) {
    return { ok: false, status: 403, error: "O assistente Henry é só do dono, na conta dele (fora de \"Alterar conta\")." };
  }
  return auth;
}

export async function GET(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const [{ enabled, vision, webSearch, mobileWake, clientAlerts, teamArrivals, voiceNotices, style }, dayTurns] = await Promise.all([readHenrySettings(), readHenryDayTurns().catch(() => [])]);
    const provider = henryVoiceProvider();
    // Lista de vozes da ElevenLabs só para o cartão de configurações (?vozes=1); o ícone do canto não precisa dela.
    // Junto, o saldo de caracteres (GET /v1/user/subscription). 401/403 viram frase clara de permissão na tela.
    let elevenVoices = null;
    let elevenVoicesError = "";
    let elevenSubscription = null;
    let elevenSubscriptionError = "";
    if (provider === "elevenlabs" && new URL(request.url).searchParams.get("vozes") === "1") {
      [elevenVoices, elevenSubscription] = await Promise.all([
        listElevenLabsVoices().catch((error) => {
          console.warn(`[henry] lista de vozes da ElevenLabs falhou: ${error?.status || "erro"}.`);
          elevenVoicesError = error?.status ? error.message : "Não consegui listar as vozes da ElevenLabs agora.";
          return [];
        }),
        readElevenLabsSubscription().catch((error) => {
          console.warn(`[henry] saldo da ElevenLabs falhou: ${error?.status || "erro"}.`);
          elevenSubscriptionError = error?.status ? error.message : "Não consegui ler o saldo da ElevenLabs agora.";
          return null;
        })
      ]);
    }
    // Spotify (tela "Voz e personalidade"): só com ?vozes=1, como a lista de vozes.
    const spotify = new URL(request.url).searchParams.get("vozes") === "1"
      ? await readSpotifyStatus().catch(() => ({ configured: true, connected: false, account: "", error: "Não consegui ler a conexão do Spotify agora." }))
      : null;
    return NextResponse.json({
      spotify,
      enabled,
      vision,
      webSearch,
      mobileWake,
      clientAlerts,
      teamArrivals,
      voiceNotices, // "Avisos só por voz (sem card na tela)" — nasce ligado
      dayTurns: enabled ? dayTurns : [], // memória do dia: a tela cheia mostra a conversa de hoje (só texto)
      serverVoice: isHenryVoiceConfigured(),
      provider,
      providerLabel: HENRY_PROVIDER_LABELS[provider],
      style,
      narrationKey: henryNarrationVoiceKey(style), // frases de espera: o navegador reaproveita as da sessão com a mesma chave
      browserRate: henryBrowserRate(style),
      endWaitMs: henryEndWaitMs(style), // tempo de espera do fim da fala (gravação e parcial do navegador)
      listenAck: henryListenAckOn(style), // "Confirmar que ouviu" (som/interjeição/frase curta depois do fim da fala)
      options: henryStyleOptions({ defaultVoice: henryDefaultVoice() }),
      elevenVoices,
      elevenVoicesError,
      elevenSubscription,
      elevenSubscriptionError
    });
  } catch (error) {
    console.error("[henry] falha ao ler a configuração:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler a configuração do Henry." }, { status: 500 });
  }
}

// Liga/desliga o Henry (nasce ligado) e a visão pela webcam (nasce desligada): { enabled?, vision? }.
// Voz e personalidade: { style: { voice?, tone?, speed?, endWait?, details?, address? } } validado por Zod (henry-voice-style.mjs).
export async function PUT(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.vision === "boolean") patch.vision = body.vision;
  if (typeof body?.mobileWake === "boolean") patch.mobileWake = body.mobileWake;
  if (typeof body?.webSearch === "boolean") patch.webSearch = body.webSearch;
  if (typeof body?.clientAlerts === "boolean") patch.clientAlerts = body.clientAlerts;
  if (typeof body?.teamArrivals === "boolean") patch.teamArrivals = body.teamArrivals;
  if (typeof body?.voiceNotices === "boolean") patch.voiceNotices = body.voiceNotices;
  if (body?.style !== undefined) {
    const parsed = parseHenryStylePatch(body.style);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    patch.style = parsed.patch;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Informe enabled, vision, webSearch e/ou style." }, { status: 400 });
  try {
    const saved = await setHenrySettings(auth, patch);
    return NextResponse.json({ ...saved, browserRate: henryBrowserRate(saved.style), endWaitMs: henryEndWaitMs(saved.style), listenAck: henryListenAckOn(saved.style) });
  } catch (error) {
    console.error("[henry] falha ao salvar a configuração:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar a configuração do Henry." }, { status: 500 });
  }
}

// Modo conversa em linhas (NDJSON), aberto LOGO ao receber o pedido (sem silêncio enquanto ele pensa):
//   { progress, topic, label, broker? } — evento inicial e um por ferramenta chamada (narração e cena de busca);
//   { narration: { text, audio } }     — frase curta com o nome do corretor, na voz do Henry (sintetizada na hora);
//   { reply, navigate, openUrl, detail, scene } — resposta (texto falado + detalhe da tela, quando houver + cena da resposta);
//   { part, text, audio|null } por parte → { done: true }. audio null = o navegador fala a parte.
//   { error } — falhou depois de aberto (a tela mostra a frase).
// Se o navegador cancelar (o dono interrompeu), as escritas seguintes falham em silêncio e o fluxo termina.
function answerStream(auth, request, style) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (payload) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          open = false;
        }
      };
      const pending = [];
      const startedAt = Date.now();
      // Voz antecipada (dono, 2026-10-23: "ele demora muito para responder"): a 1ª frase da resposta já vai para a voz
      // enquanto o modelo termina o resto. Só é usada se for EXATAMENTE a 1ª parte da resposta final (que já passou pela
      // barreira da fala); senão é descartada (custo de uma fala curta).
      let early = null;
      const onFirstSentence = (sentence) => {
        const safe = safeHenryReply(sentence);
        if (!safe || safe === HENRY_FALLBACK_REPLY) return;
        const ttsStarted = Date.now();
        early = { text: safe, audio: synthesizeHenrySpeech(auth, safe, style).then((audio) => ({ audio, ms: Date.now() - ttsStarted })) };
      };
      // Pedido de música (texto ou resposta da música do bom dia) já abre com o tópico "music" (dono, 2026-10-23).
      send(henryInitialProgress(request.mode, { question: request.question, morningStep: request.morning?.step || "" }));
      try {
        const answer = await answerHenry(auth, {
          ...request,
          style,
          onFirstSentence,
          onProgress: ({ say, ...event }) => {
            send(event);
            if (say) pending.push(synthesizeHenryShort(auth, say, style).then((audio) => audio && send({ narration: { text: say, audio } })).catch(() => {}));
          }
        });
        const navigate = navigationPayload(answer.navigate);
        send({ reply: answer.reply, navigate, openUrl: openUrlPayload(answer.openUrl), detail: answer.detail || null, spotify: spotifyPayload(answer.spotify), morning: morningPayload(answer.morning), scene: answer.scene || null, ...(answer.memoryCleared ? { memoryCleared: true } : {}), ...(answer.musicPlaying ? { musicPlaying: true } : {}), ...(answer.spotifyMoved ? { spotifyMoved: true } : {}) });
        const replyAt = Date.now();
        const parts = splitForSpeech(answer.reply);
        const reuse = early && parts[0] === early.text;
        const ttsStarted = Date.now();
        const audios = parts.map((text, index) => (index === 0 && reuse ? early.audio.then((result) => result.audio) : synthesizeHenrySpeech(auth, text, style, { previousText: parts[index - 1] || "", nextText: parts[index + 1] || "" })));
        let firstPartAt = 0;
        for (let index = 0; index < parts.length; index += 1) {
          send({ part: index, text: parts[index], audio: await audios[index] });
          if (!index) firstPartAt = Date.now();
        }
        // Tempos de cada etapa (ms, sem conteúdo): no log do servidor e para o console de diagnóstico da tela.
        const timing = {
          ...(answer.timing || {}),
          ateResposta: replyAt - startedAt,
          tts1: firstPartAt ? firstPartAt - (reuse ? replyAt : ttsStarted) : null,
          ate1aParte: firstPartAt ? firstPartAt - startedAt : null,
          vozAntecipada: Boolean(reuse)
        };
        console.info(`[henry] tempos: resposta=${timing.ateResposta}ms modelo=${timing.modelMs ?? "-"}ms 1o_token=${timing.firstTokenMs ?? "-"}ms ferramentas=${timing.toolsMs ?? 0}ms rodadas=${timing.rounds ?? "-"} 1a_parte=${timing.ate1aParte ?? "-"}ms antecipada=${reuse ? "sim" : "nao"} ferramentas_ligadas=${timing.tools === false ? "nao" : "sim"}.`);
        send({ timing });
        send({ done: true });
      } catch (error) {
        console.warn(`[henry] pergunta falhou: ${error?.status ? error.message : error?.name === "TimeoutError" ? "timeout" : "erro"}.`);
        send({ error: error?.status ? error.message : "Não consegui responder agora. Tente de novo." });
      }
      await Promise.allSettled(pending);
      if (open) controller.close();
    },
    cancel() {}
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

// Pergunta → resposta (texto + tela da lista fechada + voz). Nada é gravado além do custo em "Gastos de IA".
// Visão (HENRY-2): o corpo pode trazer `image` (1 quadro JPEG da webcam). Só é usada com a visão LIGADA e no "bom dia" ou
// em pergunta com intenção visual; nunca é gravada nem logada. Corpo limitado (MAX_BODY_CHARS).
// Tocar para falar no celular: { mode: "transcribe", audio } (data URL, ≤ 20 s; tipos do iPhone aceitos por checkHenryAudio) → { text } pela ElevenLabs; o áudio nunca
// é gravado nem logado. { mode: "warm" } pré-aquece os números do relatório (cache curto, nenhuma chamada paga).
// Cobre 20 s de gravação do iPhone em base64 (HENRY_AUDIO_MAX_BASE64 = 2 milhões) + o JSON; abaixo do teto da Vercel (4,5 MB).
const MAX_BODY_CHARS = 2_200_000;

export async function POST(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_CHARS) return NextResponse.json({ error: "Pedido grande demais." }, { status: 413 });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: "Pedido grande demais." }, { status: 413 });
  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    body = {};
  }
  // "Ouvir amostra" (Voz e personalidade): frase curta fixa com o estilo escolhido na tela (ainda não salvo). Chamada paga
  // pequena: mesmo limite de taxa das perguntas e custo em ai_usage_log (henry_voice_tts). Não exige o Henry ligado.
  if (body?.mode === "sample") {
    const parsed = parseHenryStylePatch(body?.style);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    try {
      if (!(await checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 }))) {
        return NextResponse.json({ error: "Muitas amostras seguidas. Espere um minuto." }, { status: 429 });
      }
      const { style: saved } = await readHenrySettings();
      const style = previewHenryStyle(saved, parsed.patch);
      const sample = await synthesizeHenrySample(auth, style);
      return NextResponse.json({ text: sample.text, audio: sample.audio, voiceError: sample.voiceError, browserRate: henryBrowserRate(style) });
    } catch (error) {
      console.warn(`[henry] amostra falhou: ${error?.name === "TimeoutError" ? "timeout" : "erro"}.`);
      return NextResponse.json({ error: "Não consegui tocar a amostra agora." }, { status: 502 });
    }
  }
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
  // Abriu a cena no celular (toque): reserva a conversa para este aparelho antes de falar.
  if (body?.mode === "claim") {
    const allowed = await claimHenryDevice(auth, deviceId).catch(() => true);
    return NextResponse.json({ ok: true, allowed });
  }
  // Avisos de cliente novo/transferido (HENRY-1, dono 2026-10-23), só leitura:
  //   { action: "poll", since, seen, call, voice } → { cursor, hold?, quiet?, events, callAudio } (consulta leve a cada ~30 s);
  //   { action: "speak", clientIds, recent, away, voice } → { text, audio, recent } (depois do "pode falar");
  //   { action: "phrase", text } → { audio } (só frases da lista fechada do aviso e a repetição curta da pergunta aberta).
  if (body?.mode === "client_alerts") {
    try {
      const { enabled, clientAlerts, teamArrivals, voiceNotices, style } = await readHenrySettings();
      if (!enabled || (!clientAlerts && !teamArrivals && !voiceNotices)) return NextResponse.json({ disabled: true, events: [] });
      const kinds = { clients: clientAlerts, arrivals: teamArrivals };
      const voice = body?.voice !== false;
      if (body?.action === "poll") {
        const result = await pollHenryClientAlerts(auth, { since: typeof body?.since === "string" ? body.since : "", seen: body?.seen, deviceId, call: typeof body?.call === "string" ? body.call : "", style, voice, ...kinds });
        return NextResponse.json(result);
      }
      if (!(await checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 }))) {
        return NextResponse.json({ error: "Muitas falas seguidas. Espere um minuto." }, { status: 429 });
      }
      if (body?.action === "speak") {
        const clientIds = (Array.isArray(body?.clientIds) ? body.clientIds : []).filter((id) => isHenryClientId(id)).slice(0, 20);
        const userIds = (Array.isArray(body?.userIds) ? body.userIds : []).filter((id) => isHenryClientId(id)).slice(0, 20); // id de usuário: mesmo formato uuid
        const noticeIds = voiceNotices ? (Array.isArray(body?.noticeIds) ? body.noticeIds : []).filter((id) => isHenryClientId(id)).slice(0, 30) : []; // avisos da Central (uuid)
        return NextResponse.json(await speakHenryClientAlerts(auth, { clientIds, userIds, noticeIds, ...kinds, recent: body?.recent && typeof body.recent === "object" ? body.recent : null, away: body?.away === true, style, voice }));
      }
      if (body?.action === "phrase") {
        return NextResponse.json({ audio: voice ? await henryAlertPhraseAudio(auth, typeof body?.text === "string" ? body.text : "", style) : null });
      }
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    } catch (error) {
      console.warn(`[henry] aviso de clientes falhou (${error?.name || "erro"}).`);
      return NextResponse.json({ error: "Não consegui ler os clientes novos agora." }, { status: 502 });
    }
  }
  if (body?.mode === "warm") {
    try {
      const { enabled } = await readHenrySettings();
      if (enabled) await warmHenryReport(auth);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.warn(`[henry] pré-aquecimento falhou (${error?.name || "erro"}).`);
      return NextResponse.json({ error: "Não foi possível pré-carregar o relatório." }, { status: 502 });
    }
  }
  // Frases de espera na voz do Henry (narração): conjunto fixo sintetizado uma vez por voz+estilo+frase e guardado em cache
  // (servidor 6 h; o navegador guarda na sessão pela voiceKey). Sem voz do servidor → lista vazia (fica em silêncio).
  if (body?.mode === "narration") {
    try {
      const { enabled, style } = await readHenrySettings();
      if (!enabled) return NextResponse.json({ voiceKey: "", phrases: [] });
      // ids = só essas frases (pré-aquecimento em lotes / frase ainda não usada hoje); sem ids = o pacote (com teto de tempo).
      const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === "string" && /^[a-z]\d{1,3}$/.test(id)) : null;
      return NextResponse.json(await getHenryNarration(auth, style, { ids }));
    } catch (error) {
      console.warn(`[henry] frases de espera indisponíveis (${error?.name || "erro"}).`);
      return NextResponse.json({ error: "Frases de espera indisponíveis agora." }, { status: 502 });
    }
  }
  if (body?.mode === "transcribe") {
    const checked = checkHenryAudio(body?.audio);
    if (!checked.audio) {
      console.warn(`[henry] gravação recusada (${checked.reason}).`);
      return NextResponse.json({ error: checked.error }, { status: checked.reason === "too_long" ? 413 : 400 });
    }
    const audio = checked.audio;
    const durationMs = Math.min(HENRY_AUDIO_MAX_MS + 2000, Math.max(0, Number(body?.durationMs) || 0));
    try {
      const [{ enabled }, allowedRate] = await Promise.all([readHenrySettings(), checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 })]);
      if (!enabled) return NextResponse.json({ error: "O Henry está desligado. Ligue em Alexa e Henry." }, { status: 409 });
      if (!allowedRate) return NextResponse.json({ error: "Muitas perguntas seguidas. Espere um minuto." }, { status: 429 });
      const sttStarted = Date.now();
      const text = await transcribeHenryAudio(auth, audio, { durationMs });
      return NextResponse.json({ text, ms: Date.now() - sttStarted }); // ms = tempo da ElevenLabs (diagnóstico de latência)
    } catch (error) {
      return NextResponse.json({ error: error?.status ? error.message : "Não consegui entender o áudio agora. Tente de novo." }, { status: error?.status || 502 });
    }
  }
  const mode = body?.mode === "report" ? "report" : "question";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (mode === "question" && !question) return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });
  if (question.length > HENRY_MAX_QUESTION_LENGTH) return NextResponse.json({ error: "Pergunta longa demais." }, { status: 400 });

  try {
    // Aparelho, configuração e limite de taxa ao mesmo tempo (eram três idas ao banco em fila).
    const [allowedDevice, { enabled, vision, webSearch, style }, allowedRate] = await Promise.all([
      deviceId ? claimHenryDevice(auth, deviceId).catch(() => true) : true,
      readHenrySettings(),
      checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 })
    ]);
    // Outro aparelho está conversando com o Henry agora: este fica calado (o mesmo pedido ouvido pelos dois).
    if (!allowedDevice) return NextResponse.json({ skipped: "other_device" });
    if (!enabled) return NextResponse.json({ error: "O Henry está desligado. Ligue em Alexa e Henry." }, { status: 409 });
    if (!allowedRate) return NextResponse.json({ error: "Muitas perguntas seguidas. Espere um minuto." }, { status: 429 });
    const image = shouldUseHenryImage({ vision, mode, question }) ? parseHenryImage(body?.image) : null;
    // Modo conversa: `stream` = linhas (NDJSON) abertas na hora: progresso/narração enquanto pensa, depois o texto e a voz
    // em partes (1ª frase primeiro). Mesmo texto, mesma barreira (safeHenryReply já aplicada).
    const morning = parseMorningState(body?.morning);
    // Volume que a tela guardou ao abaixar a música para ele falar: a troca de aparelho devolve no aparelho de origem.
    const spotifyVolume = Number.isInteger(body?.spotifyVolume) && body.spotifyVolume >= 0 && body.spotifyVolume <= 100 ? body.spotifyVolume : null;
    if (body?.stream === true && body?.voice !== false) return answerStream(auth, { mode, question, history: body?.history, image, morning, spotifyVolume, vision, webSearch }, style);
    const answer = await answerHenry(auth, { mode, question, history: body?.history, image, style, morning, spotifyVolume, vision, webSearch });
    const navigate = navigationPayload(answer.navigate);
    const audio = body?.voice === false ? null : await synthesizeHenrySpeech(auth, answer.reply, style);
    return NextResponse.json({ reply: answer.reply, navigate, openUrl: openUrlPayload(answer.openUrl), detail: answer.detail || null, spotify: spotifyPayload(answer.spotify), morning: morningPayload(answer.morning), scene: answer.scene || null, memoryCleared: answer.memoryCleared === true, ...(answer.musicPlaying ? { musicPlaying: true } : {}), ...(answer.spotifyMoved ? { spotifyMoved: true } : {}), audio });
  } catch (error) {
    console.warn(`[henry] pergunta falhou: ${error?.status ? error.message : error?.name === "TimeoutError" ? "timeout" : "erro"}.`);
    return NextResponse.json({ error: error?.status ? error.message : "Não consegui responder agora. Tente de novo." }, { status: error?.status || 502 });
  }
}
