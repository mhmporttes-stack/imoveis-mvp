import { NextResponse } from "next/server";
import { isOwnerAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import {
  answerHenry,
  claimHenryDevice,
  henryDefaultVoice,
  henryVoiceProvider,
  isHenryVoiceConfigured,
  listElevenLabsVoices,
  readElevenLabsSubscription,
  previewHenryStyle,
  readHenrySettings,
  setHenrySettings,
  synthesizeHenrySample,
  synthesizeHenrySpeech
} from "@/lib/henry-voice";
import { HENRY_MAX_QUESTION_LENGTH, isHenryEligible, parseHenryImage, shouldUseHenryImage } from "@/lib/henry-voice-core.mjs";
import { henryBrowserRate, henryStyleOptions, parseHenryStylePatch } from "@/lib/henry-voice-style.mjs";
import { splitForSpeech } from "@/lib/henry-voice-conversation.mjs";
import { HENRY_PROVIDER_LABELS } from "@/lib/henry-voice-providers.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

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
    const { enabled, vision, mobileWake, style } = await readHenrySettings();
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
    return NextResponse.json({
      enabled,
      vision,
      mobileWake,
      serverVoice: isHenryVoiceConfigured(),
      provider,
      providerLabel: HENRY_PROVIDER_LABELS[provider],
      style,
      browserRate: henryBrowserRate(style),
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
// Voz e personalidade: { style: { voice?, tone?, speed?, details?, address? } } validado por Zod (henry-voice-style.mjs).
export async function PUT(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.vision === "boolean") patch.vision = body.vision;
  if (typeof body?.mobileWake === "boolean") patch.mobileWake = body.mobileWake;
  if (body?.style !== undefined) {
    const parsed = parseHenryStylePatch(body.style);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    patch.style = parsed.patch;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Informe enabled, vision e/ou style." }, { status: 400 });
  try {
    const saved = await setHenrySettings(auth, patch);
    return NextResponse.json({ ...saved, browserRate: henryBrowserRate(saved.style) });
  } catch (error) {
    console.error("[henry] falha ao salvar a configuração:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar a configuração do Henry." }, { status: 500 });
  }
}

// Linhas: { reply, navigate } → { part, text, audio|null } por parte → { done: true }. audio null = o navegador fala a parte.
// Se o navegador cancelar (o dono interrompeu), as escritas seguintes falham em silêncio e o fluxo termina.
function speechStream(auth, reply, navigate, style) {
  const parts = splitForSpeech(reply);
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
      send({ reply, navigate });
      const audios = parts.map((text, index) => synthesizeHenrySpeech(auth, text, style, { previousText: parts[index - 1] || "", nextText: parts[index + 1] || "" }));
      for (let index = 0; index < parts.length; index += 1) {
        send({ part: index, text: parts[index], audio: await audios[index] });
      }
      send({ done: true });
      if (open) controller.close();
    },
    cancel() {}
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

// Pergunta → resposta (texto + tela da lista fechada + voz). Nada é gravado além do custo em "Gastos de IA".
// Visão (HENRY-2): o corpo pode trazer `image` (1 quadro JPEG da webcam). Só é usada com a visão LIGADA e no "bom dia" ou
// em pergunta com intenção visual; nunca é gravada nem logada. Corpo limitado (MAX_BODY_CHARS).
const MAX_BODY_CHARS = 900_000;

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
  // Outro aparelho está conversando com o Henry agora: este fica calado (o mesmo pedido ouvido pelos dois).
  if (deviceId && !(await claimHenryDevice(auth, deviceId).catch(() => true))) {
    return NextResponse.json({ skipped: "other_device" });
  }
  const mode = body?.mode === "report" ? "report" : "question";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (mode === "question" && !question) return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });
  if (question.length > HENRY_MAX_QUESTION_LENGTH) return NextResponse.json({ error: "Pergunta longa demais." }, { status: 400 });

  try {
    const { enabled, vision, style } = await readHenrySettings();
    if (!enabled) return NextResponse.json({ error: "O Henry está desligado. Ligue em Alexa e Henry." }, { status: 409 });
    if (!(await checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 }))) {
      return NextResponse.json({ error: "Muitas perguntas seguidas. Espere um minuto." }, { status: 429 });
    }
    const image = shouldUseHenryImage({ vision, mode, question }) ? parseHenryImage(body?.image) : null;
    const answer = await answerHenry(auth, { mode, question, history: body?.history, image, style });
    const navigate = answer.navigate ? { path: answer.navigate.path, label: answer.navigate.label } : null;
    // Modo conversa: `stream` = resposta em linhas (NDJSON) — o texto sai na hora e a voz vai em partes (1ª frase primeiro,
    // geradas em paralelo), para começar a falar antes. Mesmo texto, mesma barreira (safeHenryReply já aplicada).
    if (body?.stream === true && body?.voice !== false) return speechStream(auth, answer.reply, navigate, style);
    const audio = body?.voice === false ? null : await synthesizeHenrySpeech(auth, answer.reply, style);
    return NextResponse.json({ reply: answer.reply, navigate, audio });
  } catch (error) {
    console.warn(`[henry] pergunta falhou: ${error?.status ? error.message : error?.name === "TimeoutError" ? "timeout" : "erro"}.`);
    return NextResponse.json({ error: error?.status ? error.message : "Não consegui responder agora. Tente de novo." }, { status: error?.status || 502 });
  }
}
