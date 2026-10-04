import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyService } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = z.string().min(1).max(64);
const bodySchema = z.object({
  answers: z.record(ID, z.union([ID, z.array(ID).max(12)])).refine((a) => Object.keys(a).length > 0 && Object.keys(a).length <= 100)
}).strict();

// Envia uma tentativa. A correção, a nota (70%), o limite de 3 tentativas e a conclusão da aula acontecem no
// servidor; a resposta só traz o gabarito depois de aprovado. O aluno é o perfil efetivo da sessão.
export async function POST(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { examId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(examId)) {
    return NextResponse.json({ error: "Resposta inválida.", code: "invalid_answers" }, { status: 400 });
  }
  try {
    const service = getAcademyService();
    if (!service) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const result = await service.submitAttempt(resolveAcademyActor(auth), examId, parsed.data.answers);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
