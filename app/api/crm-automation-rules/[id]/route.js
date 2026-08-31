import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { deleteAutomationRule, setAutomationRuleEnabled, updateAutomationRule } from "@/lib/crm-automations";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const payload = await request.json();
    const rule = Object.keys(payload).length === 1 && "enabled" in payload
      ? await setAutomationRuleEnabled(id, payload.enabled, auth)
      : await updateAutomationRule(id, payload, auth);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar a regra." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    await deleteAutomationRule(id, auth);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível excluir a regra." }, { status: 400 });
  }
}
