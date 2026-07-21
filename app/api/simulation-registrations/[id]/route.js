import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  deleteSimulationRegistration,
  formatSimulationRegistrationError
} from "@/lib/simulation-registrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulationRegistrations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar cadastros." }, { status: 503 });
  }

  try {
    await deleteSimulationRegistration((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}
