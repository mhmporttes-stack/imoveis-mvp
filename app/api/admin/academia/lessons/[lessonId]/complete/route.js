import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyService } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conclui uma aula SEM prova (aula com prova só conclui aprovada, por /exams/[examId]/attempts). Idempotente.
export async function POST(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { lessonId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return NextResponse.json({ error: "Aula inválida.", code: "lesson_not_found" }, { status: 400 });
  try {
    const service = getAcademyService();
    if (!service) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const result = await service.completeLessonNoExam(resolveAcademyActor(auth), lessonId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
