import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyGrants } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  enrollmentId: z.string().uuid(),
  examId: z.string().uuid(),
  reason: z.string().max(300).optional()
}).strict();

// Quem esgotou as tentativas (no escopo do usuário: admin = todos; gestor = a própria equipe) e as liberações já feitas.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const grants = getAcademyGrants();
    if (!grants) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await grants.list(academyManagementScope(auth)));
  } catch (error) {
    return academyErrorResponse(error);
  }
}

// Libera +1 tentativa (manual, por aluno e prova, 1 vez; registra quem e quando). Gestor só para a própria equipe.
export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos.", code: "invalid_action" }, { status: 400 });
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const grants = getAcademyGrants();
    if (!grants) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json({ ok: true, result: await grants.grant(actor, academyManagementScope(auth), parsed.data) });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
