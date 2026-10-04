import { NextResponse } from "next/server";
import { z } from "zod";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyCertificates } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), certificateId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).strict(),
  z.object({ action: z.literal("reissue"), enrollmentId: z.string().uuid() }).strict()
]);

// Revogar (com motivo, auditado, nunca apaga) e reemitir (código novo): só o Admin (plano §3). Em "Alterar conta": 403.
export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos (informe o motivo da revogação).", code: "invalid_action" }, { status: 400 });
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const certificates = getAcademyCertificates();
    if (!certificates) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const input = parsed.data;
    const result = input.action === "revoke" ? await certificates.revoke(actor, input) : await certificates.reissue(actor, input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
