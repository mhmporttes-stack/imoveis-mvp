import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { academyDisabledResponse, academyErrorResponse, getAcademyContent } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Árvore de uma versão para o editor (inclui gabarito: só Admin e Gerente chegam aqui) + pendências de publicação.
export async function GET(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return NextResponse.json({ error: "Versão inválida.", code: "version_not_found" }, { status: 400 });
  try {
    const content = getAcademyContent();
    if (!content) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await content.getEditTree(versionId));
  } catch (error) {
    return academyErrorResponse(error);
  }
}
