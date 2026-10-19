import { NextResponse } from "next/server";
import { getActingAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  ensureManualSimulationRegistration,
  ExistingPhoneRegistrationError,
  formatSimulationRegistrationError
} from "@/lib/simulation-registrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulationRegistrations()) {
    return NextResponse.json({ error: "Supabase nao configurado para gerenciar cadastros." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const registration = await ensureManualSimulationRegistration({
      ...body,
      adminEmail: getActingAdminEmail(auth)
    }, auth);
    return NextResponse.json(registration, { status: 201 });
  } catch (error) {
    if (error instanceof ExistingPhoneRegistrationError) {
      return NextResponse.json({ error: error.message, code: error.code, existing: error.existing, privateContact: error.privateContact }, { status: 409 });
    }
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}
