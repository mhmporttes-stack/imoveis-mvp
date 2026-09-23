import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { listSimulationClientsPage, getSimulationClientCounters, getPendingClientsCount } from "@/lib/simulation-list-query";
import { listTags } from "@/lib/client-tags";
import { listAdminProfiles } from "@/lib/admin-profiles";

export const runtime = "nodejs";

function describe(error) {
  return {
    ok: false,
    type: typeof error,
    isError: error instanceof Error,
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    name: error?.name,
    full: (() => { try { return JSON.stringify(error, Object.getOwnPropertyNames(error || {})); } catch { return String(error); } })()
  };
}

export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const filters = { query: "", responsibleUserId: "all", tagId: "all", pendingOnly: false, staleContactOnly: false, noFutureActivityOnly: false, statusGroup: "all", status: "all" };

  // Sequencial (uma de cada vez) pra isolar exatamente qual falha quando
  // NÃO há burst de conexões simultâneas.
  const results = {};
  const steps = [
    ["page", () => listSimulationClientsPage({ auth, filters, page: 1 })],
    ["counters", () => getSimulationClientCounters({ auth, filters })],
    ["pending", () => getPendingClientsCount({ auth })],
    ["tags", () => listTags()],
    ["profiles", () => listAdminProfiles()]
  ];
  for (const [key, fn] of steps) {
    try {
      const value = await fn();
      results[key] = { ok: true, summary: Array.isArray(value) ? value.length : (value?.items ? { items: value.items.length, total: value.total } : value) };
    } catch (error) {
      results[key] = describe(error);
    }
  }

  // Agora em paralelo (Promise.allSettled), exatamente como page.jsx faz.
  const parallel = await Promise.allSettled([
    listSimulationClientsPage({ auth, filters, page: 1 }),
    getSimulationClientCounters({ auth, filters }),
    getPendingClientsCount({ auth }),
    listTags(),
    listAdminProfiles()
  ]);
  results.parallel = parallel.map((r, i) => r.status === "fulfilled"
    ? { ok: true, key: steps[i][0] }
    : { ok: false, key: steps[i][0], ...describe(r.reason) });

  return NextResponse.json(results);
}
