import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
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
    const body = await request.json();
    const registration = await updateSimulationRegistration((await params).id, {
      ...body,
      adminEmail: auth.user?.email
    }, auth);
    return NextResponse.json(registration);
  } catch (error) {
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
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
