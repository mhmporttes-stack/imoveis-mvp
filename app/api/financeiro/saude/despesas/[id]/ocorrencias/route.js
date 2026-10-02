import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial } from "@/lib/financial";
import { applyOccurrenceAction, formatHealthError } from "@/lib/financial-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DENIED = "Apenas o administrador geral pode acessar a Saúde financeira.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Confirmar pagamento ({ action: "pay" }), reagendar ({ action: "reschedule" }) ou desfazer ({ action: "undo" })
// UMA ocorrência (identificada pela data original) de uma despesa.
export async function POST(request, { params }) {
  const auth = await requireGeneralAdminApi(request, DENIED);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageFinancial()) return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  try {
    const body = await request.json();
    return NextResponse.json(await applyOccurrenceAction(id, body, auth.user?.email));
  } catch (error) {
    return NextResponse.json({ error: formatHealthError(error) }, { status: 400 });
  }
}
