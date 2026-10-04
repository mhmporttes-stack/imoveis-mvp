import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyManagement } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detalhe de um aluno (matrículas, atrasos, histórico de tentativas, certificado). Fora do escopo do gestor = 404.
export async function GET(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Aluno não encontrado.", code: "student_not_found" }, { status: 404 });
  try {
    const management = getAcademyManagement();
    if (!management) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await management.getStudent(academyManagementScope(auth), userId));
  } catch (error) {
    return academyErrorResponse(error);
  }
}
