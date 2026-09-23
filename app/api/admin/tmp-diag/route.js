import { NextResponse } from "next/server";
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

const FAKE_OWNER_AUTH = {
  ok: true,
  user: { email: "mhmporttes@gmail.com" },
  profile: { id: "smoke-test", role: "admin", email: "mhmporttes@gmail.com" }
};

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

export async function GET() {
  const checks = {};

  const steps = [
    ["listSimulationClientsPage", () => listSimulationClientsPage({ auth: FAKE_OWNER_AUTH, filters: {}, page: 1 })],
    ["getSimulationClientCounters", () => getSimulationClientCounters({ auth: FAKE_OWNER_AUTH, filters: {} })],
    ["getPendingClientsCount", () => getPendingClientsCount({ auth: FAKE_OWNER_AUTH })],
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
            const activitiesByClient = await listCalendarActivitiesForClients(result.items.map((c) => c.id), FAKE_OWNER_AUTH);
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
