import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { listSimulationClientsPage, getSimulationClientCounters, getPendingClientsCount } from "@/lib/simulation-list-query";
import { getSupabaseAdminClient } from "@/lib/supabase";

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
    results.pending = describe(error);
  }

  try {
    const supabase = getSupabaseAdminClient();
    let q = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
    q = q.neq("status", "do_not_contact").neq("status", "awaiting_return");
    const { error, count } = await q;
    results.rawCount = error ? describe(error) : { ok: true, count };
  } catch (error) {
    results.rawCount = { ok: false, caught: true, ...describe(error) };
  }

  try {
    const supabase = getSupabaseAdminClient();
    let q = supabase.from("simulation_registrations").select("*, client_tags(tag:tags(*)), simulations(*)", { count: "exact" });
    q = q.neq("status", "do_not_contact").order("created_at", { ascending: false }).range(0, 4);
    const { error, count, data } = await q;
    results.rawPage = error ? describe(error) : { ok: true, count, rows: data?.length };
  } catch (error) {
    results.rawPage = { ok: false, caught: true, ...describe(error) };
  }

  return NextResponse.json(results);
}
