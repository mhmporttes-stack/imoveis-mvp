import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial } from "@/lib/financial";
import { createOperatingExpense, formatHealthError, listOperatingExpenses } from "@/lib/financial-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DENIED = "Apenas o administrador geral pode acessar a Saúde financeira.";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  try {
    return NextResponse.json({ expenses: await listOperatingExpenses() });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  try {
    const body = await request.json();
    return NextResponse.json(await createOperatingExpense(body, auth.user?.email), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}
