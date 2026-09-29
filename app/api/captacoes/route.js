import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createCaptacao, formatCaptacaoError, listCaptacoes } from "@/lib/captacoes";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";
import { sendCaptacaoNotification } from "@/lib/captacao-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return NextResponse.json(await listCaptacoes(auth));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();

    const allowed = await checkPublicRateLimit(buildRateLimitKey(request, payload?.ownerPhone), { windowSeconds: 60, maxAttempts: 1 });
    if (!allowed) {
      return NextResponse.json({ error: "Aguarde alguns instantes antes de enviar novamente." }, { status: 429 });
    }

    const captacao = await createCaptacao(payload);

    try {
      const notification = await sendCaptacaoNotification(captacao);
      if (notification?.skipped) console.warn("Captacao notification email skipped:", notification.reason);
    } catch (notificationError) {
      console.warn("Captacao notification email failed:", notificationError?.message || notificationError);
    }

    return NextResponse.json(captacao, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
