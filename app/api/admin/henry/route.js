import { NextResponse } from "next/server";
import { isOwnerAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import { answerHenry, isHenryVoiceConfigured, readHenrySettings, setHenrySettings, synthesizeHenrySpeech } from "@/lib/henry-voice";
import { HENRY_MAX_QUESTION_LENGTH, isHenryEligible, parseHenryImage, shouldUseHenryImage } from "@/lib/henry-voice-core.mjs";

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
    const { enabled, vision } = await readHenrySettings();
    return NextResponse.json({ enabled, vision, serverVoice: isHenryVoiceConfigured() });
  } catch (error) {
    console.error("[henry] falha ao ler a configuração:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler a configuração do Henry." }, { status: 500 });
  }
}

// Liga/desliga o Henry (nasce ligado) e a visão pela webcam (nasce desligada): { enabled?, vision? }.
export async function PUT(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.vision === "boolean") patch.vision = body.vision;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Informe enabled e/ou vision (true ou false)." }, { status: 400 });
  try {
    return NextResponse.json(await setHenrySettings(auth, patch));
  } catch (error) {
    console.error("[henry] falha ao salvar a configuração:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar a configuração do Henry." }, { status: 500 });
  }
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
  const mode = body?.mode === "report" ? "report" : "question";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (mode === "question" && !question) return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });
  if (question.length > HENRY_MAX_QUESTION_LENGTH) return NextResponse.json({ error: "Pergunta longa demais." }, { status: 400 });

  try {
    const { enabled, vision } = await readHenrySettings();
    if (!enabled) return NextResponse.json({ error: "O Henry está desligado. Ligue em Alexa e Henry." }, { status: 409 });
    if (!(await checkPublicRateLimit(`henry:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 20 }))) {
      return NextResponse.json({ error: "Muitas perguntas seguidas. Espere um minuto." }, { status: 429 });
    }
    const image = shouldUseHenryImage({ vision, mode, question }) ? parseHenryImage(body?.image) : null;
    const answer = await answerHenry(auth, { mode, question, history: body?.history, image });
    const audio = body?.voice === false ? null : await synthesizeHenrySpeech(auth, answer.reply);
    return NextResponse.json({ reply: answer.reply, navigate: answer.navigate ? { path: answer.navigate.path, label: answer.navigate.label } : null, audio });
  } catch (error) {
    console.warn(`[henry] pergunta falhou: ${error?.status ? error.message : error?.name === "TimeoutError" ? "timeout" : "erro"}.`);
    return NextResponse.json({ error: error?.status ? error.message : "Não consegui responder agora. Tente de novo." }, { status: error?.status || 502 });
  }
}
