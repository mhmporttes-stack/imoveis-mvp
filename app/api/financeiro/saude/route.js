import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial } from "@/lib/financial";
import { formatHealthError, getHealthSettings, saveHealthSettings } from "@/lib/financial-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DENIED = "Apenas o administrador geral pode acessar a Saúde financeira.";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  try {
    return NextResponse.json({ settings: await getHealthSettings() });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}

// Configuração de caixa (saldo inicial) e reserva.
export async function PUT(request) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  try {
    const body = await request.json();
    return NextResponse.json({ settings: await saveHealthSettings(body, auth.user?.email) });
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}
