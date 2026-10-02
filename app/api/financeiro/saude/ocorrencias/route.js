import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial } from "@/lib/financial";
import { formatHealthError, listExpenseOccurrences } from "@/lib/financial-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode acessar a Saúde financeira.");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  try {
    return NextResponse.json({ occurrences: await listExpenseOccurrences() });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}
