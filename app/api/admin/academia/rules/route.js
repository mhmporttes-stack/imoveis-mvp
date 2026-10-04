import { NextResponse } from "next/server";
import { z } from "zod";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyRules } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"), trackId: z.string().uuid(), kind: z.enum(["new_user", "recycle"]),
    audienceRoles: z.array(z.enum(["admin", "manager", "broker", "associate"])).min(1).max(4),
    dueDays: z.number().int().min(1).max(730).nullable().optional(), everyDays: z.number().int().min(30).max(1825).nullable().optional(), active: z.boolean().optional()
  }).strict(),
  z.object({ action: z.literal("apply"), dryRun: z.boolean().optional() }).strict()
]);

// Regras de matrícula automática (novos usuários, reciclagem): só o Admin geral (afetam todos). Só PREPARAM matrículas: nenhuma
// notificação é enviada. Regra nova nasce desligada; "apply" com dryRun só conta quem entraria.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const rules = getAcademyRules();
    if (!rules) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await rules.list());
  } catch (error) {
    return academyErrorResponse(error);
  }
}

export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Regra inválida.", code: "invalid_rule" }, { status: 400 });
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const rules = getAcademyRules();
    if (!rules) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const { action, ...input } = parsed.data;
    return NextResponse.json({ ok: true, result: action === "save" ? await rules.save(actor, input) : await rules.apply(actor, input) });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
