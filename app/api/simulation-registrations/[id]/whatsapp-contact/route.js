import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  formatSimulationRegistrationError,
  markSimulationRegistrationWhatsAppContact
} from "@/lib/simulation-registrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulationRegistrations()) {
    return NextResponse.json({ error: "Supabase nao configurado para gerenciar cadastros." }, { status: 503 });
  }

  try {
    const registration = await markSimulationRegistrationWhatsAppContact((await params).id, auth.user?.email);
    return NextResponse.json(registration);
  } catch (error) {
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}
