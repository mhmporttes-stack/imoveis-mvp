import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listCalendarActivitiesForClients } from "@/lib/calendar-activities";
import { listTags } from "@/lib/client-tags";
import {
  getPendingClientsCount,
  getSimulationClientCounters,
  listSimulationClientsPage
} from "@/lib/simulation-list-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function describeError(error) {
  return {
    message: error?.message ?? null,
    name: error?.name ?? null,
    code: error?.code ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    stack: (error?.stack || "").split("\n").slice(0, 6).join("\n")
  };
}

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ authError: auth.error, status: auth.status }, { status: 200 });
  }

  const checks = {
    authProfile: {
      role: auth.profile?.role ?? null,
      hasManagedUserIds: Array.isArray(auth.profile?.managedUserIds),
      isFallback: auth.profile?.isFallback ?? null,
      accountSwitchMode: auth.accountSwitchMode ?? null
    }
  };

  const steps = [
    ["listSimulationClientsPage", () => listSimulationClientsPage({ auth, filters: {}, page: 1 })],
    ["getSimulationClientCounters", () => getSimulationClientCounters({ auth, filters: {} })],
    ["getPendingClientsCount", () => getPendingClientsCount({ auth })],
    ["listTags", () => listTags()],
    ["listAdminProfiles", () => listAdminProfiles()]
  ];

  for (const [name, fn] of steps) {
    try {
      const result = await fn();
      checks[name] = { ok: true, shape: Array.isArray(result) ? `array(${result.length})` : typeof result };
      if (name === "listSimulationClientsPage") {
        checks.listCalendarActivitiesForClients = await (async () => {
          try {
            const activitiesByClient = await listCalendarActivitiesForClients(result.items.map((c) => c.id), auth);
            return { ok: true, shape: `map(${activitiesByClient.size ?? "?"})` };
          } catch (activityError) {
            return { ok: false, error: describeError(activityError) };
          }
        })();
      }
    } catch (error) {
      checks[name] = { ok: false, error: describeError(error) };
    }
  }

  return NextResponse.json({ checks });
}
