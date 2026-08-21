import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { createCaptacao, formatCaptacaoError, listCaptacoes } from "@/lib/captacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
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
    const captacao = await createCaptacao(payload);
    return NextResponse.json(captacao, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
