import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial } from "@/lib/financial";
import { deleteOperatingExpense, formatHealthError, updateOperatingExpense } from "@/lib/financial-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DENIED = "Apenas o administrador geral pode acessar a Saúde financeira.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request, { params }) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  try {
    const body = await request.json();
    return NextResponse.json(await updateOperatingExpense(id, body, auth.user?.email));
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  try {
    await deleteOperatingExpense(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}
