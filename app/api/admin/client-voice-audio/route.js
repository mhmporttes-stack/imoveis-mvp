import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import {
  VoiceAudioError,
  clientVoiceAudioEnvironment,
  getClientVoiceAudioSettings,
  previewClientVoiceAudio,
  updateClientVoiceAudioSettings
} from "@/lib/client-voice-audio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Áudio com a voz do dono para o cliente (VOZ-1, dono 2026-10-23) — configuração só do admin geral.
// GET: configuração + ambiente (chave existe? modelo). PATCH: { enabled? , voiceId?, template?: {moment, variant, text},
// approve?: {moment, variant} } — editar texto desaprova. POST: prévia { moment, variant, text?, voiceId? } → { url, text }
// (gera ou reaproveita o áudio; nunca envia a ninguém).
function errorResponse(error, fallback) {
  if (error instanceof VoiceAudioError) return NextResponse.json({ error: error.message, reason: error.reason }, { status: error.status });
  console.error("[audio-voz]", error?.message || error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ settings: await getClientVoiceAudioSettings(), environment: clientVoiceAudioEnvironment() });
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar a configuração do áudio.");
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.voiceId === "string") patch.voiceId = body.voiceId;
    if (body.template && typeof body.template === "object") patch.template = { moment: body.template.moment, variant: body.template.variant, text: String(body.template.text ?? "") };
    if (body.approve && typeof body.approve === "object") patch.approve = { moment: body.approve.moment, variant: body.approve.variant };
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
    return NextResponse.json({ settings: await updateClientVoiceAudioSettings(auth, patch) });
  } catch (error) {
    return errorResponse(error, "Não foi possível salvar a configuração do áudio.");
  }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
    const preview = await previewClientVoiceAudio(auth, {
      moment: body.moment,
      variant: body.variant,
      text: typeof body.text === "string" ? body.text : undefined,
      voiceId: typeof body.voiceId === "string" ? body.voiceId : undefined
    });
    return NextResponse.json({ url: preview.url, text: preview.text, cached: preview.cached });
  } catch (error) {
    return errorResponse(error, "Não foi possível gerar a prévia do áudio.");
  }
}
