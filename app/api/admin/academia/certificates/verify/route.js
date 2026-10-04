import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { academyDisabledResponse, academyErrorResponse, getAcademyCertificates } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verificação INTERNA por código (Admin e Gerente). A verificação pública é fase posterior (decisão do dono): esta rota exige login.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const certificates = getAcademyCertificates();
    if (!certificates) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json({ ok: true, result: await certificates.verifyByCode(new URL(request.url).searchParams.get("code")) });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
