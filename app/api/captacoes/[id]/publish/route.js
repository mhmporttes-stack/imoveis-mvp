import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createPropertyDraftFromCaptacao, formatCaptacaoError } from "@/lib/captacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const result = await createPropertyDraftFromCaptacao(id);
    return NextResponse.json(result, { status: result.alreadyExists ? 200 : 201 });
  } catch (error) {
    console.error("Captacao publish failed:", error?.message || error);
    return NextResponse.json({ error: formatCaptacaoError(error) }, { status: 400 });
  }
}
