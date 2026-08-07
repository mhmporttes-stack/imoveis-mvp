import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageCaptacoes, createCaptacao, formatCaptacaoError, listCaptacoes } from "@/lib/captacoes";
import { sendCaptacaoNotification } from "@/lib/captacao-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageCaptacoes()) {
    return NextResponse.json({ error: "Modulo de captacoes desativado." }, { status: 503 });
  }

  try {
    return NextResponse.json(await listCaptacoes());
  } catch (error) {
    console.error("Captacoes list failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  if (!canManageCaptacoes()) {
    return NextResponse.json(
      { error: "Nao foi possivel enviar seu imovel agora. Tente novamente em alguns instantes." },
      { status: 503 }
    );
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie informacoes validas para continuar." }, { status: 400 });
  }

  try {
    const captacao = await createCaptacao(payload);

    try {
      const notification = await sendCaptacaoNotification(captacao);
      if (notification?.skipped) {
        console.warn("Captacao notification skipped:", notification.reason);
      }
    } catch (notificationError) {
      console.warn("Captacao notification failed:", notificationError?.message || notificationError);
    }

    return NextResponse.json({ ok: true, captacaoId: captacao.id }, { status: 201 });
  } catch (error) {
    console.error("Captacao create failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
