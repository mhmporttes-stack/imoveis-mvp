import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { deleteCaptacao, formatCaptacaoError, getCaptacao, updateCaptacao } from "@/lib/captacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const captacao = await getCaptacao(id, auth);
    return NextResponse.json(captacao);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 404 });
  }
}

export async function PATCH(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const captacao = await updateCaptacao(id, await request.json(), auth);
    return NextResponse.json(captacao);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    await deleteCaptacao(id, auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
