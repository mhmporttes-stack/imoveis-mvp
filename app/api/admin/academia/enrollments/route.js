import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyManagement } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), userIds: z.array(z.string().uuid()).min(1).max(200), trackId: z.string().uuid(), required: z.boolean().optional(), dueAt: z.string().max(40).nullable().optional() }).strict(),
  z.object({ action: z.literal("setDue"), enrollmentId: z.string().uuid(), dueAt: z.string().max(40).nullable() }).strict()
]);

// Atribuir treinamento (com ou sem prazo/obrigatoriedade) e mudar prazo. Gerente: só para a própria equipe; fora dela = 403 e NADA é criado.
// Em "Alterar conta": 403. Não envia notificação nenhuma (F7: só preparar).
export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos.", code: "invalid_action" }, { status: 400 });
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const management = getAcademyManagement();
    if (!management) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const scope = academyManagementScope(auth);
    const input = parsed.data;
    const result = input.action === "assign" ? await management.assign(actor, scope, input) : await management.setDue(actor, scope, input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
