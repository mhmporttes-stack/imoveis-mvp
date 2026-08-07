import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteCaptacao, formatCaptacaoError, getCaptacao, updateCaptacao } from "@/lib/captacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const captacao = await getCaptacao(id);
    if (!captacao) {
      return NextResponse.json({ error: "Captacao nao encontrada." }, { status: 404 });
    }
    return NextResponse.json(captacao);
  } catch (error) {
    console.error("Captacao get failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const captacao = await updateCaptacao(id, await request.json());
    return NextResponse.json(captacao);
  } catch (error) {
    console.error("Captacao update failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const ok = await deleteCaptacao(id);
    return NextResponse.json({ ok });
  } catch (error) {
    console.error("Captacao delete failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
