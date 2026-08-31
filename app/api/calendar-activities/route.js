import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import {
  formatSimulationRegistrationError,
  listScheduledActivityRegistrations
} from "@/lib/simulation-registrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const registrations = await listScheduledActivityRegistrations({ from, to, auth });
    let profiles = [];

    try {
      profiles = await listAdminProfiles();
    } catch {
      profiles = [];
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const activities = registrations.map((registration) => {
      const responsible = profileById.get(registration.responsibleUserId);
      return {
        id: registration.id,
        clientName: registration.fullName || "Cliente sem nome",
        phone: registration.phone || "",
        phoneNormalized: registration.phoneNormalized || "",
        status: registration.status,
        scheduledActivityAt: registration.scheduledActivityAt,
        scheduledActivityType: registration.scheduledActivityType || "follow_up",
        scheduledActivityNote: registration.scheduledActivityNote || "",
        scheduledActivityCompletedAt: registration.scheduledActivityCompletedAt || "",
        scheduledActivityCompletedBy: registration.scheduledActivityCompletedBy || "",
        scheduledActivityCompleted: Boolean(registration.scheduledActivityCompletedAt),
        responsibleUserId: registration.responsibleUserId || "",
        responsibleName: responsible?.name || (registration.responsibleUserId ? "Corretor" : "Sem corretor"),
        createdAt: registration.createdAt || ""
      };
    });

    return NextResponse.json({ activities });
  } catch (error) {
    console.error("Erro ao carregar calendario de atividades:", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}
