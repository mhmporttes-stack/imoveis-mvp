import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import {
  formatSimulationRegistrationError,
  listBirthdayRegistrations,
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
    const [registrations, birthdayRegistrations] = await Promise.all([
      listScheduledActivityRegistrations({ from, to, auth }),
      listBirthdayRegistrations({ auth })
    ]);
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

    activities.push(...buildBirthdayActivities(birthdayRegistrations, profileById, from, to));
    activities.sort((a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt));

    return NextResponse.json({ activities });
  } catch (error) {
    console.error("Erro ao carregar calendario de atividades:", error);
    return NextResponse.json({ error: formatSimulationRegistrationError(error) }, { status: 400 });
  }
}

function buildBirthdayActivities(registrations, profileById, from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return [];
  const years = [];
  for (let year = fromDate.getFullYear(); year <= toDate.getFullYear(); year += 1) years.push(year);

  return registrations.flatMap((registration) => {
    const birthDate = parseBirthDate(registration.oldestBirthDate);
    if (!birthDate) return [];
    const responsible = profileById.get(registration.responsibleUserId);
    return years.flatMap((year) => {
      const day = Math.min(birthDate.day, new Date(year, birthDate.month, 0).getDate());
      const scheduledActivityAt = `${year}-${String(birthDate.month).padStart(2, "0")}-${String(day).padStart(2, "0")}T08:00:00-03:00`;
      const occurrence = new Date(scheduledActivityAt);
      if (occurrence < fromDate || occurrence > toDate) return [];
      const shortName = birthdayName(registration.fullName);
      return [{
        id: `birthday-${registration.id}-${year}`,
        clientId: registration.id,
        clientName: registration.fullName || "Cliente sem nome",
        title: `Aniversário do cliente ${shortName}`,
        phone: registration.phone || "",
        phoneNormalized: registration.phoneNormalized || "",
        status: registration.status,
        scheduledActivityAt,
        scheduledActivityType: "birthday",
        scheduledActivityNote: `Aniversário do cliente ${shortName}`,
        scheduledActivityCompletedAt: "",
        scheduledActivityCompleted: false,
        responsibleUserId: registration.responsibleUserId || "",
        responsibleName: responsible?.name || (registration.responsibleUserId ? "Corretor" : "Sem corretor"),
        isBirthday: true
      }];
    });
  });
}

function parseBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match || match[1] === "1900") return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Number(match[1]), month, 0).getDate()) return null;
  return { month, day };
}

function birthdayName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "sem nome";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts.at(-1)}`;
}
