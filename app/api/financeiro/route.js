import { NextResponse } from "next/server";
import { requirePrimaryAdminApi } from "@/lib/admin-auth";
import { canManageFinancial, formatFinancialError, listFinancialSales } from "@/lib/financial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requirePrimaryAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageFinancial()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado para gerenciar o financeiro." }, { status: 503 });
  }

  try {
    const sales = await listFinancialSales();
    return NextResponse.json({ sales });
  } catch (error) {
    return NextResponse.json({ error: formatFinancialError(error) }, { status: 400 });
  }
}
