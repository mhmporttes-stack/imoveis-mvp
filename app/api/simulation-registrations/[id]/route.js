import { NextResponse } from "next/server";
import { getActingAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  deleteSimulationRegistration,
  formatSimulationRegistrationError,
  updateSimulationRegistration
} from "@/lib/simulation-registrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulationRegistrations()) {
    return NextResponse.json({ error: "Supabase nÃ£o configurado para gerenciar cadastros." }, { status: 503 });
  }

  try {
    // `statusSource` é só do servidor (origem do status no histórico; isenta a decisão do cliente frio da trava PRO-9 —
    // dono, 2026-10-24): nunca aceito do corpo da requisição.
    const { statusSource: _ignoredStatusSource, ...body } = (await request.json()) || {};
    // Telefone vindo da tela = digitado por pessoa: validado no servidor (número válido, nunca da equipe — MKT-2/WA-12).
    const registration = await updateSimulationRegistration((await params).id, {
      ...body,
      manualPhone: body?.phone !== undefined,
      adminEmail: getActingAdminEmail(auth)
    }, auth);
    return NextResponse.json(registration);
  } catch (error) {
    // "Pago" só pelo dono (FIN-7, 2026-10-24): recusa de permissão sai como 403.
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: error?.code === "SALE_PAID_OWNER_ONLY" ? 403 : 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulationRegistrations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar cadastros." }, { status: 503 });
  }

  try {
    await deleteSimulationRegistration((await params).id, auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}
