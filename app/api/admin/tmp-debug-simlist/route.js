import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { listSimulationClientsPage, getSimulationClientCounters, getPendingClientsCount } from "@/lib/simulation-list-query";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const filters = { query: "", responsibleUserId: "all", tagId: "all", pendingOnly: false, staleContactOnly: false, noFutureActivityOnly: false, statusGroup: "all", status: "all" };
  const results = {};

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
      full: (() => { try { return JSON.stringify(error, Object.getOwnPropertyNames(error || {})); } catch { return String(error); } })(),
      stack: String(error?.stack || "").split("\n").slice(0, 10)
    };
  }

  try {
    const page = await listSimulationClientsPage({ auth, filters, page: 1 });
    results.page = { ok: true, items: page.items.length, total: page.total };
  } catch (error) {
    results.page = describe(error);
  }

  try {
    const counters = await getSimulationClientCounters({ auth, filters });
    results.counters = { ok: true, counters };
  } catch (error) {
    results.counters = describe(error);
  }

  try {
    const pending = await getPendingClientsCount({ auth });
    results.pending = { ok: true, pending };
  } catch (error) {
    results.pending = { ok: false, message: error?.message, stack: String(error?.stack || "").split("\n").slice(0, 6) };
  }

  return NextResponse.json(results);
}
