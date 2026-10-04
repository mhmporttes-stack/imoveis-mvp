import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyService } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Questões da PRÓXIMA tentativa de uma prova com várias questões (sem gabarito). O conjunto é o mesmo que a correção usa
// (sorteio determinístico por matrícula + prova + nº da tentativa). Só do próprio aluno (perfil efetivo).
export async function GET(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) return NextResponse.json({ error: "Prova inválida.", code: "exam_not_found" }, { status: 400 });
  try {
    const service = getAcademyService();
    if (!service) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json({ ok: true, result: await service.getExamQuestions(resolveAcademyActor(auth), examId) });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
