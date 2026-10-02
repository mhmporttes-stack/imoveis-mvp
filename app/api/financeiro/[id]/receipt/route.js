import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { canManageFinancial, confirmExpectedReceipt, formatFinancialError, rescheduleExpectedReceipt } from "@/lib/financial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Previsão de recebimento da comissão (Financeiro + Agenda).
//   { action: "confirm",    amount?, receivedDate?, nextExpectedDate? }  → confirma o recebimento (total/parcial)
//   { action: "reschedule", expectedDate }                               → move a data da previsão
// Idempotente: confirmar de novo devolve { alreadyConfirmed: true } sem criar outro pagamento.
export async function POST(request, { params }) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode alterar o financeiro.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageFinancial()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado para gerenciar o financeiro." }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const id = (await params).id;

    if (body.action === "confirm") {
      const result = await confirmExpectedReceipt(id, body, auth);
      return NextResponse.json(result);
    }
    if (body.action === "reschedule") {
      const result = await rescheduleExpectedReceipt(id, body.expectedDate, auth);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: formatFinancialError(error) }, { status: 400 });
  }
}
