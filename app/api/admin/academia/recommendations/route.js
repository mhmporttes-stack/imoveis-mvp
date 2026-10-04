import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyRecommendations } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), userId: z.string().uuid(), trackId: z.string().uuid(), reason: z.string().trim().min(3).max(500), source: z.enum(["manual", "atendimento_audit"]).optional() }).strict(),
  z.object({ action: z.literal("accept"), recommendationId: z.string().uuid(), dueAt: z.string().max(40).nullable().optional() }).strict(),
  z.object({ action: z.literal("dismiss"), recommendationId: z.string().uuid() }).strict()
]);

// Recomendações de treinamento (manuais ou vindas da auditoria de atendimento). Só preparam: aceitar matricula; nada é enviado.
// Admin: qualquer pessoa; Gerente: só a própria equipe. Em "Alterar conta": 403.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const status = new URL(request.url).searchParams.get("status");
  if (status && !["open", "accepted", "dismissed"].includes(status)) return NextResponse.json({ error: "Filtro inválido.", code: "invalid_action" }, { status: 400 });
  try {
    const recs = getAcademyRecommendations();
    if (!recs) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await recs.list(academyManagementScope(auth), { status: status || undefined }));
  } catch (error) {
    return academyErrorResponse(error);
  }
}

export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos (informe o motivo).", code: "invalid_recommendation" }, { status: 400 });
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const recs = getAcademyRecommendations();
    if (!recs) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const scope = academyManagementScope(auth);
    const { action, ...input } = parsed.data;
    // origem "atendimento_audit" é reservada à integração com a auditoria de atendimento: só Admin pode gravá-la
    if (action === "create" && input.source === "atendimento_audit" && !scope.admin) return NextResponse.json({ error: "Origem reservada ao Admin.", code: "out_of_scope" }, { status: 403 });
    const result = action === "create" ? await recs.create(actor, scope, input) : action === "accept" ? await recs.accept(actor, scope, input) : await recs.dismiss(actor, scope, input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
